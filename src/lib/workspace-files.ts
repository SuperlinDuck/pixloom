import { RuntimeError } from './runtime/types'
import { createHash } from 'node:crypto'
import { validateFiles, validateSourcePath } from './runtime/files'
import type { FileOperation, SourceFile } from './types'

export function snapshot(files: SourceFile[]) {
  validateFiles(files)
  for (const entry of ['index.html', 'src/main.jsx'])
    if (!files.some((f) => f.path === entry))
      throw new RuntimeError(`缺少固定入口 ${entry}`)
  const paths = new Set(files.map((f) => f.path))
  for (const f of files) {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++)
      if (paths.has(parts.slice(0, i).join('/')))
        throw new RuntimeError('文件与目录路径冲突')
  }
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
  return {
    files: sorted,
    hash: createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),
  }
}
export function applyOperations(
  files: SourceFile[],
  operations: FileOperation[],
) {
  const map = new Map(files.map((f) => [f.path, f.content]))
  for (const op of operations) {
    validateSourcePath(op.path)
    if (op.type === 'write') map.set(op.path, op.content)
    else {
      if (['index.html', 'src/main.jsx'].includes(op.path))
        throw new RuntimeError('不能删除或重命名固定入口')
      if (!map.has(op.path)) throw new RuntimeError(`文件不存在：${op.path}`)
      if (op.type === 'rename') {
        validateSourcePath(op.to)
        if (map.has(op.to)) throw new RuntimeError('目标文件已经存在')
        map.set(op.to, map.get(op.path)!)
      }
      map.delete(op.path)
    }
  }
  return snapshot(Array.from(map, ([path, content]) => ({ path, content })))
}
