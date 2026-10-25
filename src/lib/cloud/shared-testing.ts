import { randomBytes } from 'node:crypto'
import { db, getTask, StoreError } from '../store'
import { seal, unseal } from './crypto'
import { sharedEnvironment, type SharedEnvironment } from './shared-store'
import { sharedTransaction, quoteIdentifier } from './shared-db'
import { poolRequest } from './shared-auth'
import type { Task } from '../types'
import type { CloudExecution } from './provision'
import { environmentConfig } from './shared-store'
import { cloudSchema } from './schema'

type TestAccount = {
  taskId: string
  environmentId: string
  email: string
  password: string
  userId: string | null
  status: string
}
export async function sharedTestAccount(task: Task, execution: CloudExecution) {
  const row = sharedEnvironment(task.projectId, 'development')
  if (!row || row.status !== 'ready')
    throw new StoreError('共享开发环境未就绪', 409)
  let account = db()
    .prepare('SELECT * FROM cloud_tests_v2 WHERE taskId=?')
    .get(task.id) as TestAccount | undefined
  if (!account) {
    db()
      .prepare("INSERT INTO cloud_tests_v2 VALUES (?,?,?,?,NULL,'pending')")
      .run(
        task.id,
        row.id,
        `pixloom-${task.id}@test.invalid`,
        seal(
          randomBytes(24).toString('base64url') + 'aA1!',
          `shared-test:${task.id}`,
        ),
      )
    account = db()
      .prepare('SELECT * FROM cloud_tests_v2 WHERE taskId=?')
      .get(task.id) as TestAccount
  }
  if (
    account.environmentId !== row.id ||
    !['pending', 'ready'].includes(account.status)
  )
    throw new StoreError('测试账号不可用', 409)
  const password = unseal(account.password, `shared-test:${task.id}`)
  execution.check()
  if (!account.userId) {
    const existing = await sharedTransaction(
      'development',
      async (client) =>
        (
          await client.query(
            'SELECT id,raw_app_meta_data FROM auth.users WHERE email=$1',
            [account!.email],
          )
        ).rows[0],
      { signal: execution.signal },
    )
    let userId = existing?.id
    if (
      existing &&
      (existing.raw_app_meta_data?.pixloom_test_environment !== row.id ||
        existing.raw_app_meta_data?.pixloom_test_task !== task.id)
    )
      throw new StoreError('测试账号归属冲突', 409)
    if (!userId) {
      const user = await poolRequest(row, '/auth/v1/admin/users', {
        admin: true,
        method: 'POST',
        body: {
          email: account.email,
          password,
          email_confirm: true,
          app_metadata: {
            pixloom_test_environment: row.id,
            pixloom_test_task: task.id,
          },
        },
        signal: execution.signal,
      })
      userId = user?.id
    }
    if (!/^[a-f0-9-]{36}$/.test(userId || ''))
      throw new StoreError('测试账号结果未确认', 502)
    db()
      .prepare(
        "UPDATE cloud_tests_v2 SET userId=?,status='ready' WHERE taskId=?",
      )
      .run(userId, task.id)
  }
  execution.check()
  return {
    email: account.email,
    password,
    environment: 'development',
    instruction:
      '临时开发测试账号，仅用于此应用；任务结束清理。不要写入源码或回复。',
  }
}
export async function cleanupSharedTest(taskId: string) {
  const account = db()
    .prepare('SELECT * FROM cloud_tests_v2 WHERE taskId=?')
    .get(taskId) as TestAccount | undefined
  if (
    !account ||
    account.status === 'deleted' ||
    ['queued', 'running'].includes(getTask(taskId).status)
  )
    return
  try {
    const row = db()
      .prepare('SELECT * FROM cloud_environments_v2 WHERE id=?')
      .get(account.environmentId) as SharedEnvironment
    const config = environmentConfig(row)
    const user = await sharedTransaction(
      'development',
      async (client) =>
        (
          await client.query(
            'SELECT id,raw_app_meta_data FROM auth.users WHERE email=$1',
            [account.email],
          )
        ).rows[0],
    )
    if (user) {
      if (
        user.raw_app_meta_data?.pixloom_test_environment !== row.id ||
        user.raw_app_meta_data?.pixloom_test_task !== taskId
      )
        throw new Error('not test owner')
      const files = await sharedTransaction(
        'development',
        async (client) =>
          (
            await client.query(
              'SELECT bucket,path FROM pixloom_pool_v2.files WHERE environment_id=$1 AND user_id=$2',
              [row.id, user.id],
            )
          ).rows,
      )
      if (files.length > 500) throw new Error('cleanup too large')
      if (files.length) {
        const prefixes = files.map(
          (file) => `${row.id}/${user.id}/${file.bucket}/${file.path}`,
        )
        const result = await fetch(
          config.origin + '/storage/v1/object/pixloom-cloud-v2',
          {
            method: 'DELETE',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: {
              apikey: config.serviceKey,
              Authorization: `Bearer ${config.serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prefixes }),
          },
        )
        if (!result.ok) {
          await result.body?.cancel()
          throw new Error('storage cleanup failed')
        }
        await result.body?.cancel()
      }
      const otherMembers = await sharedTransaction(
        'development',
        async (client) => {
          const definition = cloudSchema.parse(JSON.parse(row.definition))
          for (const table of definition.tables)
            await client.query(
              `DELETE FROM ${quoteIdentifier(row.namespace)}.${quoteIdentifier(table.name)} WHERE owner_id=$1`,
              [user.id],
            )
          await client.query(
            'UPDATE pixloom_pool_v2.environments SET file_bytes=file_bytes-COALESCE((SELECT sum(size) FROM pixloom_pool_v2.files WHERE environment_id=$1 AND user_id=$2),0) WHERE id=$1',
            [row.id, user.id],
          )
          await client.query(
            'DELETE FROM pixloom_pool_v2.files WHERE environment_id=$1 AND user_id=$2',
            [row.id, user.id],
          )
          await client.query(
            'DELETE FROM pixloom_pool_v2.members WHERE environment_id=$1 AND user_id=$2',
            [row.id, user.id],
          )
          return (
            await client.query(
              'SELECT 1 FROM pixloom_pool_v2.members WHERE user_id=$1 LIMIT 1',
              [user.id],
            )
          ).rowCount
        },
      )
      db()
        .prepare(
          'DELETE FROM cloud_sessions_v2 WHERE environmentId=? AND userId=?',
        )
        .run(row.id, user.id)
      if (!otherMembers)
        await poolRequest(row, `/auth/v1/admin/users/${user.id}`, {
          admin: true,
          method: 'DELETE',
        })
    }
    db()
      .prepare(
        "UPDATE cloud_tests_v2 SET status='deleted',password='' WHERE taskId=?",
      )
      .run(taskId)
  } catch {
    db()
      .prepare(
        "UPDATE cloud_tests_v2 SET status='cleanup_pending' WHERE taskId=?",
      )
      .run(taskId)
  }
}
export function redactSharedTest(taskId: string, message: string) {
  const row = db()
    .prepare('SELECT email,password FROM cloud_tests_v2 WHERE taskId=?')
    .get(taskId) as { email: string; password: string } | undefined
  if (!row) return message
  let result = message.replaceAll(row.email, '[开发测试账号]')
  if (row.password) {
    try {
      result = result.replaceAll(
        unseal(row.password, `shared-test:${taskId}`),
        '[测试密码]',
      )
    } catch {}
  }
  return result
}
