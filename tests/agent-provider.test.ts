import { afterEach, describe, expect, it, vi } from 'vitest'
import { geminiProvider, openaiProvider } from '../src/lib/ai/provider'
import { requireModel } from '../src/lib/ai/config'
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
describe('native coding protocols', () => {
  it('replays Gemini thought signatures and native tool ids without persisting hidden thoughts as text', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fake')
    const content = {
      role: 'model',
      parts: [
        { thought: true, text: 'private' },
        {
          functionCall: { id: 'native-id', name: 'list_files', args: {} },
          thoughtSignature: 'opaque-signature',
        },
      ],
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          candidates: [{ finishReason: 'STOP', content }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            thoughtsTokenCount: 3,
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          candidates: [
            {
              finishReason: 'STOP',
              content: { role: 'model', parts: [{ text: '完成' }] },
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetcher)
    const session = geminiProvider.createSession({
      model: 'gemini-3.5-flash',
      prompt: 'todo',
      signal: new AbortController().signal,
    })
    const first = await session.next([], 1000)
    expect(first.text).toBe('')
    expect(first.usage.outputTokens).toBe(8)
    await session.next(
      [
        {
          type: 'tool',
          id: first.calls[0].id,
          name: 'list_files',
          output: '[]',
        },
      ],
      1000,
    )
    const body = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: 'low',
    })
    expect(body.contents[1]).toEqual(content)
    expect(body.contents[2].parts[0].functionResponse.id).toBe('native-id')
    expect(
      body.tools[0].functionDeclarations[0].parametersJsonSchema.type,
    ).toBe('object')
  })
  it('supports Vertex Express and omits absent Gemini function ids', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('VERTEX_AI_API_KEY', 'fake')
    const fetcher = vi.fn().mockImplementation(async () =>
      response({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'list_files', args: {} } }],
            },
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    const session = geminiProvider.createSession({
      model: 'test',
      prompt: 'todo',
      signal: new AbortController().signal,
    })
    const first = await session.next([], 500)
    await session.next(
      [
        {
          type: 'tool',
          id: first.calls[0].id,
          name: 'list_files',
          output: '[]',
        },
      ],
      500,
    )
    expect(fetcher.mock.calls[0][0]).toContain('aiplatform.googleapis.com')
    expect(
      JSON.parse(fetcher.mock.calls[1][1].body).contents[2].parts[0]
        .functionResponse,
    ).not.toHaveProperty('id')
  })
  it('replays GPT reasoning/calls and returns function_call_output in Responses format', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fake')
    const output = [
      { type: 'reasoning', id: 'r1', encrypted_content: 'opaque', summary: [] },
      {
        type: 'function_call',
        id: 'fc1',
        call_id: 'call-1',
        name: 'read_file',
        arguments: '{"path":"src/App.jsx","startLine":1,"endLine":100}',
      },
    ]
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          status: 'completed',
          output,
          usage: { input_tokens: 12, output_tokens: 8 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '完成' }],
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetcher)
    const session = openaiProvider.createSession({
      model: 'gpt-test',
      prompt: 'todo',
      signal: new AbortController().signal,
    })
    const first = await session.next([], 900)
    expect(first.calls[0].arguments).toEqual({
      path: 'src/App.jsx',
      startLine: 1,
      endLine: 100,
    })
    expect(
      (
        await session.next(
          [{ type: 'tool', id: 'call-1', name: 'read_file', output: 'source' }],
          800,
        )
      ).text,
    ).toBe('完成')
    const body = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(body.input.slice(1, 3)).toEqual(output)
    expect(body.input[3]).toEqual({
      type: 'function_call_output',
      call_id: 'call-1',
      output: 'source',
    })
    expect(body.store).toBe(false)
    expect(body.max_output_tokens).toBe(800)
    expect(body.tools.every((t: { strict: boolean }) => t.strict)).toBe(true)
  })
  it.each([401, 403, 404, 429, 503])(
    'reports HTTP %i without leaking upstream content',
    async (status) => {
      vi.stubEnv('OPENAI_API_KEY', 'fake')
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(new Response('secret-upstream-body', { status })),
      )
      const session = openaiProvider.createSession({
        model: 'test',
        prompt: '',
        signal: new AbortController().signal,
      })
      await expect(session.next([], 500)).rejects.toThrow(`HTTP ${status}`)
    },
  )
  it('reports network, incomplete output and oversized model responses', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fake')
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('credential-containing error'))
      .mockResolvedValueOnce(response({ status: 'incomplete' }))
      .mockResolvedValueOnce(response({ padding: 'x'.repeat(512 * 1024) }))
    vi.stubGlobal('fetch', fetcher)
    const session = openaiProvider.createSession({
      model: 'test',
      prompt: '',
      signal: new AbortController().signal,
    })
    await expect(session.next([], 500)).rejects.toThrow('网络')
    await expect(session.next([], 500)).rejects.toThrow('未完成')
    await expect(session.next([], 500)).rejects.toThrow('512 KiB')
  })
  it('checks key, model and base URL before running', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(() => requireModel('openai')).toThrow('OPENAI_API_KEY')
    vi.stubEnv('OPENAI_API_KEY', 'fake')
    vi.stubEnv('OPENAI_MODEL', '../bad')
    expect(() => requireModel('openai')).toThrow('模型名称')
    vi.stubEnv('OPENAI_MODEL', 'gpt-test')
    vi.stubEnv('OPENAI_BASE_URL', 'https://key:secret@example.com')
    expect(() => requireModel('openai')).toThrow('OPENAI_BASE_URL')
  })
})

it.each([
  [
    {
      error: {
        details: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }],
      },
    },
    '短时调用限额',
  ],
  [
    {
      error: {
        details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }],
      },
    },
    '每日调用额度',
  ],
  [{ error: { code: 'insufficient_quota' } }, '账户额度不足'],
])(
  'classifies quota failures without exposing upstream content',
  async (body, hint) => {
    vi.stubEnv('OPENAI_API_KEY', 'fake')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...body, secret: 'never-expose-this' }),
            { status: 429 },
          ),
        ),
    )
    const session = openaiProvider.createSession({
      model: 'test',
      prompt: '',
      signal: new AbortController().signal,
    })
    await expect(session.next([], 500)).rejects.toThrow(hint)
  },
)
