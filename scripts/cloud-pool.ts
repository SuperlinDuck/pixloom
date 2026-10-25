import { loadEnvConfig } from '@next/env'
import { readFile, writeFile } from 'node:fs/promises'
import { sharedPoolConfig } from '../src/lib/cloud/shared-config'
import { sharedEnvironment } from '../src/lib/cloud/shared-store'
import {
  closeSharedConnections,
  poolCapacity,
} from '../src/lib/cloud/shared-db'
import {
  exportSharedEnvironment,
  restoreSharedEnvironment,
  deleteSharedEnvironment,
} from '../src/lib/cloud/shared-lifecycle'
import { assertCloudIdle } from '../src/lib/cloud/store'
import { StoreError } from '../src/lib/store'

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
  const [action, projectId, environment, file, confirmation] =
    process.argv.slice(2)
  if (!['development', 'production'].includes(environment))
    throw new StoreError(
      '用法：pnpm cloud:pool <doctor|export|restore|delete> <应用ID> <development|production> [备份文件路径] [确认环境ID]',
    )
  const env = environment as 'development' | 'production'
  if (action === 'doctor') {
    const config = sharedPoolConfig(env)
    const capacity = await poolCapacity(env)
    console.log(
      JSON.stringify(
        {
          environment: env,
          ref: config.ref,
          gateway: process.env.PIXLOOM_CLOUD_RUNTIME_URL,
          capacity,
          environmentId: sharedEnvironment(projectId, env)?.id || null,
        },
        null,
        2,
      ),
    )
    return
  }
  assertCloudIdle(projectId)
  if (action === 'export' && file) {
    const result = await exportSharedEnvironment(projectId, env)
    await writeFile(file, JSON.stringify(result, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    })
    console.log('应用环境备份已保存，包含业务数据和文件，请妥善保管。')
    return
  }
  if (action === 'restore' && file) {
    const source = await readFile(file)
    if (source.length > 40 * 1024 * 1024) throw new StoreError('备份文件过大')
    console.log(
      await restoreSharedEnvironment(
        projectId,
        env,
        JSON.parse(source.toString()),
      ),
    )
    return
  }
  if (action === 'delete') {
    const row = sharedEnvironment(projectId, env)
    if (!row || file !== '--confirm' || confirmation !== row.id)
      throw new StoreError(
        `删除会清空此应用的 ${environment} 数据和文件；确认后运行：pnpm cloud:pool delete ${projectId} ${environment} --confirm ${row?.id || '<环境ID>'}`,
      )
    console.log(await deleteSharedEnvironment(projectId, env, confirmation))
    return
  }
  throw new StoreError('操作或参数无效')
}
main()
  .catch((error) => {
    console.error(
      error instanceof StoreError
        ? error.message
        : '共享池操作失败，请检查配置、备份格式或服务状态',
    )
    process.exitCode = 1
  })
  .finally(closeSharedConnections)
