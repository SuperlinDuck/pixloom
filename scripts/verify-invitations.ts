import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { currentAccount, signInAccount, sessionCookie } from '../src/lib/auth'
import { createInvitation, redeemInvitation } from '../src/lib/tenancy'
import {
  acquireWorker,
  heartbeat,
  createProject,
  enqueueTask,
  claimTask,
  completeBuild,
  db,
} from '../src/lib/store'
import { templateFiles } from '../src/lib/runtime/template'
const require = createRequire(import.meta.url)
async function main() {
  const dist = process.env.PIXLOOM_NEXT_DIST_DIR || '.next'
  assert.ok(
    existsSync(path.join(process.cwd(), dist, 'BUILD_ID')),
    '先运行 pnpm build，使用同一个 PIXLOOM_NEXT_DIST_DIR',
  )
  const directory = await mkdtemp(path.join(tmpdir(), 'pixloom-invitations-'))
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PIXLOOM_DATA_DIR: directory,
    PIXLOOM_PUBLISH_DIR: path.join(directory, 'published'),
    PIXLOOM_AUTH_URL: 'https://pixloom.example',
    PIXLOOM_ADMIN_EMAILS: 'admin@example.com',
    PIXLOOM_GOOGLE_CLIENT_ID: 'fixture-client',
    PIXLOOM_GOOGLE_CLIENT_SECRET: 'fixture-secret',
    GEMINI_API_KEY: '',
    VERTEX_AI_API_KEY: '',
    OPENAI_API_KEY: '',
    PIXLOOM_PUBLISH_ENABLED: '0',
  })
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  process.env.PIXLOOM_AUTH_URL = origin
  function user(name: string, active: boolean) {
    const session = signInAccount({
      subject: `fixture-${name}`,
      name,
      email: `${name}@example.com`,
      picture: null,
    })
    const request = new Request(origin, {
      headers: { cookie: `${sessionCookie}=${session}` },
    })
    const id = currentAccount(request)!.id
    if (active) redeemInvitation(id, createInvitation().code)
    return { id, session }
  }
  const alice = user('alice', true),
    bob = user('bob', true),
    pending = user('pending', false)
  const invitation = createInvitation()
  const project = createProject(
    'Private browser preview',
    await templateFiles(),
    alice.id,
  )
  const secondProject = createProject(
    'Second workspace',
    await templateFiles(),
    alice.id,
  )
  enqueueTask(project.id, 'initialize', 0, null)
  const version = completeBuild(claimTask()!, 'fixture', randomUUID(), [
    {
      path: 'index.html',
      contentType: 'text/html',
      body: Buffer.from('<html><body>Routing preview</body></html>').toString(
        'base64',
      ),
    },
  ])!
  const artifact = randomUUID(),
    base = `/api/previews/${artifact}/`
  db()
    .prepare('INSERT INTO preview_artifacts VALUES (?,?,?,?,?,?)')
    .run(
      artifact,
      project.id,
      'fixture',
      'fixture',
      1000,
      new Date().toISOString(),
    )
  const assets = [
    [
      'index.html',
      'text/html',
      `<html><head><link rel="stylesheet" href="${base}assets/style.css"></head><body><button id="count" type="button">0</button><p id="lazy"></p><script type="module" src="${base}assets/app.js"></script></body></html>`,
    ],
    [
      'assets/app.js',
      'text/javascript',
      `const button=document.querySelector('#count');button.onclick=()=>button.textContent=String(Number(button.textContent)+1);import('${base}assets/lazy.js').then(m=>document.querySelector('#lazy').textContent=m.message)`,
    ],
    [
      'assets/lazy.js',
      'text/javascript',
      `export const message='私有模块已加载'`,
    ],
    ['assets/style.css', 'text/css', '#count{color:rgb(12, 34, 56)}'],
  ]
  for (const [file, type, body] of assets)
    db()
      .prepare('INSERT INTO preview_assets VALUES (?,?,?,?)')
      .run(artifact, file, type, Buffer.from(body))
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
  let pulse: ReturnType<typeof setInterval> | undefined
  try {
    acquireWorker('fixture')
    pulse = setInterval(() => heartbeat('fixture'), 3000)
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
    const owner = await browser.newContext()
    const other = await browser.newContext()
    const entrant = await browser.newContext()
    for (const [context, session] of [
      [owner, alice.session],
      [other, bob.session],
      [entrant, pending.session],
    ] as const) {
      await context.addCookies([
        {
          name: sessionCookie,
          value: session,
          url: origin,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ])
      await context.route('https://**/*', (route) => route.abort())
    }
    const page = await owner.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const openNavigation = async () => {
      if (
        !(await page
          .locator('#project-navigation')
          .evaluate((el) => el.classList.contains('open')))
      )
        await page
          .getByRole('button', { name: '展开侧边栏', exact: true })
          .click()
    }
    const selectProject = async (name: string) => {
      await openNavigation()
      await page.getByRole('button', { name, exact: true }).click()
    }
    assert.equal(
      (await page.goto(`${origin}/preview/${artifact}`))!.status(),
      200,
    )
    const frame = page.frameLocator('iframe')
    await frame.locator('#lazy').waitFor()
    await frame.locator('#count').click()
    assert.equal(await frame.locator('#count').textContent(), '1')
    await page.waitForFunction(
      () => document.querySelector('iframe')?.contentWindow !== null,
    )
    await frame.locator('#lazy').filter({ hasText: '私有模块已加载' }).waitFor()
    assert.equal(
      await frame
        .locator('#count')
        .evaluate((el) => getComputedStyle(el).color),
      'rgb(12, 34, 56)',
    )
    const source = await page.locator('iframe').getAttribute('src')
    assert.ok(source?.includes('/_grant/'))
    assert.equal(
      (
        await other.request.get(`${origin}/api/projects/${project.id}`)
      ).status(),
      404,
    )
    assert.equal(
      (await other.request.get(`${origin}${base}index.html`)).status(),
      404,
    )
    const denied = await other.newPage()
    assert.equal(
      (await denied.goto(`${origin}/preview/${artifact}`))!.status(),
      404,
    )
    const welcome = await entrant.newPage()
    const welcomeResponse = await welcome.goto(origin)
    assert.equal(welcomeResponse!.headers()['x-frame-options'], 'DENY')
    await welcome.locator('#invitation-code').waitFor()
    assert.equal(
      await welcome.getByRole('button', { name: '创建空白项目' }).isDisabled(),
      true,
    )
    await welcome.locator('#invitation-code').fill(invitation.code)
    await welcome
      .getByRole('button', { name: '兑换邀请码', exact: true })
      .click()
    await welcome.waitForFunction(
      () => !document.querySelector('#invitation-code'),
    )
    assert.equal(
      await welcome.getByRole('button', { name: '创建空白项目' }).isEnabled(),
      true,
    )
    assert.equal(
      await welcome.locator('.account-points-balance strong').innerText(),
      '2,000',
    )
    await welcome
      .getByRole('button', { name: '创建空白项目', exact: true })
      .click()
    await welcome.waitForURL(/\/projects\/[a-f0-9-]{36}\/code$/)
    const createdId = new URL(welcome.url()).pathname.split('/')[2]
    assert.equal(
      (
        db()
          .prepare('SELECT ownerId FROM projects WHERE id=?')
          .get(createdId) as { ownerId: string }
      ).ownerId,
      pending.id,
    )
    db().prepare('UPDATE users SET creditLimit=0 WHERE id=?').run(alice.id)
    assert.equal((await owner.request.get(source!)).status(), 200)
    await page.evaluate(
      ([key, id]) => localStorage.setItem(key, id),
      [`pixloom-v3-project:${alice.id}`, project.id],
    )
    const projectPath = `/projects/${project.id}`
    const projectResponse = await page.goto(`${origin}${projectPath}/code`)
    assert.equal(projectResponse!.status(), 200)
    assert.equal(projectResponse!.headers()['x-frame-options'], 'DENY')
    for (const invalidPath of [
      '/projects/not-an-id',
      `${projectPath}/unknown-view`,
    ])
      assert.equal(
        (await owner.request.get(`${origin}${invalidPath}`)).status(),
        404,
      )
    await page
      .getByRole('button', { name: '构建并保存版本', exact: true })
      .waitFor()
    const editor = page.getByRole('textbox', {
      name: '源码 src/App.jsx',
      exact: true,
    })
    await editor.waitFor()
    await page.waitForFunction(
      () =>
        !!document.querySelector<HTMLTextAreaElement>('.source-textarea')
          ?.value,
    )
    const originalSource = await editor.inputValue()
    const editedSource = originalSource + '\n// unsaved route verification'
    await editor.fill(editedSource)
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(
        (button) =>
          button.textContent?.includes('构建并保存版本') && !button.disabled,
      ),
    )
    await page.getByRole('button', { name: '差异', exact: true }).click()
    await page.waitForURL(`${origin}${projectPath}/diff`)
    await page.goBack()
    await page.waitForURL(`${origin}${projectPath}/code`)
    assert.equal(await editor.inputValue(), editedSource)
    await page.goForward()
    await page.waitForURL(`${origin}${projectPath}/diff`)
    await page.getByRole('button', { name: '源码', exact: true }).click()
    assert.equal(await editor.inputValue(), editedSource)
    await selectProject(secondProject.name)
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '取消', exact: true })
      .click()
    assert.equal(new URL(page.url()).pathname, `${projectPath}/code`)
    assert.equal(await editor.inputValue(), editedSource)
    await editor.fill(originalSource)
    await selectProject(secondProject.name)
    await page.waitForURL(`${origin}/projects/${secondProject.id}`)
    await page.goBack()
    await page.waitForURL(`${origin}${projectPath}/code`)
    await page.waitForFunction(
      () =>
        !!document.querySelector<HTMLTextAreaElement>('.source-textarea')
          ?.value,
    )
    await editor.fill(editedSource)
    await page.goForward()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await page.waitForURL(`${origin}${projectPath}/code`)
    assert.equal(await editor.inputValue(), editedSource)
    // Cancellation preserves the Forward entry, so confirmation can retry it.
    await page.goForward()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '确认', exact: true })
      .click()
    await page.waitForURL(`${origin}/projects/${secondProject.id}`)
    await selectProject(project.name)
    for (const [label, suffix] of [
      ['环境', 'runtime'],
      ['云后端', 'cloud'],
      ['发布', 'publish'],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.waitForURL(`${origin}${projectPath}/${suffix}`)
      await page.reload()
      await page
        .locator('.tabs button.active')
        .filter({ hasText: label })
        .waitFor()
    }
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await page.getByRole('button', { name: '版本历史', exact: true }).click()
    await page.locator('.version-item').first().click()
    await page.waitForURL(`${origin}${projectPath}/versions/${version.id}/code`)
    await page.reload()
    await page.getByText('正在查看历史 v1 · 只读', { exact: true }).waitFor()
    assert.equal(await editor.getAttribute('readonly'), '')
    await page.getByRole('button', { name: '返回草稿', exact: true }).click()
    await page.waitForURL(`${origin}${projectPath}/code`)
    // The root URL always opens a new conversation, regardless of old storage.
    const home = await owner.newPage()
    await home.goto(origin)
    await home.getByRole('heading', { name: '你想做一个什么应用？' }).waitFor()
    await home.close()
    const legacy = await owner.newPage()
    await legacy.goto(`${origin}/?cloudProject=${project.id}`)
    await legacy.waitForURL(`${origin}${projectPath}/cloud`)
    await legacy.close()
    await openNavigation()
    await owner.addCookies([
      {
        name: sessionCookie,
        value: bob.session,
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page
      .locator('.account-profile strong')
      .filter({ hasText: 'bob' })
      .waitFor({ state: 'attached' })
    await openNavigation()
    await page.getByRole('alert').filter({ hasText: '项目不存在' }).waitFor()
    assert.equal(await editor.inputValue(), '')
    await owner.addCookies([
      {
        name: sessionCookie,
        value: alice.session,
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page
      .locator('.account-profile strong')
      .filter({ hasText: 'alice' })
      .waitFor({ state: 'attached' })
    await openNavigation()
    const logout = await owner.request.post(`${origin}/api/auth/logout`, {
      data: {},
      headers: { origin },
    })
    assert.equal(logout.status(), 200)
    assert.equal((await owner.request.get(source!)).status(), 403)
    assert.equal(
      (await owner.request.get(`${origin}${base}index.html`)).status(),
      401,
    )
    assert.deepEqual(pageErrors, [])
    console.log(
      'PASS 真实生产 Web + Chromium：项目/视图/历史版本路由、刷新与前进后退、未保存编辑保护、旧 Cloud 链接兼容、邀请码激活、两用户隔离、私有预览交互、额度耗尽后手工构建、退出撤销资源凭证。',
    )
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0]
    if (page) {
      const screenshot = path.join(tmpdir(), 'pixloom-invitations-failure.png')
      await page.screenshot({ path: screenshot }).catch(() => {})
      console.error(`浏览器验收截图：${screenshot}`)
    }
    throw error
  } finally {
    if (pulse) clearInterval(pulse)
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
