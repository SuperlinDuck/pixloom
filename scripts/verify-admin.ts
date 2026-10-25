import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { currentAccount, sessionCookie, signInAccount } from '../src/lib/auth'
import { createInvitation, redeemInvitation } from '../src/lib/tenancy'
import { createProject, db, enqueueTask } from '../src/lib/store'
import { templateFiles } from '../src/lib/runtime/template'

const require = createRequire(import.meta.url)
async function main() {
  const dist = process.env.PIXLOOM_NEXT_DIST_DIR || '.next'
  assert.ok(
    existsSync(path.join(process.cwd(), dist, 'BUILD_ID')),
    '先使用相同的 PIXLOOM_NEXT_DIST_DIR 执行 pnpm build',
  )
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const directory = await mkdtemp(path.join(tmpdir(), 'pixloom-admin-browser-'))
  const origin = `http://127.0.0.1:${port}`
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PIXLOOM_DATA_DIR: directory,
    PIXLOOM_PUBLISH_DIR: path.join(directory, 'published'),
    PIXLOOM_AUTH_URL: origin,
    PIXLOOM_ADMIN_EMAILS: 'admin@example.com',
    PIXLOOM_GOOGLE_CLIENT_ID: 'fixture-client',
    PIXLOOM_GOOGLE_CLIENT_SECRET: 'fixture-secret',
    GEMINI_API_KEY: '',
    VERTEX_AI_API_KEY: '',
    OPENAI_API_KEY: '',
    PIXLOOM_AI_ENABLED: '1',
    PIXLOOM_TASKS_PER_HOUR: '100',
    PIXLOOM_PUBLISH_ENABLED: '0',
  })
  function user(name: string, active = false) {
    const session = signInAccount({
      subject: `admin-fixture-${name}`,
      email: `${name}@example.com`,
      name,
      picture: null,
    })
    const id = currentAccount(
      new Request(origin, {
        headers: { cookie: `${sessionCookie}=${session}` },
      }),
    )!.id
    if (active) redeemInvitation(id, createInvitation().code)
    return { id, session }
  }
  const admin = user('admin'),
    alice = user('alice', true),
    pending = user('pending'),
    blocked = user('blocked')
  const project = createProject('对话验收项目', await templateFiles(), alice.id)
  for (let index = 1; index <= 26; index++) {
    const task = enqueueTask(
      project.id,
      'agent',
      0,
      null,
      undefined,
      undefined,
      {
        prompt:
          index === 1
            ? '第一轮用户需求 <script>window.adminXss=true</script>'
            : `历史需求-${index}`,
        provider: 'openai',
        model: 'fixture-model',
        steps: 0,
        toolCalls: 0,
        buildFailures: 0,
        responseBytes: 0,
        reservedOutputTokens: 0,
        startedAt: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    )
    db()
      .prepare("UPDATE tasks SET status='completed',events=? WHERE id=?")
      .run(
        JSON.stringify([
          {
            at: task.createdAt,
            type: 'reply',
            message: `第 ${index} 轮助手回复：已完成 **修改**。`,
          },
        ]),
        task.id,
      )
  }
  const server = spawn(
    process.execPath,
    [
      require.resolve('next/dist/bin/next'),
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      String(port),
    ],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  server.stdout.on('data', (chunk) => {
    output += chunk
  })
  server.stderr.on('data', (chunk) => {
    output += chunk
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(1000),
        })
        await response.body?.cancel()
        if (response.ok) break
      } catch {}
      assert.ok(
        attempt < 100 && server.exitCode === null,
        `测试 Web 启动失败：${output.slice(-1000)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    browser = await chromium.launch({
      headless: true,
      channel: existsSync(chromium.executablePath()) ? undefined : 'chrome',
      chromiumSandbox: true,
      env: Object.fromEntries(
        ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
    })
    const contexts = await Promise.all(
      [admin, alice, pending, blocked].map(async (account) => {
        const context = await browser!.newContext()
        await context.addCookies([
          {
            name: sessionCookie,
            value: account.session,
            url: origin,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ])
        await context.route('https://**/*', (route) => route.abort())
        return context
      }),
    )
    const [manager, ordinary, entrant, disabledEntrant] = contexts
    const anonymous = await browser.newPage()
    assert.equal((await anonymous.goto(origin + '/admin'))!.status(), 404)
    const other = await ordinary.newPage()
    await other.goto(origin)
    await other.locator('.account-profile').waitFor()
    assert.equal(
      await other
        .getByRole('button', { name: '管理后台', exact: true })
        .count(),
      0,
    )
    assert.equal((await other.goto(origin + '/admin'))!.status(), 404)
    assert.equal(
      (await ordinary.request.get(origin + '/api/admin/users')).status(),
      403,
    )
    const page = await manager.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(origin)
    await page.getByRole('button', { name: '账号菜单', exact: true }).click()
    await page.getByRole('button', { name: '管理后台', exact: true }).click()
    await page.waitForURL(origin + '/admin')
    await page
      .getByRole('heading', { name: '生成邀请码', exact: true })
      .waitFor()
    const secured = await manager.request.get(origin + '/admin')
    assert.equal(secured.status(), 200)
    assert.equal(secured.headers()['x-frame-options'], 'DENY')
    assert.match(secured.headers()['cache-control'], /no-store/)
    await page.getByLabel('备注', { exact: true }).fill('浏览器内测')
    await page.getByLabel('赠送积分', { exact: true }).fill('1234.5')
    await page.getByRole('button', { name: '生成邀请码', exact: true }).click()
    await page.getByLabel('新生成的邀请码').waitFor()
    const code = await page.getByLabel('新生成的邀请码').inputValue()
    assert.equal(code.length, 32)
    const redeemed = await entrant.request.post(
      origin + '/api/auth/invitation',
      { data: { code }, headers: { origin } },
    )
    assert.equal(redeemed.status(), 200)
    const accountData = await (
      await entrant.request.get(origin + '/api/auth/session')
    ).json()
    assert.equal(accountData.usage.creditLimit, 1_234_500)
    await page.getByLabel('备注', { exact: true }).fill('禁用测试')
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/invitations') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '生成邀请码', exact: true }).click()
    const disabledCode = await (await createdResponse).json()
    const row = page.getByRole('row').filter({ hasText: '禁用测试' })
    await row.getByRole('button', { name: '禁用', exact: true }).click()
    await row.getByText('已禁用', { exact: true }).waitFor()
    assert.equal(
      (
        await disabledEntrant.request.post(origin + '/api/auth/invitation', {
          data: { code: disabledCode.code },
          headers: { origin },
        })
      ).status(),
      400,
    )
    await page.getByRole('button', { name: '用户用量', exact: true }).click()
    await page
      .getByRole('textbox', { name: '搜索用户姓名或邮箱' })
      .fill('alice')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page
      .getByRole('row')
      .filter({ hasText: 'alice@example.com' })
      .getByRole('button', { name: '查看对话', exact: true })
      .click()
    await page.getByRole('button').filter({ hasText: '对话验收项目' }).click()
    await page
      .getByText('第一轮用户需求 <script>window.adminXss=true</script>', {
        exact: true,
      })
      .waitFor()
    assert.equal(
      await page.evaluate(
        () => (window as unknown as { adminXss?: boolean }).adminXss,
      ),
      undefined,
    )
    await page.screenshot({
      path: '/tmp/pixloom-admin-desktop.png',
      fullPage: false,
    })
    const transcript = page
      .locator('div')
      .filter({
        has: page.getByRole('heading', { name: '对话验收项目', exact: true }),
      })
      .last()
    await transcript
      .getByRole('button', { name: '下一页', exact: true })
      .first()
      .click()
    await page.getByText('历史需求-26', { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '邀请码', exact: true }).click()
    await page.getByRole('heading', { name: '邀请记录', exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    )
    await page.screenshot({
      path: '/tmp/pixloom-admin-mobile.png',
      fullPage: true,
    })
    assert.deepEqual(errors, [])
    console.log(
      'PASS 管理后台生产 Web + Chromium：页面和接口权限、侧边栏入口、生成/兑换/禁用邀请码、用户筛选、跨用户对话与历史分页、文本安全、移动布局。截图：/tmp/pixloom-admin-desktop.png /tmp/pixloom-admin-mobile.png',
    )
  } finally {
    await browser?.close().catch(() => {})
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve()
      else server.once('exit', () => resolve())
    })
    db().close()
    delete (globalThis as { pixloomDb?: unknown }).pixloomDb
    await rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
