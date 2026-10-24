import {
  validateFiles as checkFiles,
  validateSourcePath as checkPath,
} from '../../../sandbox/file-tools.cjs'
import { RuntimeError, type SourceFile } from './types'
export function validateFiles(files: SourceFile[]) {
  try {
    return checkFiles(files)
  } catch (error) {
    const message = (error as Error).message
    throw new RuntimeError(message, /超过/.test(message) ? 413 : 400)
  }
}
export function validateSourcePath(file: string) {
  try {
    return checkPath(file)
  } catch (error) {
    throw new RuntimeError((error as Error).message)
  }
}
