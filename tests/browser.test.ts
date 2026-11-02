import { describe, expect, it, vi } from 'vitest'
import { verifyBrowser } from '../src/lib/browser'
import { browserTestSchema, type BrowserStep } from '../src/lib/browser-schema'
import type { BuildAsset } from '../src/lib/types'
import { storageClientSource } from '../src/lib/storage-client'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { publishedHeaders } from '../src/lib/publication/gateway'

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
  it('allows scoped reload/reopen and four direction keys, with exact assertions', () => {
    for (const action of ['reload', 'reopen'] as const) {
      expect(
        browserTestSchema.safeParse({
          steps: [
            step(action, '#root'),
            step('assert_text_equals', 'output', '0'),
          ],
        }).success,
      ).toBe(true)
      expect(
        browserTestSchema.safeParse({
          steps: [
            step(action, 'https://example.com'),
            step('assert_visible', '#root'),
          ],
        }).success,
      ).toBe(false)
    }
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
      expect(
        browserTestSchema.safeParse({
          steps: [
            step('press', 'button', key),
            step('assert_visible', '#root'),
          ],
        }).success,
      ).toBe(true)
  })
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
    it('uses native localStorage under published headers and retains data on refresh and reopening', async () => {
      const browser = await chromium.launch({
        chromiumSandbox: true,
        channel:
          process.env.PIXLOOM_BROWSER_CHANNEL === 'chrome' ||
          !existsSync(chromium.executablePath())
            ? 'chrome'
            : undefined,
        env: Object.fromEntries(
          ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) =>
            process.env[key] ? [[key, process.env[key]!]] : [],
          ),
        ),
      })
      try {
        const context = await browser.newContext()
        const files: Record<string, { type: string; body: string }> = {
          '/': {
            type: 'text/html',
            body: '<output>加载</output><button>保存</button><script type="module" src="/app.js"></script>',
          },
          '/storage.js': {
            type: 'application/javascript',
            body: storageClientSource.replaceAll(
              'import.meta.env.BASE_URL',
              '"/"',
            ),
          },
          '/app.js': {
            type: 'application/javascript',
            body: `import {storage} from './storage.js';let count=await storage.get('count',0);const output=document.querySelector('output');output.textContent=count;document.querySelector('button').onclick=async()=>{await storage.set('count',count+1);output.textContent=++count}`,
          },
        }
        await context.route('**/*', (route) => {
          const url = new URL(route.request().url())
          const file =
            url.origin === 'http://127.0.0.1:4173'
              ? files[url.pathname]
              : undefined
          return file
            ? route.fulfill({
                headers: publishedHeaders(file.type),
                body: file.body,
              })
            : route.abort()
        })
        const page = await context.newPage()
        await page.goto('http://127.0.0.1:4173/')
        await page.locator('output:text-is("0")').waitFor()
        await page.locator('button').click()
        await page.locator('output:text-is("1")').waitFor()
        expect(await page.evaluate(() => localStorage.getItem('count'))).toBe(
          '1',
        )
        await page.reload()
        await page.locator('output:text-is("1")').waitFor()
        await page.close()
        const reopened = await context.newPage()
        await reopened.goto('http://127.0.0.1:4173/')
        await reopened.locator('output:text-is("1")').waitFor()
      } finally {
        await browser.close()
      }
    }, 30000)
    it('retains a completed todo across reload/reopen and retains deletion with opaque isolation', async () => {
      const assets = [
        ...source(
          '<input id="title"><button id="add">添加</button><ul></ul><output id="status">加载中</output>',
          `import { storage } from '/api/previews/candidate/storage.js';
          let todos=await storage.get('todos',[]);
          const status=document.querySelector('#status');
          const save=async()=>{await storage.set('todos',todos);render();status.textContent='已保存'};
          function render(){document.querySelector('ul').replaceChildren();for(const todo of todos){const li=document.createElement('li');li.textContent=todo.title;const check=document.createElement('input');check.type='checkbox';check.checked=todo.completed;check.onchange=async()=>{todo.completed=check.checked;await save()};const button=document.createElement('button');button.textContent='删除';button.onclick=async()=>{todos=[];await save()};li.append(check,button);document.querySelector('ul').append(li)}}
          document.querySelector('#add').onclick=async()=>{todos.push({title:document.querySelector('#title').value,completed:false});await save()};
          render();status.textContent='已读取';`,
        ),
        asset(
          'storage.js',
          storageClientSource.replaceAll(
            'import.meta.env.BASE_URL',
            JSON.stringify('/api/previews/candidate/'),
          ),
        ),
      ]
      const report = await run(assets, [
        step('assert_text_equals', '#status', '已读取'),
        step('fill', '#title', '补测保留任务A'),
        step('click', '#add'),
        step('assert_text', 'li', '补测保留任务A'),
        step('check', 'li input'),
        step('assert_checked', 'li input', 'true'),
        step('reload', '#root'),
        step('assert_text', 'li', '补测保留任务A'),
        step('assert_checked', 'li input', 'true'),
        step('reopen', '#root'),
        step('assert_text', 'li', '补测保留任务A'),
        step('assert_checked', 'li input', 'true'),
        step('click', 'li button'),
        step('assert_count', 'li', '0'),
        step('reopen', '#root'),
        step('assert_text_equals', '#status', '已读取'),
        step('assert_count', 'li', '0'),
      ])
      expect(report, report.output).toMatchObject({
        ok: true,
        completedSteps: 17,
      })
    }, 30000)

    it('does not mistake substring matches for exact results, and classifies selector failures as unverified', async () => {
      const assertion = await run(source('<output>10</output>'), [
        step('assert_text_equals', 'output', '0'),
      ])
      expect(assertion).toMatchObject({ ok: false, failureKind: 'application' })
      const selector = await run(
        source('<button>一</button><button>二</button>'),
        [step('click', 'button'), step('assert_visible', '#root')],
      )
      expect(selector).toMatchObject({ ok: false, failureKind: 'test' })
    }, 30000)
    it('announces a loaded candidate while the behavior result is still pending', async () => {
      const onLoaded = vi.fn()
      const report = await verifyBrowser(
        'candidate',
        source(
          '<button>测试</button><output>未点击</output>',
          `document.querySelector('button').onclick=()=>document.querySelector('output').textContent='已点击'`,
        ),
        [step('click', 'button'), step('assert_text', 'output', '已点击')],
        new AbortController().signal,
        undefined,
        { onLoaded },
      )
      expect(onLoaded).toHaveBeenCalledTimes(1)
      expect(report, report.output).toMatchObject({
        ok: true,
        completedSteps: 2,
      })
    }, 30000)

    it('does not announce a candidate with a page loading error', async () => {
      const onLoaded = vi.fn()
      const report = await verifyBrowser(
        'candidate',
        source('页面', `throw new Error('broken loading')`),
        [],
        new AbortController().signal,
        undefined,
        { onLoaded },
      )
      expect(report.ok).toBe(false)
      expect(onLoaded).not.toHaveBeenCalled()
    }, 30000)
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

    it('uses literal full click labels to distinguish shared button selectors', async () => {
      const result = await run(
        source(
          '<button class="btn-primary">保存并同步到云端（全部）</button><button class="btn-primary"><span>保存 [私房]+</span>\n  到云端</button><output>未保存</output>',
          `document.querySelectorAll('button')[1].onclick = () => document.querySelector('output').textContent = '已保存'`,
        ),
        [
          step('click', 'button.btn-primary', ' 保存 [私房]+ 到云端 '),
          step('assert_text', 'output', '已保存'),
        ],
      )
      expect(result, result.output).toMatchObject({
        ok: true,
        completedSteps: 2,
      })
    }, 30000)

    it('preserves strict matching for empty or duplicate click labels', async () => {
      const assets = source(
        '<button>保存</button><button>保存</button><output>未保存</output>',
        `document.querySelectorAll('button').forEach(button => button.onclick = () => document.querySelector('output').textContent = '已保存')`,
      )
      for (const value of ['', '保存']) {
        const result = await run(assets, [
          step('click', 'button', value),
          step('assert_text', 'output', '已保存'),
        ])
        expect(result.ok).toBe(false)
        expect(result.completedSteps).toBe(0)
        expect(result.output).toContain('strict mode violation')
        expect(result.output).toContain('请检查剩余步骤中的同类选择器')
      }
    }, 30000)

    it('explains select ambiguity and accepts a unique container scope', async () => {
      const assets = source(
        '<div><select><option>全部</option></select></div><div class="modal-body"><select><option>冷菜</option><option>热菜</option></select></div>',
      )
      const ambiguous = await run(assets, [
        step('select', 'select:nth-of-type(1)', '热菜'),
        step('assert_value', '.modal-body select', '热菜'),
      ])
      expect(ambiguous.ok).toBe(false)
      expect(ambiguous.completedSteps).toBe(0)
      expect(ambiguous.output).toContain(':nth-of-type(1) 按各自父元素计数')
      const scoped = await run(assets, [
        step('select', '.modal-body select', '热菜'),
        step('assert_value', '.modal-body select', '热菜'),
      ])
      expect(scoped, scoped.output).toMatchObject({
        ok: true,
        completedSteps: 2,
      })
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
