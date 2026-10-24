import type { SourceFile } from './types'
export type DiffLine = { type: 'context' | 'added' | 'removed'; text: string }
export type FileDiff = {
  path: string
  type: 'added' | 'modified' | 'deleted'
  lines: DiffLine[]
  truncated: boolean
}
function lineDiff(a: string, b: string): DiffLine[] {
  const left = a === '' ? [] : a.split('\n'),
    right = b === '' ? [] : b.split('\n')
  let head = 0,
    tail = 0
  while (
    head < Math.min(left.length, right.length) &&
    left[head] === right[head]
  )
    head++
  while (
    tail < Math.min(left.length, right.length) - head &&
    left[left.length - 1 - tail] === right[right.length - 1 - tail]
  )
    tail++
  const x = left.slice(head, left.length - tail),
    y = right.slice(head, right.length - tail)
  const middle: DiffLine[] = []
  if ((x.length + 1) * (y.length + 1) <= 250000) {
    const dp = Array.from(
      { length: x.length + 1 },
      () => new Uint32Array(y.length + 1),
    )
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        dp[i][j] =
          x[i] === y[j]
            ? dp[i + 1][j + 1] + 1
            : Math.max(dp[i + 1][j], dp[i][j + 1])
    let i = 0,
      j = 0
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        middle.push({ type: 'context', text: x[i++] })
        j++
      } else if (
        i < x.length &&
        (j === y.length || dp[i + 1][j] >= dp[i][j + 1])
      )
        middle.push({ type: 'removed', text: x[i++] })
      else middle.push({ type: 'added', text: y[j++] })
    }
  } else {
    for (const text of x) middle.push({ type: 'removed', text })
    for (const text of y) middle.push({ type: 'added', text })
  }
  // Keep only a little surrounding context; large changes are bounded in the response.
  return [
    ...left
      .slice(Math.max(0, head - 3), head)
      .map((text) => ({ type: 'context' as const, text })),
    ...middle,
    ...right
      .slice(right.length - tail, right.length - tail + 3)
      .map((text) => ({ type: 'context' as const, text })),
  ]
}
export function diffFiles(from: SourceFile[], to: SourceFile[]): FileDiff[] {
  const a = new Map(from.map((f) => [f.path, f.content])),
    b = new Map(to.map((f) => [f.path, f.content]))
  return Array.from(new Set([...Array.from(a.keys()), ...Array.from(b.keys())]))
    .sort()
    .flatMap((path) => {
      if (a.get(path) === b.get(path)) return []
      const lines = lineDiff(a.get(path) || '', b.get(path) || '')
      return [
        {
          path,
          type: !a.has(path) ? 'added' : !b.has(path) ? 'deleted' : 'modified',
          lines: lines.slice(0, 2000),
          truncated: lines.length > 2000,
        } as FileDiff,
      ]
    })
}
