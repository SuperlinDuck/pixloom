import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SourceFile } from './types'
export const TEMPLATE_SOURCE_PATHS = [
  'index.html',
  'src/main.jsx',
  'src/App.jsx',
  'src/styles.css',
]
export async function templateFiles(): Promise<SourceFile[]> {
  return Promise.all(
    TEMPLATE_SOURCE_PATHS.map(async (name) => ({
      path: name,
      content: await readFile(
        path.join(process.cwd(), 'sandbox/template', name),
        'utf8',
      ),
    })),
  )
}
