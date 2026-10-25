import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { currentAccount, sessionCookie, signInAccount } from '../src/lib/auth'
import { createProject, db, enqueueTask } from '../src/lib/store'
import {
  createInvitation,
  redeemInvitation,
  usageSummary,
} from '../src/lib/tenancy'
import { templateFiles } from '../src/lib/runtime/template'
import { GET as overviewGET } from '../src/app/api/admin/route'
import { GET as usersGET } from '../src/app/api/admin/users/route'
import {
  GET as invitesGET,
  POST as invitePOST,
} from '../src/app/api/admin/invitations/route'
import { PATCH as invitePATCH } from '../src/app/api/admin/invitations/[id]/route'
import { GET as conversationsGET } from '../src/app/api/admin/conversations/route'
import { GET as conversationGET } from '../src/app/api/admin/conversations/[id]/route'
import { GET as sessionGET } from '../src/app/api/auth/session/route'
import { GET as projectGET } from '../src/app/api/projects/[id]/route'
import type {
  AdminPage,
  AdminUser,
  AdminConversationDetail,
} from '../src/lib/admin-types'

let directory: string
const origin = 'http://127.0.0.1:3000'
function request(
  session = '',
  query = '',
  body?: unknown,
  method = 'POST',
  extraHeaders = {},
) {
  return new Request(origin + '/api/admin' + query, {
    method: body === undefined ? 'GET' : method,
    headers: {
      cookie: `${sessionCookie}=${session}`,
      origin,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function account(name: string, active = false) {
  const session = signInAccount({
    subject: `google-${name}`,
    email: `${name}@example.com`,
    name,
    picture: null,
  })
  const user = currentAccount(request(session))!
  if (active) redeemInvitation(user.id, createInvitation().code)
  return { ...user, session }
}
async function conversation(
  userId: string,
  prompt = '请创建一个待办应用',
  projectName = '测试项目',
) {
  const project = createProject(projectName, await templateFiles(), userId)
  const task = enqueueTask(project.id, 'agent', 0, null, undefined, undefined, {
    prompt,
    provider: 'openai',
    model: 'fixture-model',
    steps: 0,
    toolCalls: 0,
    buildFailures: 0,
    responseBytes: 0,
    reservedOutputTokens: 0,
    startedAt: null,
    usage: { inputTokens: 0, outputTokens: 0 },
  })
  db()
    .prepare("UPDATE tasks SET status='completed',events=? WHERE id=?")
    .run(
      JSON.stringify([
        { at: task.createdAt, type: 'tool', message: 'PRIVATE_TOOL_OUTPUT' },
        { at: task.createdAt, type: 'reply', message: '已创建 **待办应用**。' },
        { at: task.createdAt, type: 'reply', message: '补充回复' },
      ]),
      task.id,
    )
  return { project, task }
}
function ledger(
  taskId: string,
  userId: string,
  status: 'settled' | 'reserved' | 'released',
) {
  db()
    .prepare(
      `INSERT INTO usage_ledger (id,taskId,userId,provider,model,day,inputReserved,outputReserved,creditsReserved,inputTokens,outputTokens,credits,status,createdAt)
    VALUES (?,?,?,'openai','fixture-model',?,100,100,500,?,?,?, ?,?)`,
    )
    .run(
      randomUUID(),
      taskId,
      userId,
      new Date().toISOString().slice(0, 10),
      status === 'settled' ? 100 : status === 'released' ? 0 : null,
      status === 'settled' ? 50 : status === 'released' ? 0 : null,
      status === 'settled' ? 300 : status === 'released' ? 0 : null,
      status,
      Date.now(),
    )
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-admin-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_ID', 'fixture-client')
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', 'fixture-secret')
  vi.stubEnv('PIXLOOM_AUTH_URL', origin)
  vi.stubEnv('PIXLOOM_ADMIN_EMAILS', 'admin@example.com')
  vi.stubEnv('PIXLOOM_AI_ENABLED', '1')
})
afterEach(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('administrator access and invitations', () => {
  it('protects every management endpoint from anonymous, pending and active non-admin users', async () => {
    const pending = account('pending'),
      active = account('alice', true)
    const invite = createInvitation()
    const endpoints = [
      (session: string) => overviewGET(request(session)),
      (session: string) => usersGET(request(session)),
      (session: string) => invitesGET(request(session)),
      (session: string) => invitePOST(request(session, '', {})),
      (session: string) =>
        invitePATCH(request(session, '', { disabled: true }, 'PATCH'), {
          params: { id: invite.id },
        }),
      (session: string) => conversationsGET(request(session)),
      (session: string) =>
        conversationGET(request(session), { params: { id: randomUUID() } }),
    ]
    for (const endpoint of endpoints)
      for (const [session, status] of [
        ['', 401],
        [pending.session, 403],
        [active.session, 403],
      ] as const) {
        const response = await endpoint(session)
        expect(response.status).toBe(status)
        expect(response.headers.get('cache-control')).toBe('no-store')
      }
    expect(
      (await (await sessionGET(request(active.session))).json()).canManage,
    ).toBe(false)
  })
  it('requires the current email allowlist even for existing administrator sessions and local fallback admins', async () => {
    vi.stubEnv(
      'PIXLOOM_ADMIN_EMAILS',
      ' ADMIN@example.com, second@example.com ',
    )
    const admin = account('admin')
    expect((await overviewGET(request(admin.session))).status).toBe(200)
    expect(
      (await (await sessionGET(request(admin.session))).json()).canManage,
    ).toBe(true)
    vi.stubEnv('PIXLOOM_ADMIN_EMAILS', 'second@example.com')
    expect((await overviewGET(request(admin.session))).status).toBe(403)
    expect(
      (await (await sessionGET(request(admin.session))).json()).canManage,
    ).toBe(false)
    vi.stubEnv('PIXLOOM_ADMIN_EMAILS', '')
    expect((await overviewGET(request(admin.session))).status).toBe(403)
    vi.stubEnv('PIXLOOM_ADMIN_EMAILS', 'admin@example.com')
    db().prepare("UPDATE users SET status='disabled' WHERE id=?").run(admin.id)
    expect((await overviewGET(request(admin.session))).status).toBe(403)
    db()
      .prepare("UPDATE users SET status='active',accessExpiresAt=0 WHERE id=?")
      .run(admin.id)
    expect((await overviewGET(request(admin.session))).status).toBe(403)
    db().prepare('DELETE FROM auth_sessions').run()
    expect((await overviewGET(request(admin.session))).status).toBe(401)
    vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', '')
    expect((await overviewGET(request())).status).toBe(503)
  })
  it('creates redeemable invitations, hides secrets in lists and disables unused codes', async () => {
    const admin = account('admin'),
      alice = account('alice')
    const response = await invitePOST(
      request(admin.session, '', {
        label: '首批内测',
        credits: 12345,
        days: 2,
        uses: 2,
        expiresDays: 3,
      }),
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const created = await response.json()
    expect(created.code).toHaveLength(32)
    redeemInvitation(alice.id, created.code)
    expect(usageSummary(alice.id).creditLimit).toBe(12345)
    const list = await (await invitesGET(request(admin.session))).json()
    expect(list.items[0]).toMatchObject({
      label: '首批内测',
      uses: 1,
      maxUses: 2,
    })
    expect(JSON.stringify(list)).not.toContain(created.code)
    expect(list.items[0]).not.toHaveProperty('codeHash')
    expect(
      (
        await invitePATCH(
          request(admin.session, '', { disabled: true }, 'PATCH'),
          { params: { id: created.id } },
        )
      ).status,
    ).toBe(200)
    expect(() => redeemInvitation(account('bob').id, created.code)).toThrow(
      '失效',
    )
  })
  it('rejects cross-site writes, oversized bodies and malformed invitation options without mutation', async () => {
    const admin = account('admin')
    expect(
      (
        await invitePOST(
          request(admin.session, '', {}, 'POST', {
            origin: 'https://evil.example',
          }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await invitePOST(
          request(admin.session, '', {}, 'POST', {
            'Content-Type': 'text/plain',
          }),
        )
      ).status,
    ).toBe(415)
    for (const options of [
      { credits: -1 },
      { uses: 0 },
      { days: 3651 },
      { expiresDays: 0 },
      { credits: 1.5 },
      { code: 'chosen-code' },
      { label: 'x'.repeat(3000) },
    ]) {
      expect([400, 413]).toContain(
        (await invitePOST(request(admin.session, '', options))).status,
      )
    }
    expect(
      db().prepare('SELECT count(*) AS n FROM invitations').get(),
    ).toMatchObject({ n: 0 })
    const invite = createInvitation()
    expect(
      (
        await invitePATCH(
          request(admin.session, '', { disabled: false }, 'PATCH'),
          { params: { id: invite.id } },
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await invitePATCH(
          request(admin.session, '', { disabled: true }, 'PATCH'),
          { params: { id: randomUUID() } },
        )
      ).status,
    ).toBe(404)
  })
})
describe('usage and conversation inspection', () => {
  it('keeps settled consumption, reservations and released calls consistent with the ledger', async () => {
    const admin = account('admin'),
      alice = account('alice', true)
    account('pending')
    const { project, task } = await conversation(alice.id)
    for (const status of ['settled', 'reserved', 'released'] as const)
      ledger(task.id, alice.id, status)
    const overview = await (await overviewGET(request(admin.session))).json()
    expect(overview).toMatchObject({
      users: 3,
      pendingUsers: 1,
      projects: 1,
      turns: 1,
      spentCredits: 300,
      reservedCredits: 500,
      inputTokens: 100,
      outputTokens: 50,
      daily: { used: 800 },
    })
    const users = (await (
      await usersGET(request(admin.session))
    ).json()) as AdminPage<AdminUser>
    expect(users.items[0]).toMatchObject({
      id: alice.id,
      spentCredits: 300,
      reservedCredits: 500,
      remainingCredits: 1_999_200,
      inputTokens: 100,
      outputTokens: 50,
      projects: 1,
      turns: 1,
    })
    expect(users.items[0].remainingCredits).toBe(
      usageSummary(alice.id).remainingCredits,
    )
    expect(users.items.find((user) => user.id === admin.id)?.spentCredits).toBe(
      0,
    )
    expect(users.items[0]).not.toHaveProperty('subject')
    const detail = await (
      await conversationGET(request(admin.session), {
        params: { id: project.id },
      })
    ).json()
    expect(detail.items[0]).toMatchObject({
      spentCredits: 300,
      reservedCredits: 500,
      inputTokens: 100,
      outputTokens: 50,
    })
  })
  it('reads other users conversation history while retaining normal project ownership boundaries', async () => {
    const admin = account('admin'),
      alice = account('alice', true),
      bob = account('bob', true)
    const first = await conversation(
      alice.id,
      '<script>alert(1)</script> 原始用户需求',
      'Alice项目',
    )
    await conversation(bob.id, 'Bob需求', 'Bob项目')
    const list = await (await conversationsGET(request(admin.session))).json()
    expect(list.total).toBe(2)
    const filtered = await (
      await conversationsGET(
        request(admin.session, `?userId=${alice.id}&search=alice`),
      )
    ).json()
    expect(filtered.items).toHaveLength(1)
    expect(filtered.items[0]).toMatchObject({
      id: first.project.id,
      ownerEmail: alice.email,
      turns: 1,
    })
    const response = await conversationGET(request(admin.session), {
      params: { id: first.project.id },
    })
    const detail = (await response.json()) as AdminConversationDetail
    expect(detail.items[0]).toMatchObject({
      prompt: '<script>alert(1)</script> 原始用户需求',
      status: 'completed',
      replies: [{ message: '已创建 **待办应用**。' }, { message: '补充回复' }],
    })
    expect(JSON.stringify(detail)).not.toContain('PRIVATE_TOOL_OUTPUT')
    expect(detail.items[0]).not.toHaveProperty('candidateFiles')
    expect(detail.items[0]).not.toHaveProperty('events')
    expect(
      (
        await projectGET(request(admin.session), {
          params: { id: first.project.id },
        })
      ).status,
    ).toBe(404)
    expect((await usersGET(request(admin.session, '?search=%25'))).status).toBe(
      200,
    )
    expect(
      (await (await usersGET(request(admin.session, '?search=%25'))).json())
        .total,
    ).toBe(0)
  })
  it('paginates every historical turn, including failures and cancellations, with stable ordering', async () => {
    vi.stubEnv('PIXLOOM_TASKS_PER_HOUR', '100')
    const admin = account('admin'),
      alice = account('alice', true)
    const { project, task } = await conversation(alice.id)
    for (let index = 1; index < 32; index++) {
      const next = enqueueTask(
        project.id,
        'agent',
        0,
        null,
        undefined,
        undefined,
        { ...task.agent!, prompt: `需求-${index}` },
      )
      db()
        .prepare('UPDATE tasks SET status=?,error=? WHERE id=?')
        .run(
          index % 2 ? 'failed' : 'cancelled',
          index % 2 ? '测试失败' : null,
          next.id,
        )
    }
    const first = (await (
      await conversationGET(request(admin.session), {
        params: { id: project.id },
      })
    ).json()) as AdminConversationDetail
    const second = (await (
      await conversationGET(request(admin.session, '?page=2'), {
        params: { id: project.id },
      })
    ).json()) as AdminConversationDetail
    expect(first.total).toBe(32)
    expect(first.items).toHaveLength(25)
    expect(second.items).toHaveLength(7)
    expect(first.items[0].id).toBe(task.id)
    expect(second.items.at(-1)).toMatchObject({
      prompt: '需求-31',
      status: 'failed',
      error: '测试失败',
    })
    expect(
      new Set([...first.items, ...second.items].map((turn) => turn.id)).size,
    ).toBe(32)
    for (let index = 0; index < 27; index++)
      createInvitation({ label: `batch-${index}` })
    const invites = await (
      await invitesGET(request(admin.session, '?page=2'))
    ).json()
    expect(invites.items.length).toBe(invites.total - 25)
    expect(
      (
        await conversationGET(request(admin.session), {
          params: { id: randomUUID() },
        })
      ).status,
    ).toBe(404)
  })
  it('rejects invalid pagination, filters and identifiers', async () => {
    const admin = account('admin')
    for (const query of [
      '?page=0',
      '?page=-1',
      '?page=1.5',
      '?page=Infinity',
      '?page=1000001',
      '?search=' + 'a'.repeat(101),
      '?userId=bad-id',
      '?extra=1',
    ]) {
      expect((await usersGET(request(admin.session, query))).status).toBe(400)
    }
    expect(
      (
        await conversationGET(request(admin.session), {
          params: { id: "' OR 1=1" },
        })
      ).status,
    ).toBe(400)
  })
})
