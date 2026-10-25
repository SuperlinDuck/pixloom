import { db, ownsWorker, setRuntime } from '../store'
import { limit } from '../platform-config'
import type { ProjectRuntime } from './types'

// Called only by the serial Worker, between tasks (or before creating an environment).
// A queued task is safe to reclaim: its source will be loaded when the Worker claims it.
export async function reapEnvironments(
  runtime: ProjectRuntime,
  owner?: string,
  makeRoom = false,
) {
  const active = () => !owner || ownsWorker(owner)
  if (!active()) return
  if (runtime.managedProjects) {
    for (const id of await runtime.managedProjects()) {
      if (!active()) return
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
    if (row.state === 'absent') continue
    const state = await runtime.state(row.projectId)
    if (!active()) return
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
