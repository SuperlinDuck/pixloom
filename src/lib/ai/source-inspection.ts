import type { SourceFile } from '../types'

const READ_CHARACTERS = 16000
const SEARCH_MATCHES = 50
export type ReadSourceArgs = {
  path: string
  startLine: number
  endLine: number
  startColumn?: number
}

export function readSource(source: string, args: ReadSourceArgs) {
  if (args.endLine < args.startLine || args.endLine - args.startLine >= 2000)
    throw new Error('每次最多读取 2000 行')
  const lines = source.split('\n')
  const startColumn = args.startColumn ?? 1
  if (
    args.startLine <= lines.length &&
    startColumn > lines[args.startLine - 1].length + 1
  )
    throw new Error('startColumn 超出该行范围')
  const endLine = Math.min(args.endLine, lines.length)
  const parts: string[] = []
  let characters = 0
  let returnedRange: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  } | null = null
  let nextRead: ReadSourceArgs | null = null
  for (let line = args.startLine; line <= endLine; line++) {
    const offset = line === args.startLine ? startColumn - 1 : 0
    const prefix = `${line}: `
    const room =
      READ_CHARACTERS - characters - prefix.length - (parts.length ? 1 : 0)
    if (room < 0) {
      nextRead = {
        path: args.path,
        startLine: line,
        endLine: args.endLine,
        startColumn: offset + 1,
      }
      break
    }
    let text = lines[line - 1].slice(offset, offset + room)
    // Do not split a surrogate pair when a chunk ends inside a long line.
    if (
      /[\uD800-\uDBFF]$/.test(text) &&
      /[\uDC00-\uDFFF]/.test(lines[line - 1].charAt(offset + text.length))
    )
      text = text.slice(0, -1)
    characters += prefix.length + text.length + (parts.length ? 1 : 0)
    parts.push(prefix + text)
    returnedRange = {
      startLine: args.startLine,
      startColumn,
      endLine: line,
      endColumn: offset + text.length,
    }
    if (offset + text.length < lines[line - 1].length) {
      nextRead = {
        path: args.path,
        startLine: line,
        endLine: args.endLine,
        startColumn: offset + text.length + 1,
      }
      break
    }
  }
  return {
    totalLines: lines.length,
    returnedRange,
    content: parts.join('\n'),
    truncated: nextRead !== null,
    nextRead,
    notice: nextRead
      ? '已达到 16000 字符上限；内容不完整。使用 nextRead 参数继续读取，startColumn 只作用于起始行（1-based UTF-16 列号）。'
      : args.startLine > lines.length
        ? '起始行已超出文件末尾，没有返回内容。'
        : '请求范围已完整返回。',
  }
}

export function searchSource(files: SourceFile[], query: string) {
  const matches: { path: string; line: number; text: string }[] = []
  let totalMatches = 0
  for (const file of files)
    for (const [i, line] of Array.from(file.content.split('\n').entries())) {
      if (!line.includes(query)) continue
      totalMatches++
      if (matches.length < SEARCH_MATCHES)
        matches.push({ path: file.path, line: i + 1, text: line.slice(0, 240) })
    }
  return { matches, totalMatches, truncated: totalMatches > matches.length }
}

export function readSourceEvent(
  args: ReadSourceArgs,
  result: ReturnType<typeof readSource>,
) {
  const range = result.returnedRange
  return `工具 read_file · ${args.path} · 请求 ${args.startLine}:${args.startColumn ?? 1}–${args.endLine} 行 · ${range ? `返回 ${range.startLine}:${range.startColumn}–${range.endLine}:${range.endColumn}（共 ${result.totalLines} 行）` : `无内容（共 ${result.totalLines} 行）`}${result.truncated ? ' · 已截断' : ''}\n${result.notice}${result.nextRead ? `\n续读参数：${JSON.stringify(result.nextRead)}` : ''}`
}

export function searchSourceEvent(
  query: string,
  result: ReturnType<typeof searchSource>,
) {
  return `工具 search_files · ${JSON.stringify(query)} · 命中 ${result.totalMatches} 处${result.truncated ? `，返回前 ${result.matches.length} 处（已截断）` : ''}${result.matches.length ? `\n匹配位置：\n${result.matches.map((match) => `${match.path}:${match.line}`).join('\n')}` : '\n未找到匹配内容。'}`
}
