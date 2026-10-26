import { describe, expect, it } from 'vitest'
import { readSource, searchSource } from '../src/lib/ai/source-inspection'
import { agentTools } from '../src/lib/ai/tools'

const args = { path: 'src/App.jsx', startLine: 1, endLine: 100 }

describe('bounded source inspection', () => {
  it('reports the actual range and distinguishes EOF from character truncation', () => {
    expect(readSource('first\nlast', args)).toMatchObject({
      totalLines: 2,
      content: '1: first\n2: last',
      returnedRange: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 4 },
      truncated: false,
      nextRead: null,
    })
    const pastEnd = readSource('first\nlast', { ...args, startLine: 3 })
    expect(pastEnd).toMatchObject({
      content: '',
      returnedRange: null,
      truncated: false,
      nextRead: null,
    })
    expect(pastEnd.notice).toContain('超出文件末尾')
    expect(readSource('', args)).toMatchObject({
      content: '1: ',
      truncated: false,
    })
  })

  it.each([
    '🙂'.repeat(18000) + '\n分类表单\n',
    Array(200).fill('分类🙂'.repeat(40)).join('\n'),
  ])(
    'continues truncated source without losing or repeating characters (%#)',
    (source) => {
      let request = { ...args, endLine: source.split('\n').length }
      let reconstructed = ''
      let chunks = 0
      do {
        const result = readSource(source, request)
        expect(result.content.length).toBeLessThanOrEqual(16000)
        expect(result.content).not.toMatch(/[\uD800-\uDBFF]$/)
        reconstructed += result.content.replace(/^\d+: /gm, '')
        chunks++
        if (!result.nextRead) break
        expect(result.truncated).toBe(true)
        expect(result.notice).toContain('内容不完整')
        // Add the newline only when the next chunk starts on a new line.
        if (result.nextRead.startLine > result.returnedRange!.endLine)
          reconstructed += '\n'
        request = result.nextRead
        expect(chunks).toBeLessThan(10)
      } while (true)
      expect(chunks).toBeGreaterThan(1)
      expect(reconstructed).toBe(source)
    },
  )

  it('preserves an unpaired surrogate at EOF instead of returning a non-advancing cursor', () => {
    expect(readSource('x\uD800', args)).toMatchObject({
      content: '1: x\uD800',
      truncated: false,
      nextRead: null,
    })
  })

  it('continues on the next line when the previous line exactly fills the limit', () => {
    const result = readSource('a'.repeat(15997) + '\nnext', args)
    expect(result.content).toHaveLength(16000)
    expect(result.nextRead).toEqual({ ...args, startLine: 2, startColumn: 1 })
    expect(readSource('a'.repeat(15997), args).truncated).toBe(false)
    expect(
      readSource('a'.repeat(15997) + '\nnext', result.nextRead!),
    ).toMatchObject({ content: '2: next', truncated: false })
  })

  it('applies the starting column to the first line only and rejects invalid ranges', () => {
    expect(
      readSource('abcdef\nghij', { ...args, startColumn: 4 }).content,
    ).toBe('1: def\n2: ghij')
    expect(() => readSource('abc', { ...args, startColumn: 5 })).toThrow(
      'startColumn',
    )
    expect(() => readSource('abc', { ...args, endLine: 2001 })).toThrow(
      '2000 行',
    )
    expect(() =>
      readSource('abc', { ...args, startLine: 2, endLine: 1 }),
    ).toThrow('2000 行')
  })

  it('keeps existing read calls compatible while exposing the continuation column to both providers', () => {
    const tool = agentTools.find((tool) => tool.name === 'read_file')!
    expect(tool.schema.parse(args)).toMatchObject({ startColumn: 1 })
    expect(tool.parameters.required).toContain('startColumn')
    expect(tool.schema.safeParse({ ...args, startColumn: 0 }).success).toBe(
      false,
    )
  })

  it('counts all matching lines while limiting returned matches and flags truncation precisely', () => {
    const file = (n: number) => [
      { path: args.path, content: Array(n).fill('分类 分类').join('\n') },
    ]
    expect(searchSource(file(51), '分类')).toMatchObject({
      totalMatches: 51,
      truncated: true,
    })
    expect(searchSource(file(51), '分类').matches).toHaveLength(50)
    expect(searchSource(file(50), '分类')).toMatchObject({
      totalMatches: 50,
      truncated: false,
    })
    expect(searchSource(file(2), '缺失')).toEqual({
      matches: [],
      totalMatches: 0,
      truncated: false,
    })
    expect(
      searchSource([{ path: args.path, content: 'a.b\nacb' }], 'a.b')
        .totalMatches,
    ).toBe(1)
  })
})
