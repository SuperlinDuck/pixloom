import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { verifyBrowser, type CloudTransport } from '../src/lib/browser'
import { cloudClientSource } from '../src/lib/cloud/client'
import type { BuildAsset } from '../src/lib/types'
import type { BrowserStep } from '../src/lib/browser-schema'

const dev = 'abcdefghijklmnopqrst',
  prod = 'bcdefghijklmnopqrstu'
const asset = (path: string, body: string): BuildAsset => ({
  path,
  body: Buffer.from(body).toString('base64'),
  contentType: 'ignored',
})
const step = (
  action: BrowserStep['action'],
  selector: string,
  value = '',
): BrowserStep => ({ action, selector, value })

describe.skipIf(process.env.PIXLOOM_CLOUD_TESTS !== '1')(
  'Cloud client in the real opaque-origin browser',
  () => {
    it.each(['managed', 'external'] as const)(
      'logs in, saves and reloads persistent data in %s mode',
      async (mode) => {
        const artifact = randomUUID(),
          prefix = `/api/previews/${artifact}/`
        const rows: { id: string; title: string }[] = []
        const requests: string[] = []
        const transport: CloudTransport = async (request) => {
          requests.push(request.url)
          let status = 200,
            result: unknown
          const url = new URL(request.url)
          if (url.origin !== `https://${dev}.supabase.co`)
            throw new Error('wrong backend')
          if (url.pathname === '/auth/v1/token')
            result = {
              access_token: 'test-user-token',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            }
          else if (url.pathname === '/auth/v1/user') result = { id: 'user-a' }
          else if (url.pathname === '/rest/v1/todos') {
            if (request.headers.authorization !== 'Bearer test-user-token') {
              status = 401
              result = { message: 'Unauthorized' }
            } else if (request.method === 'POST') {
              rows.push({
                id: randomUUID(),
                ...JSON.parse(request.body!.toString()),
              })
              result = rows.slice(-1)
            } else result = rows
          } else throw new Error('unexpected backend path')
          return {
            status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers':
                'apikey,authorization,content-type,prefer',
              'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            },
            body: Buffer.from(JSON.stringify(result)),
          }
        }
        const assets = [
          asset(
            'index.html',
            `<div id="root"><input id="email"><input id="password" type="password"><button id="login" type="button">登录</button><input id="title"><button id="add" type="button">添加</button><ul></ul><output>请登录</output></div><script type="module" src="${prefix}app.js"></script>`,
          ),
          asset(
            'cloud.js',
            cloudClientSource.replace(
              'import.meta.env.BASE_URL',
              JSON.stringify(prefix),
            ),
          ),
          asset(
            'app.js',
            `import {cloud} from './cloud.js';const output=document.querySelector('output');async function render(){const rows=await cloud.select('todos');document.querySelector('ul').replaceChildren(...rows.map(row=>{const li=document.createElement('li');li.textContent=row.title;return li}));output.textContent='已登录'};document.querySelector('#login').onclick=async()=>{await cloud.signIn(document.querySelector('#email').value,document.querySelector('#password').value);await render()};document.querySelector('#add').onclick=async()=>{await cloud.insert('todos',{title:document.querySelector('#title').value});await render()}`,
          ),
          asset(
            'pixloom-cloud.json',
            JSON.stringify({
              format: 'pixloom-cloud-v1',
              projectId: randomUUID(),
              mode,
              environment: 'development',
              development: {
                ref: dev,
                url: `https://${dev}.supabase.co`,
                publishableKey: 'sb_publishable_dev',
              },
              production: {
                ref: prod,
                url: `https://${prod}.supabase.co`,
                publishableKey: 'sb_publishable_prod',
              },
              functions: {},
              buckets: {},
            }),
          ),
        ]
        const login = [
          step('fill', '#email', 'test@example.com'),
          step('fill', '#password', 'test-password'),
          step('click', '#login'),
          step('assert_text', 'output', '已登录'),
        ]
        const first = await verifyBrowser(
          artifact,
          assets,
          [
            ...login,
            step('fill', '#title', '云端待办'),
            step('click', '#add'),
            step('assert_text', 'li', '云端待办'),
          ],
          new AbortController().signal,
          transport,
        )
        expect(first, first.output).toMatchObject({
          ok: true,
          completedSteps: 7,
        })
        // A fresh browser has no old React state or session. Data must be read back from the backend.
        const second = await verifyBrowser(
          artifact,
          assets,
          [...login, step('assert_text', 'li', '云端待办')],
          new AbortController().signal,
          transport,
        )
        expect(second, second.output).toMatchObject({
          ok: true,
          completedSteps: 5,
        })
        expect(rows).toHaveLength(1)
        expect(
          requests.every((url) =>
            url.startsWith(`https://${dev}.supabase.co/`),
          ),
        ).toBe(true)
      },
      60000,
    )
  },
)
