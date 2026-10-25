import { describe, expect, it } from 'vitest'
import { verifyBrowser } from '../src/lib/browser'
import { browserTestSchema, type BrowserStep } from '../src/lib/browser-schema'
import type { BuildAsset } from '../src/lib/types'

const asset = (path: string, source: string): BuildAsset => ({
  path,
  contentType: 'ignored',
  body: Buffer.from(source).toString('base64'),
})
const source = (body: string, script = '') => [
  asset(
    'index.html',
    `<html><body><div id="root">${body}</div><script type="module" src="/api/previews/candidate/app.js"></script></body></html>`,
  ),
  asset('app.js', script),
]
const step = (
  action: BrowserStep['action'],
  selector: string,
  value = '',
): BrowserStep => ({ action, selector, value })
const run = (
  assets: BuildAsset[],
  steps: BrowserStep[] = [],
  signal = new AbortController().signal,
) => verifyBrowser('candidate', assets, steps, signal)

describe('browser test input boundaries', () => {
  it('requires an assertion, caps actions and rejects JavaScript and unknown fields', () => {
    expect(
      browserTestSchema.safeParse({ steps: [step('click', 'button')] }).success,
    ).toBe(false)
    expect(
      browserTestSchema.safeParse({
        steps: Array(31).fill(step('assert_visible', '#root')),
      }).success,
    ).toBe(false)
    expect(
      browserTestSchema.safeParse({
        steps: [{ action: 'evaluate', selector: 'body', value: 'alert(1)' }],
      }).success,
    ).toBe(false)
    expect(
      browserTestSchema.safeParse({ steps: [step('assert_count', 'li', '-1')] })
        .success,
    ).toBe(false)
    expect(
      browserTestSchema.safeParse({
        steps: [
          step('press', 'input', 'Control+L'),
          step('assert_visible', '#root'),
        ],
      }).success,
    ).toBe(false)
  })
})

describe.skipIf(process.env.PIXLOOM_BROWSER_TESTS !== '1')(
  'real sandboxed Chromium verification',
  () => {
    it('loads ES modules under the production CSP and verifies state changes', async () => {
      const result = await run(
        source(
          '<button>加一</button><output>0</output>',
          `let count = 0; document.querySelector('button').onclick = () => document.querySelector('output').textContent = String(++count)`,
        ),
        [
          step('assert_text', 'output', '0'),
          step('click', 'button'),
          step('assert_text', 'output', '1'),
        ],
      )
      expect(result, result.output).toMatchObject({
        ok: true,
        completedSteps: 3,
      })
    }, 30000)

    it('reports uncaught runtime errors despite valid build assets', async () => {
      const result = await run(
        source('<h1>已加载</h1>', `throw new Error('broken runtime')`),
      )
      expect(result.ok).toBe(false)
      expect(result.output).toContain('broken runtime')
    }, 30000)

    it('detects console errors, missing resources and failed assertions', async () => {
      const consoleError = await run(
        source('加载', `console.error('render error')`),
      )
      expect(consoleError.ok).toBe(false)
      const missing = await run([
        asset(
          'index.html',
          '<div id="root">页面<script src="/api/previews/candidate/missing.js"></script></div>',
        ),
      ])
      expect(missing.ok).toBe(false)
      const assertion = await run(source('<output>0</output>'), [
        step('assert_text', 'output', '1'),
      ])
      expect(assertion.output).toContain('断言失败')
      expect(assertion.completedSteps).toBe(0)
    }, 30000)

    it('keeps opaque storage isolation and blocks native form submission', async () => {
      const storage = await run(
        source('加载', `localStorage.getItem('secret')`),
      )
      expect(storage.ok).toBe(false)
      expect(storage.output).toMatch(/localStorage|SecurityError/)
      const form = await run(
        source(
          '<form><input><button>添加</button></form><output>未提交</output>',
          `document.querySelector('form').onsubmit = e => { e.preventDefault(); document.querySelector('output').textContent = '已提交' }`,
        ),
        [step('click', 'button'), step('assert_text', 'output', '已提交')],
      )
      expect(form.ok).toBe(false)
      expect(form.completedSteps).toBe(1)
    }, 30000)

    it('prevents external networking and candidate navigation into the host', async () => {
      const result = await run(
        source(
          '加载',
          `window.location.href = 'http://127.0.0.1:3000/api/projects'`,
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.output).toMatch(
        /阻止|离开预览|ERR_FAILED|Content Security Policy/,
      )
    }, 30000)

    it('starts fresh for every run and aborts an in-flight interaction', async () => {
      const assets = source(
        '<input><output>初始</output>',
        `document.querySelector('input').oninput = e => document.querySelector('output').textContent = e.target.value`,
      )
      expect(
        (
          await run(assets, [
            step('fill', 'input', '修改'),
            step('assert_text', 'output', '修改'),
          ])
        ).ok,
      ).toBe(true)
      expect(
        (await run(assets, [step('assert_text', 'output', '初始')])).ok,
      ).toBe(true)
      const controller = new AbortController()
      const pending = run(
        assets,
        [step('click', '#missing'), step('assert_visible', '#root')],
        controller.signal,
      )
      const timer = setTimeout(() => controller.abort(), 400)
      try {
        await expect(pending).rejects.toThrow()
      } finally {
        clearTimeout(timer)
      }
    }, 30000)
  },
)
