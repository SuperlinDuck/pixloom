import { chromium, type FrameLocator, type Page } from 'playwright'
import { existsSync } from 'node:fs'
import { runtimePreviewHeaders } from './runtime/preview'
import { validateAssets } from './store'
import {
  browserTestSchema,
  type BrowserStep,
  type BrowserReport,
} from './browser-schema'
import type { BuildAsset } from './types'

export type BrowserVerifier = (
  artifactId: string,
  assets: BuildAsset[],
  steps: BrowserStep[],
  signal: AbortSignal,
) => Promise<BrowserReport>

async function perform(frame: FrameLocator, step: BrowserStep) {
  const target = frame.locator(step.selector)
  switch (step.action) {
    case 'click':
      return target.click()
    case 'fill':
      return target.fill(step.value)
    case 'select':
      return target.selectOption({ label: step.value })
    case 'press':
      return target.press(step.value)
    case 'check':
      return target.check()
    case 'uncheck':
      return target.uncheck()
    default: {
      // Assertions retry briefly for React updates without an arbitrary model-supplied script.
      const deadline = Date.now() + 2000
      do {
        let ok = false
        switch (step.action) {
          case 'assert_text':
            ok = (await target.innerText()).includes(step.value)
            break
          case 'assert_count':
            ok = (await target.count()) === Number(step.value)
            break
          case 'assert_visible':
            ok = await target.isVisible()
            break
          case 'assert_hidden':
            ok = await target.isHidden()
            break
          case 'assert_value':
            ok = (await target.inputValue()) === step.value
            break
          case 'assert_checked':
            ok = (await target.isChecked()) === (step.value === 'true')
            break
        }
        if (ok) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      } while (Date.now() < deadline)
      throw new Error(`断言失败：${step.action} ${step.selector} ${step.value}`)
    }
  }
}

// Candidate assets are served entirely by interception, never a host filesystem or web server.
// Each invocation has a fresh browser/profile and the same iframe sandbox/CSP as real previews.
export const verifyBrowser: BrowserVerifier = async (
  artifactId,
  assets,
  steps,
  signal,
) => {
  if (steps.length) browserTestSchema.parse({ steps })
  if (!/^[a-zA-Z0-9-]+$/.test(artifactId)) throw new Error('预览标识无效')
  const validated = validateAssets(assets)
  signal.throwIfAborted()
  const origin = 'http://127.0.0.1:4173'
  const prefix = `/api/previews/${artifactId}/`
  const wrapper = `${origin}/__pixloom_verify__`
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      channel:
        process.env.PIXLOOM_BROWSER_CHANNEL === 'chrome' ||
        !existsSync(chromium.executablePath())
          ? 'chrome'
          : undefined,
      chromiumSandbox: true,
      timeout: 10000,
      // Never pass model credentials to the browser process.
      env: Object.fromEntries(
        ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
    })
  } catch {
    throw new Error(
      '浏览器验证环境不可用，请执行 pnpm browser:install 或安装 Google Chrome；未保存候选版本',
    )
  }
  const abort = () => {
    void browser.close().catch(() => {})
  }
  const deadline = setTimeout(abort, 25000)
  signal.addEventListener('abort', abort, { once: true })
  let completedSteps = 0
  const errors: string[] = []
  const record = (message: string) => {
    if (errors.length < 12) errors.push(message.slice(0, 1200))
  }
  try {
    signal.throwIfAborted()
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      viewport: { width: 1280, height: 800 },
    })
    context.setDefaultTimeout(2000)
    await context.routeWebSocket('**/*', (socket) => socket.close())
    let page: Page
    let bootstrapped = false
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== 'GET' || url.origin !== origin) {
        record('阻止了候选页面的外部请求或非 GET 请求')
        return route.abort()
      }
      if (
        url.href === wrapper &&
        !bootstrapped &&
        request.frame() === page.mainFrame()
      ) {
        bootstrapped = true
        return route.fulfill({
          contentType: 'text/html',
          headers: {
            'Content-Security-Policy': `default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'`,
          },
          body: `<iframe title="候选预览" sandbox="allow-scripts" style="width:100%;height:760px;border:0" src="${prefix}index.html"></iframe>`,
        })
      }
      const asset = url.pathname.startsWith(prefix)
        ? validated.assets.find(
            (asset) => `${prefix}${asset.path}` === url.pathname,
          )
        : undefined
      if (!asset || request.frame() === page.mainFrame()) {
        record('候选页面请求了未提供的资源或尝试离开预览')
        return route.abort()
      }
      return route.fulfill({
        headers: runtimePreviewHeaders(new Request(url), asset.contentType),
        body: asset.body,
      })
    })
    page = await context.newPage()
    page.on('pageerror', (error) => record(`页面异常：${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') record(`控制台错误：${message.text()}`)
    })
    page.on('crash', () => record('候选页面崩溃'))
    context.on('page', (popup) => {
      record('候选页面尝试打开新窗口')
      void popup.close()
    })
    await page.goto(wrapper, { waitUntil: 'load', timeout: 5000 })
    const frame = page.frameLocator('iframe')
    await frame.locator('#root').waitFor({ state: 'visible' })
    if (
      !(await frame.locator('#root').innerText()).trim() &&
      (await frame.locator('#root > *').count()) === 0
    )
      record('React 根节点为空')
    for (const step of steps) {
      signal.throwIfAborted()
      await perform(frame, step)
      completedSteps++
    }
    await page.waitForTimeout(150)
  } catch (error) {
    signal.throwIfAborted()
    record((error as Error).message)
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', abort)
    await browser.close().catch(() => {})
  }
  signal.throwIfAborted()
  return {
    ok: errors.length === 0,
    completedSteps,
    output: errors.length
      ? `浏览器验证失败（完成 ${completedSteps}/${steps.length} 步）：\n${errors.join('\n')}`
      : `浏览器验证通过：页面加载无异常，${completedSteps} 个行为步骤通过（仅覆盖这些步骤）`,
  }
}
