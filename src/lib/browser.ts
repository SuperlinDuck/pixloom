import {
  cloudNetworkAllowed,
  readManifest,
  manifestEndpoint,
} from './cloud/manifest'
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
import { installPreviewAuthBridge } from './cloud/preview-bridge'
import { browserAuth } from './cloud/browser-auth'

export type CloudTransport = (request: {
  url: string
  method: string
  headers: Record<string, string>
  body: Buffer | null
}) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>

export type BrowserVerifier = (
  artifactId: string,
  assets: BuildAsset[],
  steps: BrowserStep[],
  signal: AbortSignal,
  cloudTransport?: CloudTransport,
) => Promise<BrowserReport>

async function perform(
  frame: FrameLocator,
  step: BrowserStep,
  timeout: number,
) {
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
      const deadline = Date.now() + timeout
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
  cloudTransport,
) => {
  if (steps.length) browserTestSchema.parse({ steps })
  if (!/^[a-zA-Z0-9-]+$/.test(artifactId)) throw new Error('预览标识无效')
  const validated = validateAssets(assets)
  const cloud = readManifest(validated.assets)
  const backendOrigin = manifestEndpoint(cloud)
  // Login can include an upstream auth request and subsequent user/data reads.
  // Give those requests time to finish before failing an assertion and closing the browser.
  const stepTimeout = cloud ? 30000 : 2000
  const verificationTimeout = cloud ? 60000 : 25000
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
  let closing = false
  const abort = () => {
    closing = true
    void browser.close().catch(() => {})
  }
  let completedSteps = 0
  const errors: string[] = []
  const record = (message: string) => {
    if (errors.length < 12) errors.push(message.slice(0, 1200))
  }
  const deadline = setTimeout(() => {
    record(`浏览器验证超过 ${verificationTimeout / 1000} 秒时限`)
    abort()
  }, verificationTimeout)
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      viewport: { width: 1280, height: 800 },
    })
    context.setDefaultTimeout(stepTimeout)
    await context.routeWebSocket('**/*', (socket) => socket.close())
    let page: Page
    let bootstrapped = false
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (
        cloud?.format === 'pixloom-cloud-v2' &&
        cloud.authMode === 'persistent-v1' &&
        url.origin === origin &&
        url.pathname.startsWith(`/api/app-auth/${artifactId}/`) &&
        request.frame() === page.mainFrame()
      ) {
        if (cloud.environment === 'production') {
          if (request.method() === 'POST' && url.pathname.endsWith('/resume'))
            return route.fulfill({
              contentType: 'application/json',
              body: 'null',
            })
          record('禁止在生产验证中修改登录状态')
          return route.abort()
        }
        const result = await browserAuth(
          new Request(request.url(), {
            method: request.method(),
            headers: await request.allHeaders(),
            body: request.postData(),
          }),
          cloud,
          origin,
          'browser-verifier',
        )
        return route.fulfill({
          status: result.status,
          headers: Object.fromEntries(result.headers),
          body: Buffer.from(await result.arrayBuffer()),
        })
      }
      if (
        backendOrigin &&
        cloudNetworkAllowed(url, backendOrigin) &&
        ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'].includes(
          request.method(),
        ) &&
        (cloud?.environment !== 'production' ||
          ['GET', 'OPTIONS'].includes(request.method()))
      ) {
        try {
          if ((request.postDataBuffer()?.length || 0) > 1024 * 1024)
            throw new Error('请求过大')
          if (cloudTransport) {
            const response = await cloudTransport({
              url: request.url(),
              method: request.method(),
              headers: request.headers(),
              body: request.postDataBuffer(),
            })
            if (
              (response.status >= 300 && response.status < 400) ||
              response.body.length > 2 * 1024 * 1024
            )
              throw new Error('后端响应无效')
            if (response.status >= 400)
              record(`绑定的 Cloud 请求失败：HTTP ${response.status}`)
            return await route.fulfill(response)
          }
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: 10000,
          })
          if (response.status() >= 300 && response.status() < 400)
            throw new Error('禁止后端重定向')
          const body = await response.body()
          if (body.length > 2 * 1024 * 1024) throw new Error('响应过大')
          if (response.status() >= 400)
            record(`绑定的 Cloud 请求失败：HTTP ${response.status()}`)
          return await route.fulfill({ response, body })
        } catch (error) {
          if (!closing) {
            // Do not expose request headers, credentials, response bodies or raw transport errors.
            const message = error instanceof Error ? error.message : ''
            const reason = /ECONNREFUSED/.test(message)
              ? '无法连接 Cloud 网关，请检查网关进程和地址'
              : /ENOTFOUND|EAI_AGAIN/.test(message)
                ? 'Cloud 网关域名解析失败'
                : /timeout|timed out/i.test(message)
                  ? 'Cloud 请求超时'
                  : /请求过大|响应过大|后端响应无效|禁止后端重定向/.test(
                        message,
                      )
                    ? '请求或响应超过限制，或后端返回了无效响应'
                    : '网络或传输失败'
            record(`绑定的 Cloud 请求失败：${reason}`)
          }
          return route.abort().catch(() => {})
        }
      }
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
            'Content-Security-Policy': `default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ${origin}/api/previews/${artifactId}/ ${origin}/api/app-auth/${artifactId}/`,
          },
          body: `<iframe title="候选预览" sandbox="allow-scripts" style="width:100%;height:760px;border:0" ${cloud?.format === 'pixloom-cloud-v2' && cloud.authMode === 'persistent-v1' ? '' : `src="${prefix}index.html"`}></iframe>${cloud?.format === 'pixloom-cloud-v2' && cloud.authMode === 'persistent-v1' ? `<script>const __name=(value)=>value;(${installPreviewAuthBridge.toString()})(document.querySelector('iframe'),${JSON.stringify(artifactId)})</script>` : ''}`,
        })
      }
      const asset = url.pathname.startsWith(prefix)
        ? validated.assets.find(
            (asset) => `${prefix}${asset.path}` === url.pathname,
          )
        : undefined
      if (
        !asset ||
        (request.frame() === page.mainFrame() &&
          !(
            cloud?.format === 'pixloom-cloud-v2' &&
            cloud.authMode === 'persistent-v1' &&
            asset.path === 'pixloom-cloud.json'
          ))
      ) {
        record('候选页面请求了未提供的资源或尝试离开预览')
        return route.abort()
      }
      return route.fulfill({
        headers: runtimePreviewHeaders(
          new Request(url),
          asset.contentType,
          backendOrigin,
        ),
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
      await perform(frame, step, stepTimeout)
      completedSteps++
    }
    await page.waitForTimeout(150)
  } catch (error) {
    signal.throwIfAborted()
    record((error as Error).message)
  } finally {
    closing = true
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
