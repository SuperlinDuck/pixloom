import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  acquireWorker,
  addEvent,
  cancelTask,
  claimTask,
  completeTask,
  createProject,
  createTask,
  db,
  getProject,
  getTask,
  heartbeat,
  releaseWorker,
  restoreVersion,
  workerOnline,
} from '../src/lib/store'
import { runTask } from '../src/lib/runner'
import {
  geminiProvider,
  openaiProvider,
  parseArtifact,
  type ModelProvider,
} from '../src/lib/ai/provider'
import { validateArtifact } from '../src/lib/artifact'
import { previewDocument } from '../src/lib/preview'
import { exampleHtml } from '../src/lib/example'
import { readJson } from '../src/lib/http'

let directory: string
const html =
  '<!doctype html><html><head><title>Test</title></head><body><button id="add">Add</button><script>document.querySelector("button").onclick = () => { document.body.dataset.clicked = "yes" }</script></body></html>'
const usage = { inputTokens: 10, outputTokens: 20 }
const result = { text: JSON.stringify({ summary: '已构建应用', html }), usage }
function queued(prompt = '创建待办应用') {
  const project = createProject('Todo')
  createTask(project.id, prompt, 'gemini', 'test-model')
  return { project, task: claimTask()! }
}
beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'pixloom-test-'))
  process.env.PIXLOOM_DATA_DIR = directory
})
beforeEach(() => {
  db().exec(
    'DELETE FROM versions; DELETE FROM tasks; DELETE FROM projects; DELETE FROM worker;',
  )
  vi.restoreAllMocks()
})
afterAll(() => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  rmSync(directory, { recursive: true, force: true })
  delete process.env.PIXLOOM_DATA_DIR
})

describe('persistent project workflow', () => {
  it('claims once, generates a version, and supplies current code on a follow-up', async () => {
    const { project, task } = queued()
    expect(claimTask()).toBeUndefined()
    const generate = vi.fn().mockResolvedValue(result)
    await runTask(task, { generate })
    const first = getProject(project.id)
    expect(first.tasks[0].status).toBe('completed')
    expect(first.versions[0].html).toContain('onclick')
    expect(first.project.currentVersionId).toBe(first.versions[0].id)
    createTask(project.id, '增加分类', 'gemini', 'test-model')
    await runTask(claimTask()!, { generate })
    expect(JSON.parse(generate.mock.calls[1][0].prompt).currentHtml).toContain(
      'onclick',
    )
    const second = getProject(project.id)
    expect(second.versions.map((v) => v.number)).toEqual([2, 1])
    restoreVersion(project.id, first.versions[0].id)
    expect(getProject(project.id).project.currentVersionId).toBe(
      first.versions[0].id,
    )
  })
  it('rejects simultaneous tasks and cross-project version restores', async () => {
    const { project, task } = queued()
    expect(() => createTask(project.id, 'another', 'gemini', 'test')).toThrow(
      '已有',
    )
    await runTask(task, { generate: vi.fn().mockResolvedValue(result) })
    const other = createProject('Other')
    expect(() =>
      restoreVersion(other.id, getProject(project.id).versions[0].id),
    ).toThrow('版本不存在')
    expect(() => getProject('missing')).toThrow('项目不存在')
  })
  it('cancels without publishing a late result or destroying the previous version', async () => {
    const { project, task } = queued()
    await runTask(task, { generate: vi.fn().mockResolvedValue(result) })
    const before = getProject(project.id)
    createTask(project.id, '修改', 'gemini', 'test')
    const next = claimTask()!
    const provider: ModelProvider = {
      generate: async () => {
        cancelTask(next.id)
        return result
      },
    }
    await runTask(next, provider)
    expect(getTask(next.id).status).toBe('cancelled')
    expect(getProject(project.id).versions).toHaveLength(1)
    expect(getProject(project.id).project.currentVersionId).toBe(
      before.project.currentVersionId,
    )
  })
  it('repairs invalid JavaScript once and records combined token usage', async () => {
    const { task } = queued()
    const invalid = JSON.stringify({
      summary: 'Bad',
      html: '<html><body><script>const = ;</script></body></html>',
    })
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: invalid, usage })
      .mockResolvedValueOnce(result)
    await runTask(task, { generate })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(
      JSON.parse(generate.mock.calls[1][0].prompt).validationError,
    ).toContain('语法错误')
    expect(getTask(task.id).usage).toEqual({
      inputTokens: 20,
      outputTokens: 40,
    })
    expect(getTask(task.id).status).toBe('completed')
  })
  it('stops after one repair and preserves failure without a version', async () => {
    const { project, task } = queued()
    const generate = vi.fn().mockResolvedValue({ text: 'invalid JSON', usage })
    await runTask(task, { generate })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(getTask(task.id).status).toBe('failed')
    expect(getProject(project.id).versions).toHaveLength(0)
  })
  it('uses a worker lease and recovers interrupted work', () => {
    const { task } = queued()
    expect(acquireWorker('first')).toBe(true)
    expect(getTask(task.id).status).toBe('queued')
    expect(workerOnline()).toBe(true)
    expect(acquireWorker('second')).toBe(false)
    expect(heartbeat('second')).toBe(false)
    releaseWorker('first')
    expect(acquireWorker('second')).toBe(true)
  })
  it('does not overwrite cancellation with completion or later events', () => {
    const { task } = queued()
    cancelTask(task.id)
    const events = getTask(task.id).events
    addEvent(task.id, 'late event')
    expect(completeTask(task.id, html, 'late', usage)).toBeNull()
    expect(getTask(task.id).events).toEqual(events)
  })
})
describe('artifact boundary', () => {
  it('ships a valid, self-contained interactive example', () => {
    expect(validateArtifact(exampleHtml)).toContain('开始专注')
  })
  it('validates inline code, rejects external scripts and syntax failures', () => {
    expect(validateArtifact(html)).toContain('<html>')
    expect(() =>
      validateArtifact(
        '<html><body><script src="https://bad.example/x.js"></script></body></html>',
      ),
    ).toThrow('外部脚本')
    expect(() =>
      validateArtifact('<html><body><script>let = ;</script></body></html>'),
    ).toThrow('语法错误')
    expect(() =>
      validateArtifact('<html><body><iframe></iframe></body></html>'),
    ).toThrow('嵌入')
    expect(() =>
      validateArtifact(
        '<html><body><button onclick="let =">X</button></body></html>',
      ),
    ).toThrow('语法错误')
    expect(parseArtifact('```json\n' + result.text + '\n```').summary).toBe(
      '已构建应用',
    )
  })
  it('places restrictive CSP before all generated markup', () => {
    const preview = previewDocument('<script>fetch("/api/projects")</script>')
    expect(preview.indexOf('Content-Security-Policy')).toBeLessThan(
      preview.indexOf('<script>'),
    )
    expect(preview).toContain("connect-src 'none'")
    expect(preview).toContain("form-action 'none'")
  })
  it('rejects cross-origin writes and oversized requests', async () => {
    await expect(
      readJson(
        new Request('http://localhost:3000/api/projects', {
          method: 'POST',
          headers: {
            origin: 'https://evil.example',
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      ),
    ).rejects.toThrow('跨站')
    await expect(
      readJson(
        new Request('http://localhost:3000/api/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'a'.repeat(33000) }),
        }),
      ),
    ).rejects.toThrow('过大')
  })
})
describe('provider contracts', () => {
  it('uses Gemini structured output and never includes API keys in URL', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-secret')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: result.text }] },
            },
          ],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 5 },
        }),
      ),
    )
    const data = await geminiProvider.generate({
      provider: 'gemini',
      model: 'test',
      prompt: 'build',
      signal: new AbortController().signal,
    })
    const [url, options] = fetcher.mock.calls[0]
    expect(url).not.toContain('test-secret')
    expect(
      JSON.parse(options!.body as string).generationConfig.responseMimeType,
    ).toBe('application/json')
    expect(data.usage).toEqual({ inputTokens: 4, outputTokens: 5 })
    vi.unstubAllEnvs()
  })
  it('supports existing Vertex express mode keys and handles provider failures', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('VERTEX_AI_API_KEY', 'vertex-secret')
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('credential-body-must-not-leak', { status: 403 }),
      )
    await expect(
      geminiProvider.generate({
        provider: 'gemini',
        model: 'test',
        prompt: 'build',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('HTTP 403')
    expect(fetcher.mock.calls[0][0]).toContain('aiplatform.googleapis.com')
    vi.unstubAllEnvs()
  })
  it('uses GPT Responses API and parses output messages', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-test-secret')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: result.text }],
            },
          ],
          usage: { input_tokens: 3, output_tokens: 8 },
        }),
      ),
    )
    const data = await openaiProvider.generate({
      provider: 'openai',
      model: 'test-gpt',
      prompt: 'build',
      signal: new AbortController().signal,
    })
    expect(fetcher.mock.calls[0][0]).toContain('/responses')
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string)
    expect(body.text.format.type).toBe('json_schema')
    expect(body.store).toBe(false)
    expect(data.text).toBe(result.text)
    vi.unstubAllEnvs()
  })
})
