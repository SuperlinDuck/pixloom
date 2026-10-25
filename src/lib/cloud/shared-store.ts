import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { db, projectById, StoreError, transaction } from '../store'
import { seal } from './crypto'
import { sharedPoolConfig } from './shared-config'
import type { CloudEnvironment } from './types'

export type SharedApp = {
  projectId: string
  generation: string
  status: string
  error: string | null
}
export type SharedEnvironment = {
  id: string
  projectId: string
  environment: CloudEnvironment
  poolId: string
  namespace: string
  role: string
  password: string
  status: string
  definition: string
  hash: string | null
}
export function sharedApp(projectId: string) {
  return db()
    .prepare('SELECT * FROM cloud_apps_v2 WHERE projectId=?')
    .get(projectId) as SharedApp | undefined
}
export function sharedEnvironment(
  projectId: string,
  environment: CloudEnvironment,
) {
  return db()
    .prepare(
      'SELECT * FROM cloud_environments_v2 WHERE projectId=? AND environment=?',
    )
    .get(projectId, environment) as SharedEnvironment | undefined
}
export function sharedEnvironments(projectId: string) {
  return db()
    .prepare(
      'SELECT * FROM cloud_environments_v2 WHERE projectId=? ORDER BY environment',
    )
    .all(projectId) as SharedEnvironment[]
}
export function environmentConfig(row: SharedEnvironment) {
  const config = sharedPoolConfig(row.environment)
  const pool = db()
    .prepare('SELECT ref FROM cloud_pools WHERE id=?')
    .get(row.poolId) as { ref: string } | undefined
  if (!pool || pool.ref !== config.ref)
    throw new StoreError(
      '共享池配置已变化，拒绝连接其他后端；请恢复原配置或显式迁移',
      409,
    )
  return config
}
export function reserveSharedEnvironment(
  projectId: string,
  environment: CloudEnvironment,
) {
  projectById(projectId)
  const config = sharedPoolConfig(environment)
  return transaction(() => {
    if (
      db().prepare('SELECT 1 FROM cloud_resources WHERE ref=?').get(config.ref)
    )
      throw new StoreError(
        '独立应用使用中的 Supabase 项目不能注册为共享池，请使用专用池项目',
        409,
      )
    const existing = sharedEnvironment(projectId, environment)
    if (existing) {
      environmentConfig(existing)
      return existing
    }
    if (
      db()
        .prepare('SELECT 1 FROM cloud_bindings WHERE projectId=?')
        .get(projectId)
    )
      throw new StoreError('已有独立后端不能自动切换到共享池', 409)
    const installation = (
      db()
        .prepare('SELECT installationId FROM publication_meta WHERE id=1')
        .get() as { installationId: string }
    ).installationId
    const poolId = createHash('sha256')
      .update(installation + ':' + environment + ':' + config.ref)
      .digest('hex')
    db()
      .prepare('INSERT OR IGNORE INTO cloud_pools VALUES (?,?,?,?)')
      .run(poolId, environment, config.ref, new Date().toISOString())
    const count = (
      db()
        .prepare(
          "SELECT count(*) AS n FROM cloud_environments_v2 WHERE poolId=? AND status!='deleted'",
        )
        .get(poolId) as { n: number }
    ).n
    if (count >= config.maxApps) throw new StoreError('共享池应用名额已满', 409)
    db()
      .prepare(
        "INSERT OR IGNORE INTO cloud_apps_v2 VALUES (?,?,'provisioning',NULL,?)",
      )
      .run(projectId, randomUUID(), new Date().toISOString())
    const id = randomUUID()
    const suffix = createHash('sha256')
      .update(installation + ':' + projectId + ':' + environment + ':' + id)
      .digest('hex')
      .slice(0, 32)
    db()
      .prepare(
        "INSERT INTO cloud_environments_v2 (id,projectId,environment,poolId,namespace,role,password,status) VALUES (?,?,?,?,?,?,?,'reserved')",
      )
      .run(
        id,
        projectId,
        environment,
        poolId,
        `px_${suffix}`,
        `pxr_${suffix}`,
        seal(randomBytes(32).toString('hex'), `shared-role:${id}`),
      )
    return sharedEnvironment(projectId, environment)!
  })
}
export function sharedState(
  projectId: string,
  status: string,
  error: string | null = null,
) {
  db()
    .prepare('UPDATE cloud_apps_v2 SET status=?,error=? WHERE projectId=?')
    .run(status, error, projectId)
}
