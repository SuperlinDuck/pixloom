import type { BuildAsset, SourceFile, Task } from '../types'
import { addEvent, db, StoreError } from '../store'
import { prepareCloud, type CloudExecution } from './provision'
import { binding, cloudStatus } from './store'
import { cloudClientSource, CLOUD_CLIENT_PATH } from './client'
import { applySchema, inspectSchema, schemaFromFiles } from './schema'
import { deployFunctions } from './functions'
import { cloudManifest, withCloudConfig } from './manifest'
import type { CloudEnvironment, CloudManifest } from './types'

export function usesCloud(files: SourceFile[]) {
  return files.some(
    (file) =>
      file.path === CLOUD_CLIENT_PATH ||
      file.path === 'src/pixloom-schema.json' ||
      file.path.startsWith('src/backend/'),
  )
}
export async function enableCloud(task: Task, execution: CloudExecution) {
  const bound = binding(task.projectId)
  if (!bound && cloudStatus(task.projectId).mode === 'external')
    throw new StoreError(
      '已选择自有 Supabase，请先在云后端面板绑定开发与生产项目',
      409,
    )
  if (!bound || (bound.mode === 'managed' && bound.status !== 'ready'))
    await prepareCloud(
      task.projectId,
      { mode: 'managed' },
      { ...execution, waitMs: 90000 },
    )
  else if (bound.status !== 'ready')
    throw new StoreError('自有 Supabase 尚未就绪，请在云后端面板继续准备', 409)
  execution.check()
  task.candidateFiles = [
    ...task.candidateFiles.filter((file) => file.path !== CLOUD_CLIENT_PATH),
    { path: CLOUD_CLIENT_PATH, content: cloudClientSource },
  ]
  return {
    ok: true,
    client: CLOUD_CLIENT_PATH,
    schema: 'src/pixloom-schema.json',
    instruction:
      '使用 cloud 客户端；每张表自带 id/owner_id/created_at，用户数据以 RLS 隔离。注册默认需要邮件确认。',
  }
}
export async function syncBackend(
  projectId: string,
  files: SourceFile[],
  environment: CloudEnvironment,
  execution: CloudExecution,
  pinned?: CloudManifest,
) {
  if (!usesCloud(files)) return
  const manifest = cloudManifest(projectId, files)
  if (
    pinned &&
    (pinned.projectId !== projectId ||
      pinned.mode !== manifest.mode ||
      pinned.development.ref !== manifest.development.ref ||
      pinned.production.ref !== manifest.production.ref)
  )
    throw new StoreError('版本绑定的 Cloud 资源已变化，拒绝部署到其他后端', 409)
  execution.check()
  const schema = schemaFromFiles(files)
  if (schema) await applySchema(projectId, environment, schema, execution)
  await deployFunctions(projectId, environment, files, execution)
  execution.check()
}
export async function prepareCandidate(
  task: Task,
  assets: BuildAsset[],
  execution: CloudExecution,
) {
  if (!usesCloud(task.candidateFiles)) return assets
  addEvent(task, '准备开发数据库、权限与后端函数', { type: 'build' })
  await syncBackend(
    task.projectId,
    task.candidateFiles,
    'development',
    execution,
  )
  return withCloudConfig(assets, task.projectId, task.candidateFiles)
}
export async function runCloudOperation(task: Task, execution: CloudExecution) {
  const row = db()
    .prepare('SELECT input FROM cloud_operations WHERE taskId=?')
    .get(task.id) as { input: string } | undefined
  if (!row) throw new StoreError('缺少后端准备参数', 409)
  addEvent(task, '准备独立开发与生产云资源；已有数据保留')
  await prepareCloud(task.projectId, JSON.parse(row.input), {
    ...execution,
    waitMs: 90000,
  })
  execution.check()
  addEvent(task, '云后端已就绪；后续生成可使用登录、数据库和服务端函数')
}
export { inspectSchema }
