import { createHash } from 'node:crypto'
import { z } from 'zod'
import { db, StoreError } from '../store'
import { cloudSchema } from './schema'
import {
  sharedEnvironment,
  environmentConfig,
  sharedState,
} from './shared-store'
import {
  sharedTransaction,
  closeSharedConnections,
  applySharedSchema,
  quoteIdentifier,
} from './shared-db'
import { boundedBody, storagePath } from './shared-runtime'
import type { CloudEnvironment } from './types'

const backupSchema = z
  .object({
    format: z.literal('pixloom-shared-backup-v1'),
    poolRef: z.string().regex(/^[a-z]{20}$/),
    environment: z.enum(['development', 'production']),
    definition: cloudSchema,
    members: z.array(z.string().uuid()).max(1000),
    tables: z.record(z.array(z.record(z.unknown())).max(100000)),
    files: z
      .array(
        z
          .object({
            userId: z.string().uuid(),
            bucket: z.string(),
            path: z.string(),
            base64: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
function environmentRow(projectId: string, environment: CloudEnvironment) {
  const row = sharedEnvironment(projectId, environment)
  if (!row) throw new StoreError('应用环境不存在', 404)
  environmentConfig(row)
  return row
}
export async function exportSharedEnvironment(
  projectId: string,
  environment: CloudEnvironment,
  signal = AbortSignal.timeout(60000),
) {
  const row = environmentRow(projectId, environment),
    config = environmentConfig(row)
  if (row.status !== 'ready') throw new StoreError('仅能导出已就绪的环境', 409)
  return sharedTransaction(
    environment,
    async (client) => {
      // Quota triggers and file writers take this same lock, keeping records and file objects stable.
      const result = await client.query(
        'SELECT definition FROM pixloom_pool_v2.environments WHERE id=$1 FOR UPDATE',
        [row.id],
      )
      const definition = cloudSchema.parse(result.rows[0].definition)
      const tables: Record<string, unknown[]> = {}
      for (const table of definition.tables)
        tables[table.name] = (
          await client.query(
            `SELECT * FROM ${quoteIdentifier(row.namespace)}.${quoteIdentifier(table.name)} ORDER BY id`,
          )
        ).rows
      const members = (
        await client.query(
          'SELECT user_id FROM pixloom_pool_v2.members WHERE environment_id=$1 ORDER BY user_id',
          [row.id],
        )
      ).rows.map((member) => member.user_id)
      const objects = (
        await client.query(
          'SELECT user_id,bucket,path,state FROM pixloom_pool_v2.files WHERE environment_id=$1',
          [row.id],
        )
      ).rows
      if (objects.some((file) => file.state !== 'ready'))
        throw new StoreError('存在未确认文件操作，请重试或清理后再备份', 409)
      const files = []
      for (const object of objects) {
        signal.throwIfAborted()
        const key = storagePath(row, object.user_id, object.bucket, object.path)
        const response = await fetch(
          config.origin +
            '/storage/v1/object/pixloom-cloud-v2/' +
            key.split('/').map(encodeURIComponent).join('/'),
          {
            headers: {
              apikey: config.serviceKey,
              Authorization: `Bearer ${config.serviceKey}`,
            },
            redirect: 'error',
            signal,
          },
        )
        if (!response.ok) {
          await response.body?.cancel()
          throw new StoreError('备份文件下载失败', 502)
        }
        const bytes = await boundedBody(
          new Request('http://backup', {
            method: 'POST',
            body: response.body,
            duplex: 'half',
          } as RequestInit),
          2097152,
        )
        files.push({
          userId: object.user_id,
          bucket: object.bucket,
          path: object.path,
          base64: bytes.toString('base64'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      }
      return backupSchema.parse({
        format: 'pixloom-shared-backup-v1',
        poolRef: config.ref,
        environment,
        definition,
        members,
        tables,
        files,
      })
    },
    { signal },
  )
}
// Restore into a NEW app namespace in the same pool; never overwrite a live app or copy dev data to prod.
export async function restoreSharedEnvironment(
  projectId: string,
  environment: CloudEnvironment,
  input: unknown,
  signal = AbortSignal.timeout(60000),
) {
  const backup = backupSchema.parse(input)
  if (backup.environment !== environment)
    throw new StoreError('不能跨开发/生产环境恢复业务数据', 409)
  if (sharedEnvironment(projectId, environment))
    throw new StoreError('恢复目标必须是尚未分配环境的新应用', 409)
  await applySharedSchema(projectId, environment, backup.definition, {
    signal,
    check: () => signal.throwIfAborted(),
  })
  const row = environmentRow(projectId, environment),
    config = environmentConfig(row)
  db()
    .prepare("UPDATE cloud_environments_v2 SET status='restoring' WHERE id=?")
    .run(row.id)
  try {
    if (backup.poolRef !== config.ref)
      throw new StoreError('恢复需要原身份池；跨池迁移需单独处理身份映射', 409)
    await sharedTransaction(
      environment,
      async (client) => {
        const identities = await client.query(
          'SELECT id FROM auth.users WHERE id=ANY($1::uuid[])',
          [backup.members],
        )
        if (identities.rowCount !== backup.members.length)
          throw new StoreError('备份包含已经不存在的用户身份', 409)
        for (const member of backup.members)
          await client.query(
            'INSERT INTO pixloom_pool_v2.members VALUES ($1,$2)',
            [row.id, member],
          )
        for (const [name, records] of Object.entries(backup.tables)) {
          const table = backup.definition.tables.find(
            (table) => table.name === name,
          )
          if (!table) throw new StoreError('备份表定义不匹配')
          const columns = [
            'id',
            'owner_id',
            'created_at',
            ...table.columns.map((column) => column.name),
          ]
          for (const record of records) {
            if (
              Object.keys(record).some((key) => !columns.includes(key)) ||
              !backup.members.includes(String(record.owner_id)) ||
              !z.string().uuid().safeParse(record.id).success
            )
              throw new StoreError('备份记录归属或字段无效')
            const keys = Object.keys(record)
            await client.query(
              `INSERT INTO ${quoteIdentifier(row.namespace)}.${quoteIdentifier(name)} (${keys.map(quoteIdentifier).join(',')}) VALUES (${keys.map((_, index) => '$' + (index + 1)).join(',')})`,
              keys.map((key) =>
                table.columns.find((column) => column.name === key)?.type ===
                'jsonb'
                  ? JSON.stringify(record[key])
                  : record[key],
              ),
            )
          }
        }
        let fileBytes = 0
        for (const file of backup.files) {
          const bytes = Buffer.from(file.base64, 'base64')
          storagePath(row, file.userId, file.bucket, file.path)
          if (
            !backup.members.includes(file.userId) ||
            bytes.length > 2097152 ||
            createHash('sha256').update(bytes).digest('hex') !== file.sha256
          )
            throw new StoreError('备份文件校验失败')
          fileBytes += bytes.length
          await client.query(
            "INSERT INTO pixloom_pool_v2.files VALUES ($1,$2,$3,$4,$5,'pending')",
            [row.id, file.userId, file.bucket, file.path, bytes.length],
          )
        }
        if (fileBytes > config.maxFileBytes)
          throw new StoreError('恢复文件超过应用额度', 409)
        await client.query(
          'UPDATE pixloom_pool_v2.environments SET file_bytes=$2 WHERE id=$1',
          [row.id, fileBytes],
        )
      },
      { signal },
    )
    for (const file of backup.files) {
      signal.throwIfAborted()
      const key = storagePath(row, file.userId, file.bucket, file.path)
      const result = await fetch(
        config.origin +
          '/storage/v1/object/pixloom-cloud-v2/' +
          key.split('/').map(encodeURIComponent).join('/'),
        {
          method: 'POST',
          headers: {
            apikey: config.serviceKey,
            Authorization: `Bearer ${config.serviceKey}`,
            'Content-Type': 'application/octet-stream',
            'x-upsert': 'true',
          },
          body: Buffer.from(file.base64, 'base64'),
          redirect: 'error',
          signal,
        },
      )
      if (!result.ok) {
        await result.body?.cancel()
        throw new StoreError('恢复文件未确认，目标环境保持禁用', 502)
      }
      await result.body?.cancel()
      await sharedTransaction(
        environment,
        async (client) => {
          await client.query(
            "UPDATE pixloom_pool_v2.files SET state='ready' WHERE environment_id=$1 AND user_id=$2 AND bucket=$3 AND path=$4",
            [row.id, file.userId, file.bucket, file.path],
          )
        },
        { signal },
      )
    }
    db()
      .prepare("UPDATE cloud_environments_v2 SET status='ready' WHERE id=?")
      .run(row.id)
    sharedState(projectId, 'ready')
    return { ok: true, environmentId: row.id }
  } catch (error) {
    db()
      .prepare(
        "UPDATE cloud_environments_v2 SET status='restore_failed' WHERE id=?",
      )
      .run(row.id)
    sharedState(
      projectId,
      'error',
      '恢复未完成，目标环境已禁用；原应用不受影响',
    )
    throw error
  }
}
export async function deleteSharedEnvironment(
  projectId: string,
  environment: CloudEnvironment,
  confirmation: string,
  signal = AbortSignal.timeout(60000),
) {
  const row = environmentRow(projectId, environment),
    config = environmentConfig(row)
  if (confirmation !== row.id)
    throw new StoreError('删除必须明确确认环境 ID', 409)
  if (row.status === 'deleted') return { ok: true }
  db()
    .prepare("UPDATE cloud_environments_v2 SET status='deleting' WHERE id=?")
    .run(row.id)
  db()
    .prepare('DELETE FROM cloud_sessions_v2 WHERE environmentId=?')
    .run(row.id)
  try {
    await closeSharedConnections()
    await sharedTransaction(
      environment,
      async (client) => {
        const objects = (
          await client.query(
            'SELECT user_id,bucket,path FROM pixloom_pool_v2.files WHERE environment_id=$1',
            [row.id],
          )
        ).rows
        if (objects.length) {
          const prefixes = objects.map((file) =>
            storagePath(row, file.user_id, file.bucket, file.path),
          )
          const result = await fetch(
            config.origin + '/storage/v1/object/pixloom-cloud-v2',
            {
              method: 'DELETE',
              headers: {
                apikey: config.serviceKey,
                Authorization: `Bearer ${config.serviceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ prefixes }),
              redirect: 'error',
              signal,
            },
          )
          if (!result.ok) {
            await result.body?.cancel()
            throw new StoreError('应用文件清理失败', 502)
          }
          await result.body?.cancel()
        }
        await client.query(
          `DROP SCHEMA IF EXISTS ${quoteIdentifier(row.namespace)} CASCADE`,
        )
        await client.query(
          'DELETE FROM pixloom_pool_v2.files WHERE environment_id=$1',
          [row.id],
        )
        await client.query(
          'DELETE FROM pixloom_pool_v2.members WHERE environment_id=$1',
          [row.id],
        )
        await client.query(
          'DELETE FROM pixloom_pool_v2.environments WHERE id=$1',
          [row.id],
        )
        await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(row.role)}`)
      },
      { signal },
    )
    db()
      .prepare(
        "UPDATE cloud_environments_v2 SET status='deleted',password='' WHERE id=?",
      )
      .run(row.id)
    sharedState(projectId, 'error', '应用环境已删除；共享池及其他应用保留')
    return { ok: true }
  } catch (error) {
    db()
      .prepare(
        "UPDATE cloud_environments_v2 SET status='delete_failed' WHERE id=?",
      )
      .run(row.id)
    throw error
  }
}
