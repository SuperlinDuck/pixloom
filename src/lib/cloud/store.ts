import { createHash, randomBytes } from 'node:crypto'
import {
  db,
  getProject,
  insertTask,
  projectById,
  StoreError,
  transaction,
} from '../store'
import { configured, managedConfig, projectRef } from './config'
import { seal } from './crypto'
import type {
  CloudBinding,
  CloudEnvironment,
  CloudResource,
  CloudStatus,
} from './types'

export const environments: CloudEnvironment[] = ['development', 'production']
export function binding(projectId: string) {
  projectById(projectId)
  return db()
    .prepare(
      'SELECT projectId,mode,status,error,connectionId FROM cloud_bindings WHERE projectId=?',
    )
    .get(projectId) as CloudBinding | undefined
}
export function resources(projectId: string) {
  return db()
    .prepare(
      'SELECT * FROM cloud_resources WHERE projectId=? ORDER BY environment',
    )
    .all(projectId) as CloudResource[]
}
export function connectionId() {
  return (
    (
      db()
        .prepare('SELECT id FROM cloud_connections ORDER BY rowid DESC LIMIT 1')
        .get() as { id: string } | undefined
    )?.id || null
  )
}
export function cloudStatus(projectId: string): CloudStatus {
  const row = binding(projectId)
  return {
    mode:
      row?.mode ||
      (
        db()
          .prepare('SELECT mode FROM cloud_preferences WHERE projectId=?')
          .get(projectId) as { mode: 'managed' | 'external' } | undefined
      )?.mode ||
      'managed',
    status: row?.status || 'disabled',
    error: row?.error || null,
    managedConfigured: configured('managed'),
    oauthConfigured: configured('oauth'),
    connected: !!connectionId(),
    cleanupPending: (
      db()
        .prepare(
          "SELECT COUNT(*) AS n FROM cloud_test_accounts WHERE projectId=? AND status='cleanup_pending'",
        )
        .get(projectId) as { n: number }
    ).n,
    resources: resources(projectId).map(({ environment, ref, status }) => ({
      environment,
      ref,
      status,
    })),
  }
}
export type SetupInput =
  | { mode: 'managed' }
  | { mode: 'external'; development: string; production: string }
export function reserveBinding(projectId: string, input: SetupInput) {
  return transaction(() => {
    const old = binding(projectId)
    if (old) {
      if (old.mode !== input.mode)
        throw new StoreError(
          '后端已绑定，不能切换提供方；请新建项目以保留原应用数据',
          409,
        )
      if (
        input.mode === 'external' &&
        resources(projectId).some((row) => row.ref !== input[row.environment])
      )
        throw new StoreError('不能替换已绑定的后端项目', 409)
      return old
    }
    const conn = input.mode === 'external' ? connectionId() : null
    if (input.mode === 'external') {
      if (!conn) throw new StoreError('请先授权连接 Supabase', 409)
      projectRef(input.development)
      projectRef(input.production)
      if (input.development === input.production)
        throw new StoreError('开发和生产必须选择不同的 Supabase 项目')
      for (const ref of [input.development, input.production])
        if (
          db()
            .prepare('SELECT projectId FROM cloud_resources WHERE ref=?')
            .get(ref)
        )
          throw new StoreError('此 Supabase 项目已被其他环境或应用使用', 409)
    } else {
      const config = managedConfig()
      const count = (
        db()
          .prepare(
            "SELECT COUNT(*) AS n FROM cloud_resources JOIN cloud_bindings USING(projectId) WHERE mode='managed'",
          )
          .get() as { n: number }
      ).n
      if (count + 2 > config.maxProjects)
        throw new StoreError(
          'Pixloom Cloud 资源已达平台上限，请联系管理员',
          409,
        )
    }
    db()
      .prepare('INSERT INTO cloud_bindings VALUES (?,?,?,?,?,?)')
      .run(
        projectId,
        input.mode,
        'provisioning',
        null,
        conn,
        new Date().toISOString(),
      )
    const installation = (
      db()
        .prepare('SELECT installationId FROM publication_meta WHERE id=1')
        .get() as { installationId: string }
    ).installationId
    for (const environment of environments) {
      const name = `pixloom-${createHash('sha256')
        .update(installation + projectId)
        .digest('hex')
        .slice(0, 20)}-${environment === 'development' ? 'dev' : 'prod'}`
      db()
        .prepare('INSERT INTO cloud_resources VALUES (?,?,?,?,?,?,?)')
        .run(
          projectId,
          environment,
          input.mode === 'external' ? input[environment] : null,
          name,
          'reserved',
          null,
          input.mode === 'managed'
            ? seal(
                randomBytes(32).toString('base64url'),
                `database:${projectId}:${environment}`,
              )
            : null,
        )
    }
    return binding(projectId)!
  })
}
export function enqueueCloudSetup(projectId: string, input: SetupInput) {
  return transaction(() => {
    const state = getProject(projectId)
    const task = insertTask(
      projectId,
      'cloud_setup',
      state.draft.revision,
      state.project.currentVersionId,
    )
    validateSetupInput(projectId, input)
    db()
      .prepare('INSERT INTO cloud_operations VALUES (?,?)')
      .run(task.id, JSON.stringify(input))
    return task
  })
}
function validateSetupInput(projectId: string, input: SetupInput) {
  // Validation here is local only. Worker creates the binding while owning the project lock.
  const old = binding(projectId)
  if (old && old.mode !== input.mode)
    throw new StoreError('不能切换已绑定的后端', 409)
  if (input.mode === 'managed') managedConfig()
  else {
    if (!connectionId()) throw new StoreError('请先授权连接 Supabase', 409)
    projectRef(input.development)
    projectRef(input.production)
    if (input.development === input.production)
      throw new StoreError('开发和生产必须选择不同的 Supabase 项目')
  }
}
export function setBindingState(
  projectId: string,
  status: CloudBinding['status'],
  error: string | null = null,
) {
  db()
    .prepare(
      'UPDATE cloud_bindings SET status=?,error=?,updatedAt=? WHERE projectId=?',
    )
    .run(status, error, new Date().toISOString(), projectId)
}
export function resource(projectId: string, environment: CloudEnvironment) {
  const row = resources(projectId).find(
    (row) => row.environment === environment,
  )
  if (!row) throw new StoreError('云资源尚未分配', 409)
  return row
}
export function assertCloudIdle(projectId: string) {
  projectById(projectId)
  if (
    getProject(projectId).tasks.some(
      (task) => task.status === 'queued' || task.status === 'running',
    )
  )
    throw new StoreError('请先等待项目任务完成', 409)
}

export function setCloudPreference(
  projectId: string,
  mode: 'managed' | 'external',
) {
  return transaction(() => {
    assertCloudIdle(projectId)
    if (binding(projectId))
      throw new StoreError('后端已绑定，不能切换提供方', 409)
    db()
      .prepare(
        'INSERT INTO cloud_preferences VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET mode=excluded.mode',
      )
      .run(projectId, mode)
    return cloudStatus(projectId)
  })
}
