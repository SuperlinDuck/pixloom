import { loadEnvConfig } from '@next/env'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { assertProductionConfig } from '../src/lib/platform-config'
Object.assign(process.env, { NODE_ENV: 'production' })
loadEnvConfig(process.cwd(), false)
assertProductionConfig()
const require = createRequire(import.meta.url)
const child = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    'start',
    '-H',
    '127.0.0.1',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: process.env },
)
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => child.kill(signal))
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code || 0
})
