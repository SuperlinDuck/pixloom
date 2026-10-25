import { db, ownsWorker, setRuntime, setRuntimeForTask } from '../store'
import { limit } from '../platform-config'
import { Semaphore } from '../concurrency'
import type { Task } from '../types'
import type { ProjectRuntime, SourceFile } from './types'

const lifecycle = new Semaphore(() => 1)
const protectedProjects = new Map<string, number>()
export const withRuntimeLifecycle = <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
) => lifecycle.run(signal, operation)

export function protectEnvironment(projectId: string) {
  protectedProjects.set(projectId, (protectedProjects.get(projectId) || 0) + 1)
  return () => {
    const count = protectedProjects.get(projectId)! - 1
    if (count) protectedProjects.set(projectId, count)
    else protectedProjects.delete(projectId)
  }
}

export async function reapEnvironments(
  runtime: ProjectRuntime,
  owner?: string,
  makeRoom = false,
) {
  return withRuntimeLifecycle(() => reapUnlocked(runtime, owner, makeRoom))
}

async function reapUnlocked(
  runtime: ProjectRuntime,
  owner?: string,
  makeRoom = false,
) {
  const active = () => !owner || ownsWorker(owner)
  if (!active()) return
  if (runtime.managedProjects) {
    for (const id of await runtime.managedProjects()) {
      if (!active()) return
      if (protectedProjects.has(id)) continue
      if (!db().prepare('SELECT 1 FROM projects WHERE id=?').get(id)) {
        await runtime.remove(id)
      } else if (
        !db()
          .prepare('SELECT 1 FROM runtime_workspaces WHERE projectId=?')
          .get(id)
      ) {
        setRuntime(id, await runtime.state(id))
      }
    }
  }
  const rows = db()
    .prepare(
      `SELECT r.* FROM runtime_workspaces r
    WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.projectId=r.projectId AND t.status='running')
    ORDER BY r.updatedAt ASC`,
    )
    .all() as { projectId: string; state: string; updatedAt: string }[]
  let retained = (
    db()
      .prepare(
        "SELECT count(*) AS n FROM runtime_workspaces WHERE state IN ('running','stopped','error')",
      )
      .get() as { n: number }
  ).n
  const maximum = limit('PIXLOOM_MAX_RUNTIME_CONTAINERS', 3)
  const idle = limit('PIXLOOM_RUNTIME_IDLE_SECONDS', 300, 0) * 1000
  for (const row of rows) {
    if (!active()) return
    if (row.state === 'absent' || protectedProjects.has(row.projectId)) continue
    const state = await runtime.state(row.projectId)
    if (!active()) return
    // A task may have been claimed while Docker was being queried.
    if (
      protectedProjects.has(row.projectId) ||
      db()
        .prepare("SELECT 1 FROM tasks WHERE projectId=? AND status='running'")
        .get(row.projectId)
    )
      continue
    if (state === 'absent') {
      setRuntime(row.projectId, 'absent')
      retained--
      continue
    }
    const expired = Date.now() - Date.parse(row.updatedAt) >= idle
    if (expired || (makeRoom && retained >= maximum)) {
      await runtime.remove(row.projectId)
      if (!active()) return
      setRuntime(row.projectId, 'absent')
      retained--
    }
  }
}

// The capacity check, eviction, creation and database registration form one
// allocation. Other tasks can generate while this short critical section runs.
export async function prepareEnvironment(
  runtime: ProjectRuntime,
  task: Task,
  files: SourceFile[],
  hash: string,
  signal: AbortSignal,
  check: () => void,
  owner?: string,
) {
  return withRuntimeLifecycle(async () => {
    check()
    const id = task.projectId
    try {
      const state = await runtime.state(id)
      check()
      if (state === 'absent') {
        await reapUnlocked(runtime, owner, true)
        check()
        const count = db()
          .prepare(
            "SELECT count(*) AS n FROM runtime_workspaces WHERE state IN ('running','stopped','error') AND projectId!=?",
          )
          .get(id) as { n: number }
        if (count.n >= limit('PIXLOOM_MAX_RUNTIME_CONTAINERS', 3))
          throw new Error('运行环境已满，请稍后重试')
        await runtime.create(id, task.attemptId!, files, signal)
      } else {
        if (state === 'running') await runtime.stop(id)
        check()
        await runtime.start(id, files, signal)
      }
      check()
      // Register before releasing the allocation lock, including partial setup.
      setRuntimeForTask(task, 'running', hash)
      await runtime.replaceFiles(id, files, signal)
      check()
    } catch (error) {
      const state = await runtime.state(id).catch(() => 'error' as const)
      if (!owner || ownsWorker(owner)) setRuntime(id, state)
      throw error
    }
  }, signal)
}
