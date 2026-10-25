import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateProjectTitle } from '../src/lib/ai/title'
import {
  geminiProvider,
  openaiProvider,
  type ModelProvider,
  type ModelTurn,
} from '../src/lib/ai/provider'
import {
  cancelTask,
  claimTask,
  createAgentProject,
  db,
  enqueueTask,
  finishTask,
  getProject,
  projectTitlePending,
  renameProject,
} from '../src/lib/store'
import type { AgentState } from '../src/lib/types'

let directory: string
const prompt = '帮我做一个中文「私房食谱本」，支持登录、收藏和搜索。'
const fallback = Array.from(prompt).slice(0, 28).join('')
const state = (): AgentState => ({
  provider: 'gemini',
  model: 'test-model',
  prompt,
  steps: 0,
  toolCalls: 0,
  buildFailures: 0,
  responseBytes: 0,
  reservedOutputTokens: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
  startedAt: null,
})
const turn = (text = '私房食谱本'): ModelTurn => ({
  text,
  calls: [],
  usage: { inputTokens: 10, outputTokens: 5 },
  responseBytes: 100,
})
function setup(
  generateText = vi
    .fn<NonNullable<ModelProvider['generateText']>>()
    .mockResolvedValue(turn()),
) {
  const project = createAgentProject(
    fallback,
    [
      { path: 'index.html', content: '<div />' },
      { path: 'src/main.jsx', content: 'export default null' },
    ],
    state(),
  )
  const task = claimTask()!
  const provider: ModelProvider = { generateText, createSession: vi.fn() }
  return { project, task, provider, generateText }
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-title-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('GEMINI_CONTEXT_WINDOW_TOKENS', '128000')
  vi.stubEnv('OPENAI_CONTEXT_WINDOW_TOKENS', '128000')
})
beforeEach(() => db().exec('DELETE FROM projects;'))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
afterAll(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('application conversation titles', () => {
  it('uses the first query in an independent model call and persists its app name only once', async () => {
    const { task, project, provider, generateText } = setup()
    const signal = new AbortController().signal
    await generateProjectTitle(task, provider, signal)
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt, model: 'test-model' }),
    )
    expect(provider.createSession).not.toHaveBeenCalled()
    expect(getProject(project.id).project.name).toBe('私房食谱本')
    expect(projectTitlePending(task)).toBe(false)
    await generateProjectTitle(task, provider, signal)
    finishTask(task)
    const detail = getProject(project.id)
    enqueueTask(
      project.id,
      'agent',
      detail.draft.revision,
      null,
      undefined,
      undefined,
      { ...state(), prompt: '增加深色模式' },
    )
    await generateProjectTitle(claimTask()!, provider, signal)
    expect(generateText).toHaveBeenCalledTimes(1)
  })
  it('succeeds on the third retry without changing the query', async () => {
    const generateText = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(turn(''))
      .mockResolvedValueOnce(turn('名称\n解释'))
      .mockResolvedValueOnce(turn('「私房食谱本」'))
    const { task, project, provider } = setup(generateText)
    await generateProjectTitle(task, provider, new AbortController().signal)
    expect(generateText).toHaveBeenCalledTimes(4)
    expect(
      generateText.mock.calls.every(([request]) => request.prompt === prompt),
    ).toBe(true)
    expect(getProject(project.id).project.name).toBe('私房食谱本')
  })
  it.each([geminiProvider, openaiProvider])(
    'makes four HTTP attempts without nested retries, then keeps the first query',
    async (provider) => {
      vi.stubEnv('GEMINI_API_KEY', 'fake')
      vi.stubEnv('OPENAI_API_KEY', 'fake')
      const fetcher = vi.fn(async () => new Response('{}', { status: 503 }))
      vi.stubGlobal('fetch', fetcher)
      const { task, project } = setup()
      await generateProjectTitle(task, provider, new AbortController().signal)
      expect(fetcher).toHaveBeenCalledTimes(4)
      for (const [, request] of fetcher.mock.calls as unknown as [
        string,
        RequestInit,
      ][]) {
        const body = JSON.parse(request.body as string)
        expect(body).not.toHaveProperty('tools')
        expect(
          body.instructions || body.systemInstruction.parts[0].text,
        ).toContain('应用名称')
      }
      expect(getProject(project.id).project.name).toBe(fallback)
      expect(projectTitlePending(task)).toBe(false)
    },
  )
  it('preserves manual renames before or during generation', async () => {
    const first = setup()
    renameProject(first.project.id, '我的食谱')
    await generateProjectTitle(
      first.task,
      first.provider,
      new AbortController().signal,
    )
    expect(first.generateText).not.toHaveBeenCalled()
    const generateText = vi.fn(async () => {
      renameProject(second.project.id, '我的菜谱')
      return turn()
    })
    const second = setup(generateText)
    await generateProjectTitle(
      second.task,
      second.provider,
      new AbortController().signal,
    )
    expect(getProject(second.project.id).project.name).toBe('我的菜谱')
  })
  it('stops retries immediately when the task is aborted', async () => {
    const controller = new AbortController()
    const generateText = vi.fn(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    const { task, project, provider } = setup(generateText)
    await generateProjectTitle(task, provider, controller.signal)
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(getProject(project.id).project.name).toBe(fallback)
  })
  it('discards results for cancelled task attempts', async () => {
    const generateText = vi.fn(async () => {
      cancelTask(task.id)
      return turn()
    })
    const { task, project, provider } = setup(generateText)
    await generateProjectTitle(task, provider, new AbortController().signal)
    expect(getProject(project.id).project.name).toBe(fallback)
  })
})
