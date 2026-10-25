import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
export const MAINTENANCE_FILE = '/var/lib/pixloom/maintenance'
export const maintenanceMode = (file = MAINTENANCE_FILE) => existsSync(file)
export function releaseSha() {
  try {
    const sha = readFileSync(
      path.join(process.cwd(), '.pixloom-release'),
      'utf8',
    ).trim()
    return /^[a-f0-9]{40}$/.test(sha) ? sha : undefined
  } catch {
    return undefined
  }
}
