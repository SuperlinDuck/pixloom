import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { snapshot, applyOperations } from './workspace-files'
import type {
  AgentState,
  TaskEvent,
  BuildAsset,
  Draft,
  FileOperation,
  Project,
  ProjectDetail,
  RuntimeInfo,
  SourceFile,
  Task,
  TaskKind,
  Version,
  VersionDetail,
} from './types'

const globalStore = globalThis as unknown as { pixloomDb?: DatabaseSync }
const now = () => new Date().toISOString()
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
  const c = new DatabaseSync(path.join(directory, 'pixloom-v3.db'))
  c.exec(
    'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
  )
  const schema = (
    c.prepare('PRAGMA user_version').get() as { user_version: number }
  ).user_version
  if (schema !== 0 && schema !== 3) {
    c.close()
    throw new Error('工作空间数据库版本不匹配')
  }
  c.exec(`
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,currentVersionId TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_drafts (projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,baseVersionId TEXT,revision INTEGER NOT NULL,files TEXT NOT NULL,hash TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,kind TEXT NOT NULL,status TEXT NOT NULL,baseVersionId TEXT,expectedDraftRevision INTEGER NOT NULL,attemptId TEXT,targetVersionId TEXT,candidateFiles TEXT NOT NULL,resultVersionId TEXT,summary TEXT NOT NULL,events TEXT NOT NULL,error TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_task ON tasks(projectId) WHERE status IN ('queued','running');
    CREATE TABLE IF NOT EXISTS preview_artifacts (id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,sourceHash TEXT NOT NULL,templateId TEXT NOT NULL,bytes INTEGER NOT NULL,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preview_assets (artifactId TEXT NOT NULL REFERENCES preview_artifacts(id) ON DELETE CASCADE,path TEXT NOT NULL,contentType TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(artifactId,path));
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,number INTEGER NOT NULL,parentVersionId TEXT,restoredFromVersionId TEXT,source TEXT NOT NULL,taskId TEXT NOT NULL UNIQUE REFERENCES tasks(id),summary TEXT NOT NULL,files TEXT NOT NULL,hash TEXT NOT NULL,templateId TEXT NOT NULL,artifactId TEXT NOT NULL REFERENCES preview_artifacts(id),createdAt TEXT NOT NULL,UNIQUE(projectId,number));
    CREATE TABLE IF NOT EXISTS runtime_workspaces (projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,state TEXT NOT NULL,loadedHash TEXT,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS draft_backups (id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,baseVersionId TEXT,revision INTEGER NOT NULL,files TEXT NOT NULL,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS worker (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,heartbeat INTEGER NOT NULL);
    PRAGMA user_version=3;
  `)
  if (
    !(c.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).some(
      (column) => column.name === 'agent',
    )
  )
    c.exec('ALTER TABLE tasks ADD COLUMN agent TEXT')
  globalStore.pixloomDb = c
  return c
}
export function transaction<T>(fn: () => T): T {
  const c = db()
  c.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    c.exec('COMMIT')
    return result
  } catch (e) {
    c.exec('ROLLBACK')
    throw e
  }
}
export function projectById(id: string): Project {
  const row = db().prepare('SELECT * FROM projects WHERE id=?').get(id) as
    Project | undefined
  if (!row) throw new StoreError('项目不存在', 404)
  return row
}
export function listProjects(): Project[] {
  return db()
    .prepare('SELECT * FROM projects ORDER BY updatedAt DESC')
    .all() as Project[]
}
export function getDraft(id: string): Draft {
  projectById(id)
  const row = db()
    .prepare('SELECT * FROM workspace_drafts WHERE projectId=?')
    .get(id) as Omit<Draft, 'files'> & { files: string }
  return { ...row, files: JSON.parse(row.files) }
}
export function getVersion(
  projectId: string,
  versionId: string,
): VersionDetail {
  projectById(projectId)
  const row = db()
    .prepare('SELECT * FROM versions WHERE id=? AND projectId=?')
    .get(versionId, projectId) as
    (Omit<VersionDetail, 'files'> & { files: string }) | undefined
  if (!row) throw new StoreError('版本不存在', 404)
  return { ...row, files: JSON.parse(row.files) }
}
export function versionSummaries(
  id: string,
  limit = 50,
  before = Number.MAX_SAFE_INTEGER,
): Version[] {
  projectById(id)
  return db()
    .prepare(
      'SELECT id,projectId,number,parentVersionId,restoredFromVersionId,source,taskId,summary,hash,templateId,artifactId,createdAt FROM versions WHERE projectId=? AND number<? ORDER BY number DESC LIMIT ?',
    )
    .all(id, before, limit) as Version[]
}
export function getRuntime(id: string): RuntimeInfo | null {
  projectById(id)
  return (
    (db()
      .prepare('SELECT * FROM runtime_workspaces WHERE projectId=?')
      .get(id) as RuntimeInfo) || null
  )
}
export function getProject(id: string): ProjectDetail {
  const project = projectById(id),
    { files: _files, ...draft } = getDraft(id)
  const tasks = db()
    .prepare(
      'SELECT * FROM tasks WHERE projectId=? ORDER BY createdAt DESC,rowid DESC LIMIT 30',
    )
    .all(id)
    .map(decodeTask)
    .map(({ candidateFiles: _files, ...task }) => task)
  return {
    project,
    draft,
    tasks,
    versions: versionSummaries(id),
    runtime: getRuntime(id),
  }
}
export function createProject(name: string, files: SourceFile[]): Project {
  const value = snapshot(files)
  return transaction(() => {
    const id = randomUUID(),
      time = now()
    db()
      .prepare('INSERT INTO projects VALUES (?,?,?,?,?)')
      .run(id, name, null, time, time)
    db()
      .prepare('INSERT INTO workspace_drafts VALUES (?,?,?,?,?,?)')
      .run(id, null, 0, JSON.stringify(value.files), value.hash, time)
    return projectById(id)
  })
}
function assertIdle(projectId: string) {
  if (
    db()
      .prepare(
        "SELECT id FROM tasks WHERE projectId=? AND status IN ('queued','running')",
      )
      .get(projectId)
  )
    throw new StoreError('项目已有正在执行的操作，请等待或取消', 409)
}
function assertRevision(projectId: string, revision: number) {
  const draft = getDraft(projectId)
  if (draft.revision !== revision)
    throw new StoreError('草稿已更新，请重新载入后再操作', 409)
  return draft
}
export function updateDraft(
  projectId: string,
  revision: number,
  operations: FileOperation[],
) {
  return transaction(() => {
    assertIdle(projectId)
    const draft = assertRevision(projectId, revision),
      value = applyOperations(draft.files, operations)
    if (value.hash !== draft.hash) {
      db()
        .prepare(
          'UPDATE workspace_drafts SET files=?,hash=?,revision=revision+1,updatedAt=? WHERE projectId=?',
        )
        .run(JSON.stringify(value.files), value.hash, now(), projectId)
      db()
        .prepare('UPDATE projects SET updatedAt=? WHERE id=?')
        .run(now(), projectId)
    }
    assertStorageBudget(projectId)
    return getDraft(projectId)
  })
}
function assertStorageBudget(projectId: string) {
  const sum = (table: string, expression: string) =>
    (
      db()
        .prepare(
          `SELECT COALESCE(SUM(${expression}),0) AS n FROM ${table} WHERE projectId=?`,
        )
        .get(projectId) as { n: number }
    ).n
  const bytes =
    sum('preview_artifacts', 'bytes') +
    sum('versions', 'length(CAST(files AS BLOB))') +
    sum('workspace_drafts', 'length(CAST(files AS BLOB))') +
    sum('draft_backups', 'length(CAST(files AS BLOB))') +
    sum('tasks', 'length(CAST(candidateFiles AS BLOB))')
  if (bytes > 128 * 1024 * 1024)
    throw new StoreError('项目源码与产物超过 128 MiB，请新建项目', 413)
}
export function draftBackups(projectId: string) {
  projectById(projectId)
  return db()
    .prepare(
      'SELECT id,baseVersionId,revision,createdAt FROM draft_backups WHERE projectId=? ORDER BY createdAt DESC LIMIT 20',
    )
    .all(projectId)
}
export function recoverDraftBackup(
  projectId: string,
  backupId: string,
  revision: number,
) {
  return transaction(() => {
    assertIdle(projectId)
    const draft = assertRevision(projectId, revision)
    const backup = db()
      .prepare('SELECT files FROM draft_backups WHERE id=? AND projectId=?')
      .get(backupId, projectId) as { files: string } | undefined
    if (!backup) throw new StoreError('草稿备份不存在', 404)
    const value = snapshot(JSON.parse(backup.files))
    backupDraft(draft)
    db()
      .prepare(
        'UPDATE workspace_drafts SET files=?,hash=?,revision=revision+1,updatedAt=? WHERE projectId=?',
      )
      .run(JSON.stringify(value.files), value.hash, now(), projectId)
    assertStorageBudget(projectId)
    return getDraft(projectId)
  })
}
function backupDraft(draft: Draft) {
  db()
    .prepare('INSERT INTO draft_backups VALUES (?,?,?,?,?,?)')
    .run(
      randomUUID(),
      draft.projectId,
      draft.baseVersionId,
      draft.revision,
      JSON.stringify(draft.files),
      now(),
    )
}
function decodeTask(row: unknown): Task {
  const r = row as Omit<Task, 'candidateFiles' | 'events' | 'agent'> & {
    candidateFiles: string
    events: string
    agent: string | null
  }
  return {
    ...r,
    candidateFiles: JSON.parse(r.candidateFiles),
    events: JSON.parse(r.events),
    agent: r.agent ? JSON.parse(r.agent) : null,
  }
}
export function getTask(id: string) {
  const row = db().prepare('SELECT * FROM tasks WHERE id=?').get(id)
  if (!row) throw new StoreError('任务不存在', 404)
  return decodeTask(row)
}
export function enqueueTask(
  projectId: string,
  kind: TaskKind,
  expectedRevision: number,
  expectedVersionId: string | null,
  targetVersionId?: string,
  summary?: string,
  agent?: AgentState,
): Task {
  return transaction(() => {
    if (kind === 'agent' && !agent) throw new StoreError('缺少模型任务配置')
    const project = projectById(projectId)
    assertIdle(projectId)
    const draft = assertRevision(projectId, expectedRevision)
    if (project.currentVersionId !== expectedVersionId)
      throw new StoreError('当前版本已变化，请刷新后重试', 409)
    const target = targetVersionId
      ? getVersion(projectId, targetVersionId)
      : null
    if ((kind === 'restore' || kind === 'preview') && !target)
      throw new StoreError('缺少目标版本')
    if (kind === 'initialize' && project.currentVersionId)
      throw new StoreError('项目已经初始化', 409)
    if (
      ['initialize', 'commit'].includes(kind) &&
      project.currentVersionId &&
      getVersion(projectId, project.currentVersionId).hash === draft.hash
    )
      throw new StoreError('源码没有变化，无需创建版本', 409)
    if (kind === 'restore' && target?.id === project.currentVersionId)
      throw new StoreError('已经是当前版本', 409)
    const id = randomUUID(),
      time = now()
    const label =
      summary?.trim() ||
      {
        agent: agent?.prompt.slice(0, 500) || 'AI 修改',
        initialize: '创建 React 模板',
        commit: '保存源码修改',
        restore: `恢复版本 v${target?.number}`,
        preview: `构建历史 v${target?.number} 预览`,
        start: '启动环境',
        stop: '停止环境',
        remove: '移除容器',
      }[kind]
    db()
      .prepare(
        'INSERT INTO tasks (id,projectId,kind,status,baseVersionId,expectedDraftRevision,attemptId,targetVersionId,candidateFiles,resultVersionId,summary,events,error,createdAt,updatedAt,agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        projectId,
        kind,
        'queued',
        project.currentVersionId,
        draft.revision,
        null,
        target?.id || null,
        JSON.stringify(target?.files || draft.files),
        null,
        label,
        JSON.stringify([{ at: time, message: '操作已排队，等待 Worker' }]),
        null,
        time,
        time,
        agent ? JSON.stringify(agent) : null,
      )
    assertStorageBudget(projectId)
    return getTask(id)
  })
}
export function claimTask(owner?: string): Task | undefined {
  return transaction(() => {
    if (owner && !ownsWorker(owner)) return
    const row = db()
      .prepare(
        "SELECT id FROM tasks WHERE status='queued' ORDER BY createdAt,rowid LIMIT 1",
      )
      .get() as { id: string } | undefined
    if (!row) return
    db()
      .prepare(
        "UPDATE tasks SET status='running',attemptId=?,updatedAt=? WHERE id=?",
      )
      .run(randomUUID(), now(), row.id)
    return getTask(row.id)
  })
}
export function attemptActive(task: Task, owner?: string) {
  const current = getTask(task.id)
  return (
    current.status === 'running' &&
    current.attemptId === task.attemptId &&
    (!owner || ownsWorker(owner))
  )
}
export function addEvent(
  task: Task,
  message: string,
  metadata: Pick<TaskEvent, 'type' | 'tool'> = {},
) {
  transaction(() => {
    if (!attemptActive(task)) return
    const events = getTask(task.id).events
    events.push({ at: now(), message: message.slice(-16000), ...metadata })
    db()
      .prepare('UPDATE tasks SET events=?,updatedAt=? WHERE id=?')
      .run(JSON.stringify(events.slice(-100)), now(), task.id)
  })
}
export function cancelTask(id: string) {
  transaction(() => {
    db()
      .prepare(
        "UPDATE tasks SET status='cancelled',attemptId=NULL,updatedAt=? WHERE id=? AND status IN ('queued','running')",
      )
      .run(now(), id)
  })
  return getTask(id)
}
export function finishTask(task: Task, error?: string) {
  return transaction(() => {
    if (!attemptActive(task)) return false
    db()
      .prepare('UPDATE tasks SET status=?,error=?,updatedAt=? WHERE id=?')
      .run(error ? 'failed' : 'completed', error || null, now(), task.id)
    return true
  })
}
export function setRuntime(
  projectId: string,
  state: RuntimeInfo['state'],
  loadedHash: string | null = null,
) {
  db()
    .prepare(
      'INSERT INTO runtime_workspaces VALUES (?,?,?,?) ON CONFLICT(projectId) DO UPDATE SET state=excluded.state,loadedHash=excluded.loadedHash,updatedAt=excluded.updatedAt',
    )
    .run(projectId, state, loadedHash, now())
}
export function setRuntimeForTask(
  task: Task,
  state: RuntimeInfo['state'],
  hash: string | null = null,
) {
  return transaction(() => {
    if (!attemptActive(task)) return false
    setRuntime(task.projectId, state, hash)
    return true
  })
}
export function artifactFor(
  projectId: string,
  hash: string,
  templateId: string,
): string | undefined {
  return (
    db()
      .prepare(
        'SELECT id FROM preview_artifacts WHERE projectId=? AND sourceHash=? AND templateId=? ORDER BY createdAt DESC,rowid DESC LIMIT 1',
      )
      .get(projectId, hash, templateId) as { id: string } | undefined
  )?.id
}
export function validateAssets(assets: BuildAsset[]) {
  if (!Array.isArray(assets) || assets.length === 0 || assets.length > 128)
    throw new StoreError('构建资源数量无效', 413)
  const seen = new Set<string>()
  let total = 0
  const output = assets.map((asset) => {
    if (
      typeof asset.path !== 'string' ||
      asset.path.length > 240 ||
      !/^[a-zA-Z0-9_./-]+$/.test(asset.path) ||
      asset.path
        .split('/')
        .some((p) => !p || p === '.' || p === '..' || p.startsWith('.')) ||
      seen.has(asset.path)
    )
      throw new StoreError('构建资源路径无效')
    seen.add(asset.path)
    if (
      typeof asset.body !== 'string' ||
      asset.body.length > Math.ceil((2 * 1024 * 1024) / 3) * 4 ||
      asset.body.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.body)
    )
      throw new StoreError('构建资源内容无效', 413)
    const bytes = Buffer.from(asset.body, 'base64')
    total += bytes.length
    if (bytes.length > 2 * 1024 * 1024 || total > 8 * 1024 * 1024)
      throw new StoreError('构建产物超过大小限制', 413)
    const ext = path.posix.extname(asset.path)
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
      '.woff2': 'font/woff2',
      '.txt': 'text/plain; charset=utf-8',
    }
    return {
      path: asset.path,
      body: bytes,
      contentType: types[ext] || 'application/octet-stream',
    }
  })
  if (!seen.has('index.html')) throw new StoreError('构建产物缺少 index.html')
  return { assets: output, bytes: total }
}
export function completeBuild(
  task: Task,
  templateId: string,
  artifactId: string,
  assets?: BuildAsset[],
  owner?: string,
): VersionDetail | null {
  if (!attemptActive(task, owner)) return null
  const value = snapshot(task.candidateFiles),
    bundle = assets ? validateAssets(assets) : null
  return transaction(() => {
    if (!attemptActive(task, owner)) return null
    const project = projectById(task.projectId),
      draft = getDraft(task.projectId)
    if (
      project.currentVersionId !== task.baseVersionId ||
      draft.revision !== task.expectedDraftRevision
    )
      throw new StoreError('任务基线已失效，结果未提交', 409)
    if (bundle) {
      db()
        .prepare('INSERT INTO preview_artifacts VALUES (?,?,?,?,?,?)')
        .run(
          artifactId,
          task.projectId,
          value.hash,
          templateId,
          bundle.bytes,
          now(),
        )
      const insert = db().prepare('INSERT INTO preview_assets VALUES (?,?,?,?)')
      for (const asset of bundle.assets)
        insert.run(artifactId, asset.path, asset.contentType, asset.body)
    } else if (
      !db()
        .prepare(
          'SELECT id FROM preview_artifacts WHERE id=? AND projectId=? AND sourceHash=? AND templateId=?',
        )
        .get(artifactId, task.projectId, value.hash, templateId)
    )
      throw new StoreError('可复用产物不存在', 409)
    assertStorageBudget(task.projectId)
    if (task.kind === 'preview') {
      db()
        .prepare(
          'UPDATE versions SET artifactId=? WHERE projectId=? AND hash=? AND templateId=?',
        )
        .run(artifactId, task.projectId, value.hash, templateId)
      db()
        .prepare(
          "UPDATE tasks SET status='completed',candidateFiles='[]',updatedAt=? WHERE id=?",
        )
        .run(now(), task.id)
      return null
    }
    const number = (
      db()
        .prepare(
          'SELECT COALESCE(MAX(number),0)+1 AS n FROM versions WHERE projectId=?',
        )
        .get(task.projectId) as { n: number }
    ).n
    const id = randomUUID(),
      time = now(),
      source =
        task.kind === 'initialize'
          ? 'template'
          : task.kind === 'agent'
            ? 'agent'
            : task.kind === 'restore'
              ? 'restore'
              : 'manual'
    db()
      .prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        task.projectId,
        number,
        project.currentVersionId,
        task.kind === 'restore' ? task.targetVersionId : null,
        source,
        task.id,
        task.summary,
        JSON.stringify(value.files),
        value.hash,
        templateId,
        artifactId,
        time,
      )
    if (task.kind === 'restore' && draft.hash !== value.hash) backupDraft(draft)
    db()
      .prepare('UPDATE projects SET currentVersionId=?,updatedAt=? WHERE id=?')
      .run(id, time, task.projectId)
    db()
      .prepare(
        'UPDATE workspace_drafts SET baseVersionId=?,revision=revision+1,files=?,hash=?,updatedAt=? WHERE projectId=?',
      )
      .run(id, JSON.stringify(value.files), value.hash, time, task.projectId)
    const events = getTask(task.id).events.concat({
      at: time,
      message: `构建验证通过，版本 v${number} 已保存`,
    })
    db()
      .prepare(
        "UPDATE tasks SET status='completed',candidateFiles='[]',resultVersionId=?,events=?,updatedAt=? WHERE id=?",
      )
      .run(id, JSON.stringify(events), time, task.id)
    assertStorageBudget(task.projectId)
    return getVersion(task.projectId, id)
  })
}
export function previewAsset(artifactId: string, file: string) {
  const row = db()
    .prepare(
      'SELECT contentType,body FROM preview_assets WHERE artifactId=? AND path=?',
    )
    .get(artifactId, file) as
    { contentType: string; body: Uint8Array } | undefined
  if (!row) throw new StoreError('预览资源不存在', 404)
  return row
}
export function ownsWorker(owner: string) {
  return !!db()
    .prepare('SELECT id FROM worker WHERE owner=? AND heartbeat>?')
    .get(owner, Date.now() - 15000)
}
export function acquireWorker(owner: string) {
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
        "UPDATE tasks SET status='queued',attemptId=NULL,updatedAt=? WHERE status='running'",
      )
      .run(now())
    return true
  })
}
export function heartbeat(owner: string) {
  return (
    Number(
      db()
        .prepare('UPDATE worker SET heartbeat=? WHERE id=1 AND owner=?')
        .run(Date.now(), owner).changes,
    ) === 1
  )
}
export function releaseWorker(owner: string) {
  db().prepare('DELETE FROM worker WHERE owner=?').run(owner)
}
export function workerOnline() {
  return !!db()
    .prepare('SELECT id FROM worker WHERE heartbeat>?')
    .get(Date.now() - 15000)
}

export function checkpointAgent(task: Task, owner?: string) {
  return transaction(() => {
    if (!attemptActive(task, owner)) throw new StoreError('操作已中断', 409)
    const value = snapshot(task.candidateFiles)
    db()
      .prepare(
        'UPDATE tasks SET candidateFiles=?,agent=?,updatedAt=? WHERE id=?',
      )
      .run(
        JSON.stringify(value.files),
        JSON.stringify(task.agent),
        now(),
        task.id,
      )
    assertStorageBudget(task.projectId)
  })
}
