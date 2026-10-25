import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
// Called only after every managed writer has stopped. Do not import application migrations.
export function retireWorkerLease(file) {
  if (!existsSync(file)) return
  const connection = new DatabaseSync(file)
  try {
    connection.exec('PRAGMA busy_timeout=5000')
    if (
      connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='worker'",
        )
        .get()
    )
      connection.prepare('DELETE FROM worker').run()
  } finally {
    connection.close()
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    retireWorkerLease(process.argv[2])
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
