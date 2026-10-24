import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  Project,
  ProjectDetail,
  Task,
  TaskEvent,
  Version,
  Provider,
  Usage,
} from './types'

const globalStore = globalThis as unknown as { pixloomDb?: DatabaseSync }
export class StoreError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}
export function db() {
  if (globalStore.pixloomDb) return globalStore.pixloomDb
  const directory = path.resolve(process.env.PIXLOOM_DATA_DIR || '.pixloom')
  mkdirSync(directory, { recursive: true })
  const connection = new DatabaseSync(path.join(directory, 'pixloom.db'))
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, currentVersionId TEXT);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, prompt TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, events TEXT NOT NULL, error TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, usage TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_task ON tasks(projectId) WHERE status IN ('queued','running');
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, taskId TEXT REFERENCES tasks(id), number INTEGER NOT NULL, summary TEXT NOT NULL, html TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(projectId,number));
    CREATE TABLE IF NOT EXISTS worker (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, heartbeat INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runtime_workspaces (projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, state TEXT NOT NULL, built INTEGER NOT NULL, files TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runtime_jobs (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, action TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, events TEXT NOT NULL, error TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_runtime_job ON runtime_jobs(projectId) WHERE status IN ('queued','running');
  `)
  globalStore.pixloomDb = connection
  return connection
}
export function transaction<T>(fn: () => T): T {
  const c = db()
  c.exec('BEGIN IMMEDIATE')
  try {
    const value = fn()
    c.exec('COMMIT')
    return value
  } catch (e) {
    c.exec('ROLLBACK')
    throw e
  }
}
const now = () => new Date().toISOString()
function decodeTask(row: unknown): Task {
  const value = row as Task & { events: string; usage: string | null }
  return {
    ...value,
    events: JSON.parse(value.events),
    usage: value.usage ? JSON.parse(value.usage) : null,
  }
}
export function listProjects(): Project[] {
  return db()
    .prepare('SELECT * FROM projects ORDER BY updatedAt DESC')
    .all() as Project[]
}
export function getProject(id: string): ProjectDetail {
  const project = db().prepare('SELECT * FROM projects WHERE id=?').get(id) as
    Project | undefined
  if (!project) throw new StoreError('项目不存在', 404)
  const tasks = db()
    .prepare('SELECT * FROM tasks WHERE projectId=? ORDER BY createdAt, rowid')
    .all(id)
    .map(decodeTask)
  const versions = db()
    .prepare('SELECT * FROM versions WHERE projectId=? ORDER BY number DESC')
    .all(id) as Version[]
  return { project, tasks, versions }
}
export function createProject(name: string): Project {
  const project: Project = {
    id: randomUUID(),
    name,
    createdAt: now(),
    updatedAt: now(),
    currentVersionId: null,
  }
  db()
    .prepare('INSERT INTO projects VALUES (?,?,?,?,?)')
    .run(project.id, name, project.createdAt, project.updatedAt, null)
  return project
}
export function getTask(id: string): Task {
  const task = db().prepare('SELECT * FROM tasks WHERE id=?').get(id)
  if (!task) throw new StoreError('任务不存在', 404)
  return decodeTask(task)
}
export function createTask(
  projectId: string,
  prompt: string,
  provider: Provider,
  model: string,
): Task {
  return transaction(() => {
    getProject(projectId)
    if (
      db()
        .prepare(
          "SELECT id FROM tasks WHERE projectId=? AND status IN ('queued','running')",
        )
        .get(projectId)
    )
      throw new StoreError('这个项目已有正在执行的任务', 409)
    const id = randomUUID(),
      time = now()
    const events: TaskEvent[] = [
      { at: time, message: '任务已加入队列，等待 Worker' },
    ]
    db()
      .prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        projectId,
        prompt,
        provider,
        model,
        'queued',
        JSON.stringify(events),
        null,
        time,
        time,
        null,
      )
    db()
      .prepare('UPDATE projects SET updatedAt=? WHERE id=?')
      .run(time, projectId)
    return getTask(id)
  })
}
export function addEvent(id: string, message: string) {
  transaction(() => {
    const task = getTask(id)
    if (task.status !== 'running') return
    task.events.push({ at: now(), message })
    db()
      .prepare('UPDATE tasks SET events=?, updatedAt=? WHERE id=?')
      .run(JSON.stringify(task.events), now(), id)
  })
}
export function claimTask(): Task | undefined {
  return transaction(() => {
    const row = db()
      .prepare(
        "SELECT id FROM tasks WHERE status='queued' ORDER BY createdAt LIMIT 1",
      )
      .get() as { id: string } | undefined
    if (!row) return
    db()
      .prepare("UPDATE tasks SET status='running',updatedAt=? WHERE id=?")
      .run(now(), row.id)
    return getTask(row.id)
  })
}
export function failTask(id: string, message: string) {
  transaction(() => {
    const task = getTask(id)
    if (task.status !== 'running') return
    task.events.push({ at: now(), message })
    db()
      .prepare(
        "UPDATE tasks SET status='failed',error=?,events=?,updatedAt=? WHERE id=?",
      )
      .run(message, JSON.stringify(task.events), now(), id)
  })
}
export function cancelTask(id: string): Task {
  return transaction(() => {
    const task = getTask(id)
    if (task.status === 'queued' || task.status === 'running') {
      task.events.push({ at: now(), message: '已取消，保留上一个可用版本' })
      db()
        .prepare(
          "UPDATE tasks SET status='cancelled',events=?,updatedAt=? WHERE id=?",
        )
        .run(JSON.stringify(task.events), now(), id)
    }
    return getTask(id)
  })
}
export function completeTask(
  id: string,
  html: string,
  summary: string,
  usage: Usage,
): Version | null {
  return transaction(() => {
    const task = getTask(id)
    if (task.status !== 'running') return null
    const number = (
      db()
        .prepare(
          'SELECT COALESCE(MAX(number),0)+1 AS n FROM versions WHERE projectId=?',
        )
        .get(task.projectId) as { n: number }
    ).n
    const version: Version = {
      id: randomUUID(),
      projectId: task.projectId,
      taskId: id,
      number,
      summary,
      html,
      createdAt: now(),
    }
    db()
      .prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?)')
      .run(
        version.id,
        version.projectId,
        id,
        number,
        summary,
        html,
        version.createdAt,
      )
    db()
      .prepare('UPDATE projects SET currentVersionId=?,updatedAt=? WHERE id=?')
      .run(version.id, now(), task.projectId)
    task.events.push({
      at: now(),
      message: `静态检查通过，版本 v${number} 已保存`,
    })
    db()
      .prepare(
        "UPDATE tasks SET status='completed',events=?,usage=?,updatedAt=? WHERE id=?",
      )
      .run(JSON.stringify(task.events), JSON.stringify(usage), now(), id)
    return version
  })
}
export function restoreVersion(projectId: string, versionId: string) {
  return transaction(() => {
    const { tasks, versions } = getProject(projectId)
    if (tasks.some((t) => t.status === 'queued' || t.status === 'running'))
      throw new StoreError('请先等待或取消当前任务', 409)
    if (!versions.some((v) => v.id === versionId))
      throw new StoreError('版本不存在', 404)
    db()
      .prepare('UPDATE projects SET currentVersionId=?,updatedAt=? WHERE id=?')
      .run(versionId, now(), projectId)
  })
}
// A lease prevents two Workers from claiming/recovering each other's work.
export function acquireWorker(owner: string): boolean {
  return transaction(() => {
    const row = db().prepare('SELECT * FROM worker WHERE id=1').get() as
      { owner: string; heartbeat: number } | undefined
    if (row && row.owner !== owner && Date.now() - row.heartbeat < 15000)
      return false
    db()
      .prepare('INSERT OR REPLACE INTO worker VALUES (1,?,?)')
      .run(owner, Date.now())
    db()
      .prepare(
        "UPDATE tasks SET status='queued',updatedAt=? WHERE status='running'",
      )
      .run(now())
    db()
      .prepare(
        "UPDATE runtime_jobs SET status='queued',updatedAt=? WHERE status='running'",
      )
      .run(now())
    return true
  })
}
export function heartbeat(owner: string): boolean {
  const result = db()
    .prepare('UPDATE worker SET heartbeat=? WHERE id=1 AND owner=?')
    .run(Date.now(), owner)
  return Number(result.changes) === 1
}
export function releaseWorker(owner: string) {
  db().prepare('DELETE FROM worker WHERE owner=?').run(owner)
}
export function workerOnline() {
  const row = db().prepare('SELECT heartbeat FROM worker WHERE id=1').get() as
    { heartbeat: number } | undefined
  return Boolean(row && Date.now() - row.heartbeat < 15000)
}

export function createExampleProject(name: string, html: string): Project {
  return transaction(() => {
    const project = createProject(name)
    const id = randomUUID()
    db()
      .prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?)')
      .run(
        id,
        project.id,
        null,
        1,
        '内置番茄钟示例（非 AI 生成）：支持专注、休息、暂停与重置。配置模型后可以继续修改。',
        html,
        now(),
      )
    db()
      .prepare('UPDATE projects SET currentVersionId=? WHERE id=?')
      .run(id, project.id)
    return getProject(project.id).project
  })
}
