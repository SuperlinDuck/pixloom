import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentContextHistory,
  contextInputBudget,
} from '../src/lib/ai/compaction'

afterEach(() => vi.unstubAllEnvs())

describe('context compression material', () => {
  it('keeps the original request and latest tool results while bounding large records', () => {
    const history = new AgentContextHistory()
    history.record([], {
      text: '决定使用分类筛选',
      calls: [
        {
          id: 'write',
          name: 'write_file',
          arguments: { content: '代码'.repeat(100000) },
        },
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
      responseBytes: 1,
    })
    const prompt = history.summaryPrompt(
      '原始需求必须完整保留',
      [
        {
          type: 'tool',
          id: 'write',
          name: 'write_file',
          output: '最新结果：写入成功，仍需构建验证',
        },
      ],
      12000,
    )
    expect(prompt).toContain('原始需求必须完整保留')
    expect(prompt).toContain('决定使用分类筛选')
    expect(prompt).toContain('最新结果：写入成功，仍需构建验证')
    expect(prompt).toContain('中间记录因摘要输入预算截断')
    expect(Buffer.byteLength(prompt)).toBeLessThan(12000)
    expect(history.summaryPrompt('需求', [], 0)).not.toContain(
      '决定使用分类筛选',
    )
  })
  it('reserves output room and provider headroom, with an explicit override for other models', () => {
    vi.stubEnv('GEMINI_CONTEXT_WINDOW_TOKENS', '')
    expect(contextInputBudget('gemini', 'gemini-3.8-flash', 24000)).toBe(762432)
    vi.stubEnv('OPENAI_CONTEXT_WINDOW_TOKENS', '')
    expect(contextInputBudget('openai', 'gpt-4.1-mini', 24000)).toBe(761682)
    vi.stubEnv('GEMINI_CONTEXT_WINDOW_TOKENS', '32768')
    expect(contextInputBudget('gemini', 'custom-model', 2048)).toBe(22528)
    vi.stubEnv('GEMINI_CONTEXT_WINDOW_TOKENS', 'invalid')
    expect(() => contextInputBudget('gemini', 'custom-model', 2048)).toThrow(
      'GEMINI_CONTEXT_WINDOW_TOKENS',
    )
    vi.stubEnv('GEMINI_CONTEXT_WINDOW_TOKENS', '')
    expect(() => contextInputBudget('gemini', 'unknown-model', 2048)).toThrow(
      '未知模型',
    )
  })
})
