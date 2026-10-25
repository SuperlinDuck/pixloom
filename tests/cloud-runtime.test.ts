import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { templateFiles } from '../src/lib/runtime/template'
import {
  createProject,
  enqueueTask,
  claimTask,
  getTask,
  getVersion,
  db,
} from '../src/lib/store'
import { runTask } from '../src/lib/runner'
import { verifyBrowser, type CloudTransport } from '../src/lib/browser'
import { prepareCloud } from '../src/lib/cloud/provision'
import { saveConnection } from '../src/lib/cloud/oauth'
import { cloudStatus } from '../src/lib/cloud/store'
import { artifactManifest } from '../src/lib/cloud/manifest'
import type { ModelProvider } from '../src/lib/ai/provider'
import type { BrowserStep } from '../src/lib/browser-schema'

let directory: string
const refs = ['abcdefghijklmnopqrst', 'bcdefghijklmnopqrstu']
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
const step = (
  action: BrowserStep['action'],
  selector: string,
  value = '',
): BrowserStep => ({ action, selector, value })
const source = `import React,{useState} from 'react';import {cloud} from './pixloom-cloud.js';export default function App(){const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[title,setTitle]=useState(''),[rows,setRows]=useState([]),[status,setStatus]=useState('请登录');async function load(){setRows(await cloud.select('todos'));setStatus('已登录')}return <main><h1>云端待办</h1><input id="email" value={email} onChange={e=>setEmail(e.target.value)}/><input id="password" type="password" value={password} onChange={e=>setPassword(e.target.value)}/><button id="login" type="button" onClick={async()=>{await cloud.signIn(email,password);await load()}}>登录</button><output>{status}</output><input id="title" value={title} onChange={e=>setTitle(e.target.value)}/><button id="add" type="button" onClick={async()=>{await cloud.insert('todos',{title});await load()}}>添加</button><ul>{rows.map(row=><li key={row.id}>{row.title}</li>)}</ul></main>}`

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-cloud-runtime-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_AUTH_URL', 'http://127.0.0.1:3000')
  vi.stubEnv('PIXLOOM_CLOUD_ENCRYPTION_KEY', '12'.repeat(32))
  vi.stubEnv('PIXLOOM_CLOUD_LEGACY_PROVISIONING', '1')
  vi.stubEnv('PIXLOOM_SUPABASE_ACCESS_TOKEN', 'fixture-platform-token')
  vi.stubEnv('PIXLOOM_SUPABASE_ORGANIZATION', 'fixture-org')
  vi.stubEnv('PIXLOOM_CLOUD_MAX_PROJECTS', '4')
})
afterEach(async () => {
  const state = globalThis as unknown as { pixloomDb?: { close(): void } }
  state.pixloomDb?.close()
  delete state.pixloomDb
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})
describe.skipIf(process.env.PIXLOOM_CLOUD_RUNTIME_TESTS !== '1')(
  'one Engineer, real Docker, both Cloud modes',
  () => {
    it.each(['managed', 'external'] as const)(
      'generates and verifies an authenticated database app in %s mode',
      async (mode) => {
        const runtime = new DockerRuntime(),
          health = await runtime.health()
        expect(health, health.reason || 'Docker unavailable').toMatchObject({
          available: true,
          imageReady: true,
        })
        const project = createProject(
          'Cloud integration',
          await templateFiles(),
        )
        const projects: {
          id: string
          name: string
          organization_id: string
        }[] = []
        const users = new Map<string, { id: string; password: string }>(),
          rows: { id: string; owner_id: string; title: string }[] = []
        const calls: string[] = []
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async (input: string | URL | Request, init: RequestInit = {}) => {
              const url = new URL(String(input))
              calls.push(url.href)
              const body = init.body ? JSON.parse(String(init.body)) : undefined
              if (url.pathname === '/v1/projects') {
                if (init.method === 'POST') {
                  const row = {
                    id: refs[projects.length],
                    name: body.name,
                    organization_id: body.organization_slug,
                  }
                  projects.push(row)
                  return response(row)
                }
                return response(projects)
              }
              if (url.pathname.endsWith('/health'))
                return response([{ name: 'auth', status: 'ACTIVE_HEALTHY' }])
              if (url.pathname.endsWith('/api-keys'))
                return response([
                  { type: 'publishable', api_key: 'sb_publishable_fixture' },
                  { type: 'secret', api_key: 'sb_secret_fixture' },
                ])
              if (
                url.pathname.endsWith('/config/auth') ||
                url.pathname.endsWith('/database/migrations')
              )
                return response({})
              if (url.pathname.endsWith('/database/query')) {
                if (body.query.startsWith('SELECT id FROM auth.users')) {
                  const email = body.query.match(/email='([^']+)'/)?.[1],
                    user = email && users.get(email)
                  return response(user ? [{ id: user.id }] : [])
                }
                return response([])
              }
              if (
                url.pathname === '/auth/v1/admin/users' &&
                init.method === 'POST'
              ) {
                const user = { id: randomUUID(), password: body.password }
                users.set(body.email, user)
                return response({ id: user.id })
              }
              if (
                url.pathname.startsWith('/auth/v1/admin/users/') &&
                init.method === 'DELETE'
              ) {
                const id = url.pathname.split('/').pop()
                for (const [email, user] of Array.from(users))
                  if (user.id === id) users.delete(email)
                return response({})
              }
              throw new Error('Unexpected fixture API ' + url.href)
            },
          ),
        )
        const transport: CloudTransport = async (request) => {
          const url = new URL(request.url)
          let value: unknown
          if (url.origin !== `https://${refs[0]}.supabase.co`)
            throw new Error('wrong environment')
          if (request.method === 'OPTIONS') value = {}
          else if (url.pathname === '/auth/v1/token') {
            const credentials = JSON.parse(request.body!.toString()),
              user = users.get(credentials.email)
            if (!user || user.password !== credentials.password)
              throw new Error('bad test login')
            value = {
              access_token: user.id,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            }
          } else if (url.pathname === '/rest/v1/todos') {
            const userId = request.headers.authorization?.replace('Bearer ', '')
            if (
              !userId ||
              !Array.from(users.values()).some((user) => user.id === userId)
            )
              throw new Error('unauthorized')
            if (request.method === 'POST')
              rows.push({
                id: randomUUID(),
                owner_id: userId,
                ...JSON.parse(request.body!.toString()),
              })
            value = rows.filter((row) => row.owner_id === userId)
          } else throw new Error('Unexpected app request ' + url.href)
          return {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers':
                'apikey,authorization,content-type,prefer',
              'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            },
            body: Buffer.from(JSON.stringify(value)),
          }
        }
        try {
          if (mode === 'external') {
            saveConnection({
              access_token: 'fixture-user-token',
              refresh_token: 'fixture-refresh',
              expires_in: 3600,
            })
            projects.push(
              { id: refs[0], name: 'user dev', organization_id: 'user-org' },
              { id: refs[1], name: 'user prod', organization_id: 'user-org' },
            )
            await prepareCloud(
              project.id,
              { mode, development: refs[0], production: refs[1] },
              { signal: new AbortController().signal, check() {} },
            )
          }
          let phase = 0,
            credentials: { email: string; password: string } | undefined
          const provider: ModelProvider = {
            createSession: () => ({
              next: async (inputs) => {
                for (const input of inputs)
                  if (input.type === 'tool' && input.id === 'account')
                    credentials = JSON.parse(input.output)
                const calls =
                  ++phase === 1
                    ? [{ id: 'enable', name: 'cloud_enable', arguments: {} }]
                    : phase === 2
                      ? [
                          {
                            id: 'account',
                            name: 'cloud_test_account',
                            arguments: {},
                          },
                        ]
                      : phase === 3
                        ? [
                            {
                              id: 'schema',
                              name: 'write_file',
                              arguments: {
                                path: 'src/pixloom-schema.json',
                                content: JSON.stringify({
                                  tables: [
                                    {
                                      name: 'todos',
                                      columns: [
                                        { name: 'owner_id', type: 'text' },
                                      ],
                                    },
                                  ],
                                }),
                              },
                            },
                            {
                              id: 'app',
                              name: 'write_file',
                              arguments: {
                                path: 'src/App.jsx',
                                content: source,
                              },
                            },
                            { id: 'build', name: 'build', arguments: {} },
                          ]
                        : phase === 4
                          ? [
                              {
                                id: 'schema-fix',
                                name: 'write_file',
                                arguments: {
                                  path: 'src/pixloom-schema.json',
                                  content: JSON.stringify({
                                    tables: [
                                      {
                                        name: 'todos',
                                        columns: [
                                          { name: 'title', type: 'text' },
                                        ],
                                      },
                                    ],
                                  }),
                                },
                              },
                              {
                                id: 'build-fixed',
                                name: 'build',
                                arguments: {},
                              },
                            ]
                          : phase === 5
                            ? [
                                {
                                  id: 'browser',
                                  name: 'browser_test',
                                  arguments: {
                                    steps: [
                                      step(
                                        'fill',
                                        '#email',
                                        credentials!.email,
                                      ),
                                      step(
                                        'fill',
                                        '#password',
                                        credentials!.password,
                                      ),
                                      step('click', '#login'),
                                      step('assert_text', 'output', '已登录'),
                                      step(
                                        'fill',
                                        '#title',
                                        '真实构建云端任务',
                                      ),
                                      step('click', '#add'),
                                      step(
                                        'assert_text',
                                        'li',
                                        '真实构建云端任务',
                                      ),
                                    ],
                                  },
                                },
                              ]
                            : []
                return {
                  text: phase >= 6 ? '已完成登录和持久化待办。' : '',
                  calls,
                  usage: { inputTokens: 0, outputTokens: 0 },
                  responseBytes: 0,
                }
              },
            }),
          }
          enqueueTask(project.id, 'agent', 0, null, undefined, undefined, {
            provider: 'gemini',
            model: 'deterministic-cloud',
            prompt: '创建支持登录和持久化的待办应用',
            steps: 0,
            toolCalls: 0,
            buildFailures: 0,
            responseBytes: 0,
            reservedOutputTokens: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            startedAt: null,
          })
          const task = claimTask()!
          await runTask(
            task,
            runtime,
            undefined,
            undefined,
            provider,
            (id, assets, steps, signal) =>
              verifyBrowser(id, assets, steps, signal, transport),
          )
          const finished = getTask(task.id)
          expect(
            finished,
            finished.error
              ? finished.error +
                  '\n' +
                  finished.events
                    .filter((event) => event.type === 'validation')
                    .map((event) => event.message)
                    .join('\n')
              : 'task failed',
          ).toMatchObject({
            status: 'completed',
          })
          const version = getVersion(project.id, finished.resultVersionId!)
          expect(artifactManifest(version.artifactId)).toMatchObject({
            mode,
            environment: 'development',
          })
          expect(cloudStatus(project.id)).toMatchObject({
            mode,
            status: 'ready',
            cleanupPending: 0,
          })
          expect(JSON.stringify(finished.events)).not.toContain(
            credentials!.password,
          )
          expect(JSON.stringify(version.files)).not.toContain(
            credentials!.password,
          )
          expect(users.size).toBe(0)
          expect(
            calls.some((url) => url.includes(refs[1] + '/database/migrations')),
          ).toBe(false)
        } finally {
          await runtime.remove(project.id).catch(() => {})
        }
      },
      120000,
    )
  },
)
