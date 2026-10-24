import { randomUUID } from 'node:crypto'
import { db, getProject, StoreError, transaction } from '../store'
import { validateFiles } from './files'
import type {
  RuntimeAction,
  RuntimeDetail,
  RuntimeJob,
  RuntimeState,
  RuntimeWorkspace,
  SourceFile,
} from './types'
const now = () => new Date().toISOString()
function decodeWorkspace(row: unknown): RuntimeWorkspace | null {
  if (!row) return null
  const record = row as Omit<RuntimeWorkspace, 'files' | 'built'> & {
    files: string
    built: number
  }
  return {
    ...record,
    files: JSON.parse(record.files),
    built: Boolean(record.built),
  }
}
function decodeJob(row: unknown): RuntimeJob {
  const record = row as Omit<RuntimeJob, 'events' | 'payload'> & {
    events: string
    payload: string
  }
  return {
    ...record,
    events: JSON.parse(record.events),
    payload: JSON.parse(record.payload),
  }
}
export function getRuntime(projectId: string): RuntimeDetail {
  getProject(projectId)
  return {
    workspace: decodeWorkspace(
      db()
        .prepare('SELECT * FROM runtime_workspaces WHERE projectId=?')
        .get(projectId),
    ),
    jobs: db()
      .prepare(
        'SELECT * FROM runtime_jobs WHERE projectId=? ORDER BY createdAt DESC, rowid DESC LIMIT 10',
      )
      .all(projectId)
      .map(decodeJob),
  }
}
export function runtimeByToken(token: string) {
  return decodeWorkspace(
    db().prepare('SELECT * FROM runtime_workspaces WHERE token=?').get(token),
  )
}
export function enqueueRuntimeJob(
  projectId: string,
  action: RuntimeAction,
  initialFiles: SourceFile[],
  payload: RuntimeJob['payload'] = {},
): RuntimeJob {
  return transaction(() => {
    const { workspace, jobs } = getRuntime(projectId)
    if (jobs.some((j) => j.status === 'queued' || j.status === 'running'))
      throw new StoreError('当前环境已有正在执行的操作', 409)
    if (action === 'create') {
      const count = db()
        .prepare(
          "SELECT COUNT(*) AS n FROM (SELECT projectId FROM runtime_workspaces WHERE state!='absent' UNION SELECT projectId FROM runtime_jobs WHERE action='create' AND status IN ('queued','running'))",
        )
        .get() as { n: number }
      if ((!workspace || workspace.state === 'absent') && count.n >= 3)
        throw new StoreError('本地最多保留 3 个容器环境，请先移除其他环境', 409)
    }
    if (!workspace) {
      if (action !== 'create') throw new StoreError('请先创建 Docker 环境', 409)
      validateFiles(initialFiles)
      db()
        .prepare('INSERT INTO runtime_workspaces VALUES (?,?,?,?,?,?)')
        .run(
          projectId,
          randomUUID(),
          'absent',
          0,
          JSON.stringify(initialFiles),
          now(),
        )
    }
    if (action === 'write') {
      if (
        typeof payload.path !== 'string' ||
        typeof payload.content !== 'string'
      )
        throw new StoreError('缺少文件内容')
      const files = workspace!.files
        .filter((f) => f.path !== payload.path)
        .concat({ path: payload.path, content: payload.content })
      validateFiles(files)
    }
    const id = randomUUID(),
      time = now()
    db()
      .prepare('INSERT INTO runtime_jobs VALUES (?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        projectId,
        action,
        'queued',
        JSON.stringify(payload),
        JSON.stringify([{ at: time, message: '操作已排队，等待 Worker' }]),
        null,
        time,
        time,
      )
    return runtimeJob(id)
  })
}
export function runtimeJob(id: string) {
  const row = db().prepare('SELECT * FROM runtime_jobs WHERE id=?').get(id)
  if (!row) throw new StoreError('环境操作不存在', 404)
  return decodeJob(row)
}
export function claimRuntimeJob() {
  return transaction(() => {
    const row = db()
      .prepare(
        "SELECT id FROM runtime_jobs WHERE status='queued' ORDER BY createdAt LIMIT 1",
      )
      .get() as { id: string } | undefined
    if (!row) return
    db()
      .prepare(
        "UPDATE runtime_jobs SET status='running',updatedAt=? WHERE id=?",
      )
      .run(now(), row.id)
    return runtimeJob(row.id)
  })
}
export function runtimeEvent(id: string, message: string) {
  transaction(() => {
    const job = runtimeJob(id)
    if (job.status !== 'running') return
    job.events.push({ at: now(), message: message.slice(-16000) })
    db()
      .prepare('UPDATE runtime_jobs SET events=?,updatedAt=? WHERE id=?')
      .run(JSON.stringify(job.events), now(), id)
  })
}
export function finishRuntimeJob(id: string, error?: string) {
  transaction(() => {
    const job = runtimeJob(id)
    if (job.status !== 'running') return
    db()
      .prepare(
        'UPDATE runtime_jobs SET status=?,error=?,updatedAt=? WHERE id=?',
      )
      .run(error ? 'failed' : 'completed', error || null, now(), id)
  })
}
export function cancelRuntimeJob(projectId: string) {
  transaction(() => {
    getProject(projectId)
    db()
      .prepare(
        "UPDATE runtime_jobs SET status='cancelled',updatedAt=? WHERE projectId=? AND status IN ('queued','running')",
      )
      .run(now(), projectId)
  })
}
export function updateRuntime(
  projectId: string,
  state: RuntimeState,
  built: boolean,
  files?: SourceFile[],
) {
  if (files) validateFiles(files)
  db()
    .prepare(
      'UPDATE runtime_workspaces SET state=?,built=?,files=COALESCE(?,files),updatedAt=? WHERE projectId=?',
    )
    .run(
      state,
      Number(built),
      files ? JSON.stringify(files) : null,
      now(),
      projectId,
    )
}

export function updateRuntimeForJob(
  jobId: string,
  state: RuntimeState,
  built: boolean,
  files?: SourceFile[],
) {
  return transaction(() => {
    const job = runtimeJob(jobId)
    if (job.status !== 'running') return false
    updateRuntime(job.projectId, state, built, files)
    return true
  })
}

export function reconcileRuntime(
  projectId: string,
  state: 'absent' | 'stopped',
  expectedUpdatedAt: string,
) {
  db()
    .prepare(
      "UPDATE runtime_workspaces SET state=?,built=0,updatedAt=? WHERE projectId=? AND updatedAt=? AND NOT EXISTS (SELECT 1 FROM runtime_jobs WHERE projectId=? AND status IN ('queued','running'))",
    )
    .run(state, now(), projectId, expectedUpdatedAt, projectId)
}
