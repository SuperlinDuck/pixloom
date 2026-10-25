import { randomBytes } from 'node:crypto'
import { db, getTask, StoreError } from '../store'
import type { Task } from '../types'
import { projectOrigin } from './config'
import { seal, unseal } from './crypto'
import { resource } from './store'
import { managementToken, type CloudExecution } from './provision'
import { supabaseRequest } from './api'
import { sharedApp } from './shared-store'
import {
  sharedTestAccount,
  cleanupSharedTest,
  redactSharedTest,
} from './shared-testing'

type Account = {
  taskId: string
  projectId: string
  ref: string
  email: string
  password: string
  userId: string | null
  status: string
}
async function adminKey(projectId: string, ref: string, signal: AbortSignal) {
  const token = await managementToken(projectId, signal)
  const keys = await supabaseRequest<
    { name: string; type?: string; api_key: string }[]
  >(token, `/v1/projects/${ref}/api-keys?reveal=true`, { signal })
  const key =
    keys.find((key) => key.type === 'secret') ||
    keys.find((key) => key.name === 'service_role')
  if (!key?.api_key)
    throw new StoreError('创建开发测试账号需要项目 secret key 读取权限', 409)
  return key.api_key
}
async function authAdmin(
  ref: string,
  key: string,
  path: string,
  method: string,
  body: unknown,
  signal: AbortSignal,
) {
  let response: Response
  try {
    response = await fetch(projectOrigin(ref) + '/auth/v1/admin/users' + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new StoreError(
      '开发测试账号操作未确认，可重试；账号清理记录已保留',
      502,
    )
  }
  if (response.status === 404 && method === 'DELETE') return null
  if (!response.ok) {
    await response.body?.cancel()
    throw new StoreError(`开发测试账号操作失败（HTTP ${response.status}）`, 409)
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > 64000)
    throw new StoreError('测试账号响应过大', 502)
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new StoreError('测试账号响应无效', 502)
  }
}
export async function cloudTestAccount(task: Task, execution: CloudExecution) {
  if (sharedApp(task.projectId)) return sharedTestAccount(task, execution)
  execution.check()
  const row = resource(task.projectId, 'development')
  if (row.status !== 'ready' || !row.ref)
    throw new StoreError('开发后端未就绪', 409)
  let account = db()
    .prepare('SELECT * FROM cloud_test_accounts WHERE taskId=?')
    .get(task.id) as Account | undefined
  if (!account) {
    const email = `pixloom-${task.id}@test.invalid`,
      password = randomBytes(24).toString('base64url') + 'aA1!'
    db()
      .prepare("INSERT INTO cloud_test_accounts VALUES (?,?,?,?,?,?,'pending')")
      .run(
        task.id,
        task.projectId,
        row.ref,
        email,
        seal(password, `test-account:${task.id}`),
        null,
      )
    account = db()
      .prepare('SELECT * FROM cloud_test_accounts WHERE taskId=?')
      .get(task.id) as Account
  }
  if (account.ref !== row.ref || !['pending', 'ready'].includes(account.status))
    throw new StoreError('测试账号不再可用', 409)
  const password = unseal(account.password, `test-account:${task.id}`)
  if (!account.userId) {
    const token = await managementToken(task.projectId, execution.signal)
    const existing = await supabaseRequest<{ id: string }[]>(
      token,
      `/v1/projects/${row.ref}/database/query`,
      {
        method: 'POST',
        body: {
          query: `SELECT id FROM auth.users WHERE email='${account.email}' LIMIT 1`,
          read_only: true,
        },
        signal: execution.signal,
      },
    )
    execution.check()
    let userId = existing[0]?.id
    if (!userId) {
      const key = await adminKey(task.projectId, row.ref, execution.signal)
      execution.check()
      const user = await authAdmin(
        row.ref,
        key,
        '',
        'POST',
        { email: account.email, password, email_confirm: true },
        execution.signal,
      )
      userId = user?.id
    }
    if (!/^[a-f0-9-]{36}$/.test(userId || ''))
      throw new StoreError('测试账号创建结果未确认', 502)
    // Record the side effect even if the request was cancelled; only active attempts can use it.
    db()
      .prepare(
        "UPDATE cloud_test_accounts SET userId=?,status='ready' WHERE taskId=?",
      )
      .run(userId, task.id)
  }
  execution.check()
  return {
    email: account.email,
    password,
    environment: 'development',
    instruction:
      '临时开发测试账号，任务结束会删除；勿写入源码或完成说明。用它验证登录后的功能。',
  }
}
export async function cleanupTestAccount(taskId: string) {
  if (db().prepare('SELECT 1 FROM cloud_tests_v2 WHERE taskId=?').get(taskId)) {
    await cleanupSharedTest(taskId)
    return
  }
  const account = db()
    .prepare('SELECT * FROM cloud_test_accounts WHERE taskId=?')
    .get(taskId) as Account | undefined
  if (
    !account ||
    account.status === 'deleted' ||
    ['queued', 'running'].includes(getTask(taskId).status)
  )
    return
  try {
    const signal = AbortSignal.timeout(15000)
    let userId = account.userId
    const token = await managementToken(account.projectId, signal)
    if (!userId) {
      const rows = await supabaseRequest<{ id: string }[]>(
        token,
        `/v1/projects/${account.ref}/database/query`,
        {
          method: 'POST',
          body: {
            query: `SELECT id FROM auth.users WHERE email='${account.email}' LIMIT 1`,
            read_only: true,
          },
          signal,
        },
      )
      userId = rows[0]?.id
    }
    if (userId) {
      if (!/^[a-f0-9-]{36}$/.test(userId))
        throw new Error('invalid test account')
      const key = await adminKey(account.projectId, account.ref, signal)
      // Remove object bytes through Storage API; deleting storage metadata with SQL would orphan the blobs.
      const uploads = await supabaseRequest<
        { bucket_id: string; name: string }[]
      >(token, `/v1/projects/${account.ref}/database/query`, {
        method: 'POST',
        body: {
          query: `SELECT bucket_id,name FROM storage.objects WHERE bucket_id LIKE 'px-${account.projectId.replaceAll('-', '').slice(0, 16)}-%' AND (storage.foldername(name))[1]='${userId}' LIMIT 501`,
          read_only: true,
        },
        signal,
      })
      if (uploads.length > 500)
        throw new Error('test upload cleanup requires review')
      for (const bucket of Array.from(
        new Set(uploads.map((row) => row.bucket_id)),
      )) {
        const prefixes = uploads
          .filter((row) => row.bucket_id === bucket)
          .map((row) => row.name)
        if (!prefixes.every((name) => name.startsWith(userId + '/')))
          throw new Error('invalid test upload prefix')
        const response = await fetch(
          projectOrigin(account.ref) +
            '/storage/v1/object/' +
            encodeURIComponent(bucket),
          {
            method: 'DELETE',
            redirect: 'error',
            signal,
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prefixes }),
          },
        )
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error('test upload cleanup failed')
        }
        await response.body?.cancel()
      }
      await authAdmin(
        account.ref,
        key,
        `/${userId}`,
        'DELETE',
        undefined,
        signal,
      )
    }
    db()
      .prepare(
        "UPDATE cloud_test_accounts SET status='deleted',password='' WHERE taskId=?",
      )
      .run(taskId)
  } catch {
    db()
      .prepare(
        "UPDATE cloud_test_accounts SET status='cleanup_pending' WHERE taskId=?",
      )
      .run(taskId)
  }
}

export function redactTestCredentials(taskId: string, message: string) {
  message = redactSharedTest(taskId, message)
  const row = db()
    .prepare('SELECT email,password FROM cloud_test_accounts WHERE taskId=?')
    .get(taskId) as { email: string; password: string } | undefined
  if (!row) return message
  let result = message.replaceAll(row.email, '[开发测试账号]')
  if (row.password) {
    try {
      result = result.replaceAll(
        unseal(row.password, `test-account:${taskId}`),
        '[测试密码]',
      )
    } catch {
      /* Never expose encrypted data on a decryption failure. */
    }
  }
  return result
}
export function assertNoTestCredentials(
  taskId: string,
  files: { content: string }[],
) {
  for (const file of files)
    if (redactTestCredentials(taskId, file.content) !== file.content)
      throw new StoreError('不要把临时测试账号或密码写入源码')
}
export async function cleanupOrphanedTestAccounts() {
  const rows = db()
    .prepare(
      "SELECT cloud_test_accounts.taskId FROM cloud_test_accounts JOIN tasks ON tasks.id=cloud_test_accounts.taskId WHERE cloud_test_accounts.status!='deleted' AND tasks.status IN ('completed','failed','cancelled') LIMIT 10",
    )
    .all() as { taskId: string }[]
  for (const row of rows) await cleanupTestAccount(row.taskId)
  const sharedRows = db()
    .prepare(
      "SELECT cloud_tests_v2.taskId FROM cloud_tests_v2 JOIN tasks ON tasks.id=cloud_tests_v2.taskId WHERE cloud_tests_v2.status!='deleted' AND tasks.status IN ('completed','failed','cancelled') LIMIT 10",
    )
    .all() as { taskId: string }[]
  for (const row of sharedRows) await cleanupSharedTest(row.taskId)
}
