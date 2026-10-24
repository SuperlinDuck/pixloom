import {
  validateFiles as checkFiles,
  validateSourcePath as checkPath,
} from '../../../sandbox/file-tools.cjs'
import { RuntimeError, type SourceFile } from './types'
export function validateFiles(files: SourceFile[]) {
  try {
    return checkFiles(files)
  } catch (error) {
    throw new RuntimeError((error as Error).message)
  }
}
export function validateSourcePath(file: string) {
  try {
    return checkPath(file)
  } catch (error) {
    throw new RuntimeError((error as Error).message)
  }
}
