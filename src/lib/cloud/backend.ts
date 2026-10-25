import type { BuildAsset, SourceFile, Task } from '../types'
import { addEvent, db, StoreError } from '../store'
import { prepareCloud, type CloudExecution } from './provision'
import { binding, cloudStatus } from './store'
import { cloudClientSource, CLOUD_CLIENT_PATH } from './client'
import { applySchema, inspectSchema, schemaFromFiles } from './schema'
import { deployFunctions } from './functions'
import { cloudManifest, withCloudConfig } from './manifest'
import type { CloudEnvironment, CloudManifest } from './types'
import { sharedApp, sharedEnvironment } from './shared-store'
import { applySharedSchema, ensureSharedEnvironment } from './shared-db'
import { sharedClientSource } from './shared-client'
import { CloudDefinitionError } from './errors'

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
    {
      path: CLOUD_CLIENT_PATH,
      content: sharedApp(task.projectId)
        ? sharedClientSource
        : cloudClientSource,
    },
  ]
  return {
    ok: true,
    client: CLOUD_CLIENT_PATH,
    schema: 'src/pixloom-schema.json',
    instruction: sharedApp(task.projectId)
      ? '共享池后端：使用 cloud 客户端，登录界面注明“使用 Pixloom Cloud 账号登录”。支持登录、用户隔离的数据库和私有文件，不支持自定义服务端函数。注册后需要邮件确认，再返回原应用登录；会话仅在内存中保存，刷新需要重新登录。'
      : '使用 cloud 客户端；每张表自带 id/owner_id/created_at，用户数据以 RLS 隔离。注册默认需要邮件确认。',
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
  if (sharedApp(projectId)) {
    const app = sharedApp(projectId)!
    if (
      pinned &&
      (pinned.format !== 'pixloom-cloud-v2' ||
        pinned.projectId !== projectId ||
        pinned.generation !== app.generation ||
        sharedEnvironment(projectId, pinned.environment)?.id !==
          pinned.environmentId)
    )
      throw new StoreError(
        '版本绑定的 Cloud 资源已变化，拒绝部署到其他后端',
        409,
      )
    if (files.some((file) => file.path.startsWith('src/backend/')))
      throw new CloudDefinitionError(
        '共享池暂不支持自定义服务端函数，请选择独立后端；不要将服务端功能移到浏览器',
      )
    await ensureSharedEnvironment(projectId, environment, execution)
    await applySharedSchema(
      projectId,
      environment,
      schemaFromFiles(files) || { tables: [], buckets: [] },
      execution,
    )
    return
  }
  const manifest = cloudManifest(projectId, files)
  if (
    manifest.format !== 'pixloom-cloud-v1' ||
    (pinned && pinned.format !== 'pixloom-cloud-v1')
  )
    throw new StoreError('Cloud 版本绑定不匹配', 409)
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
  addEvent(
    task,
    sharedApp(task.projectId)
      ? '准备共享开发环境的数据库和访问权限'
      : '准备开发数据库、权限与后端函数',
    { type: 'build' },
  )
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
  addEvent(task, '准备应用后端环境；已有数据保留')
  await prepareCloud(task.projectId, JSON.parse(row.input), {
    ...execution,
    waitMs: 90000,
  })
  execution.check()
  addEvent(
    task,
    sharedApp(task.projectId)
      ? '共享开发环境已就绪；后续生成可使用登录、数据库和私有文件'
      : '云后端已就绪；后续生成可使用登录、数据库和服务端函数',
  )
}
export { inspectSchema }
