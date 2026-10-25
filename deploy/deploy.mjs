import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const services = ['pixloom-web', 'pixloom-worker', 'pixloom-gateway']
export const unitFiles = [
  ...services.map((name) => `${name}.service`),
  'pixloom-backup.service',
  'pixloom-backup.timer',
  'pixloom-monitor.service',
  'pixloom-monitor.timer',
]
const runtimeTag = 'pixloom-runtime:react-v2'
const exists = async (file) =>
  !!(await fs.lstat(file).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  }))
export function command(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      stdio: ['ignore', options.capture ? 'pipe' : 'inherit', 'inherit'],
    })
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += chunk
      if (output.length > 1024 * 1024) child.kill('SIGTERM')
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${binary} failed (${code})`)),
    )
  })
}
export function validateRelease(sha, upload, digest) {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    !new RegExp(`^${sha}-[0-9]+-[0-9]+\\.tar$`).test(upload || '') ||
    !/^[a-f0-9]{64}$/.test(digest)
  )
    throw new Error('Invalid release arguments')
}
async function switchLink(target, current) {
  const temporary = `${current}.switch`
  if (await exists(temporary))
    throw new Error('Unresolved release switch exists')
  await fs.symlink(target, temporary)
  await fs.rename(temporary, current)
}
async function restoreDirectory(source, target) {
  // The old directory stays available as failure evidence, including new-version WAL files.
  const failed = `${target}.failed-${Date.now()}`
  await fs.rename(target, failed)
  await fs.cp(source, target, { recursive: true, preserveTimestamps: true })
}
export async function deployRelease({
  sha,
  upload,
  digest,
  root = '/srv/pixloom',
  control = '/var/lib/pixloom',
  config = '/etc/pixloom',
  units = '/etc/systemd/system',
  library = '/usr/local/libexec/pixloom',
  run = command,
  log = console.log,
  probeGate,
  health,
}) {
  validateRelease(sha, upload, digest)
  const id = upload.slice(0, -4)
  const current = path.join(root, 'app'),
    incoming = path.join(root, 'incoming', upload)
  const release = path.join(root, 'releases', id),
    flag = path.join(control, 'maintenance')
  const snapshot = path.join(root, 'backups', `deploy-${id}`)
  const environment = path.join(config, 'pixloom.env')
  const candidateTag = `pixloom-runtime:deploy-${sha}`
  let previous,
    oldImage,
    stopped = false,
    backedUp = false,
    switched = false,
    opened = false,
    gateOwned = false
  let configResult
  let sourceOwned = false
  const source = path.join(root, 'backups', `.source-${id}.tar`)
  const asUser = (cwd, args, configured = false, capture = false) =>
    run(
      'systemd-run',
      [
        '--quiet',
        '--wait',
        '--pipe',
        '--collect',
        '--uid=pixloom',
        '--gid=pixloom',
        '--property=SupplementaryGroups=docker',
        '--property=NoNewPrivileges=true',
        '--property=RuntimeMaxSec=1800',
        '--property=MemoryMax=3G',
        '--property=CPUQuota=200%',
        `--property=WorkingDirectory=${cwd}`,
        '--setenv=NODE_ENV=production',
        '--setenv=PATH=/usr/local/bin:/usr/bin:/bin',
        ...(configured ? [`--property=EnvironmentFile=${environment}`] : []),
        '/usr/bin/env',
        ...args,
      ],
      { capture },
    )
  const record = (stage, extra = {}) =>
    fs.writeFile(
      path.join(root, 'last-deploy.json'),
      JSON.stringify(
        { stage, sha, release, previous, snapshot, ...extra },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    )
  const checkHealth =
    health ||
    (async (expected) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          for (const service of services)
            await run('systemctl', ['is-active', '--quiet', service])
          const web = await fetch('http://127.0.0.1:3000/api/health', {
            signal: AbortSignal.timeout(3000),
          })
          const gateway = await fetch('http://127.0.0.1:4180/_pixloom/health', {
            signal: AbortSignal.timeout(3000),
          })
          const w = await web.json(),
            g = await gateway.json()
          if (
            web.ok &&
            gateway.ok &&
            w.ok &&
            (!expected || (w.release === expected && g.release === expected))
          )
            return
        } catch {
          /* Wait for SQLite lease recovery and service restart. */
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      throw new Error('Web/Gateway/Worker readiness or release identity failed')
    })
  const checkGate =
    probeGate ||
    (async (origin) => {
      const url = new URL(origin)
      const code = await run(
        'curl',
        [
          '--silent',
          '--show-error',
          '--insecure',
          '--noproxy',
          '*',
          '--max-time',
          '15',
          '--resolve',
          `${url.hostname}:443:127.0.0.1`,
          '--output',
          '/dev/null',
          '--write-out',
          '%{http_code}',
          `${url.origin}/api/health`,
        ],
        { capture: true },
      )
      if (code !== '503')
        throw new Error('Caddy maintenance gate must return 503 before cutover')
    })
  try {
    for (const directory of [
      'releases',
      'backups',
      'data',
      'published',
      'incoming',
    ]) {
      const info = await fs.lstat(path.join(root, directory))
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`Unsafe deployment directory: ${directory}`)
    }
    const incomingInfo = await fs.lstat(incoming)
    if (!incomingInfo.isFile() || incomingInfo.isSymbolicLink())
      throw new Error('Upload must be a regular file')
    if (await exists(current)) {
      if (!(await fs.lstat(current)).isSymbolicLink())
        throw new Error(
          'app must be a release symlink; migrate the old checkout first',
        )
      previous = await fs.realpath(current)
      if (
        !previous.startsWith(
          (await fs.realpath(path.join(root, 'releases'))) + path.sep,
        )
      )
        throw new Error('Previous release must be inside releases')
    }
    if ((await exists(flag)) && previous)
      throw new Error(
        'Maintenance already active; inspect last-deploy.json before retrying',
      )
    if ((await exists(release)) || (await exists(snapshot)))
      throw new Error('Release already exists; use a new workflow attempt')
    if ((await fs.stat(environment)).mode & 0o007)
      throw new Error('Production env must not be world-accessible')
    for (const service of ['docker', 'caddy'])
      await run('systemctl', ['is-active', '--quiet', service])
    if (
      (await run('docker', ['context', 'show'], { capture: true })) !==
      'default'
    )
      throw new Error('Controller requires the default local Docker context')
    await run('caddy', [
      'validate',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ])
    await fs.mkdir(release, { mode: 0o750 })
    // Freeze the upload before validating/extracting; the SSH user cannot change this root-owned copy.
    await fs.copyFile(incoming, source, fs.constants.COPYFILE_EXCL)
    sourceOwned = true
    await fs.chmod(source, 0o600)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(source)) hash.update(chunk)
    if (hash.digest('hex') !== digest)
      throw new Error('Source checksum mismatch')
    try {
      await run('python3', [path.join(library, 'archive.py'), source, release])
    } finally {
      await fs.unlink(source)
    }
    await fs.writeFile(path.join(release, '.pixloom-release'), sha + '\n', {
      mode: 0o644,
    })
    await run('chown', ['-R', 'pixloom:pixloom', release])
    log(
      'Preparing dependencies, browser and build; current services remain running.',
    )
    await asUser(release, [
      'pnpm',
      'install',
      '--frozen-lockfile',
      '--prod=false',
    ])
    await asUser(release, ['pnpm', 'exec', 'playwright', 'install', 'chromium'])
    configResult = JSON.parse(
      await asUser(
        release,
        ['node', '--import', 'tsx', 'scripts/deploy-state.ts', 'preflight'],
        true,
        true,
      ),
    )
    await asUser(release, ['pnpm', 'build'])
    await asUser(release, [
      'docker',
      'build',
      '--tag',
      candidateTag,
      path.join(release, 'sandbox'),
    ])
    await run(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', candidateTag],
      { capture: true },
    )
    // Save the existing image before tagging the candidate. Do not change the active template during preparation.
    oldImage = await run(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', runtimeTag],
      { capture: true },
    ).catch(() => undefined)
    if (oldImage)
      await run('docker', ['tag', oldImage, `pixloom-runtime:rollback-${id}`])
    if (previous && !oldImage)
      throw new Error('Previous runtime image must be available for rollback')
    await fs.mkdir(control, { recursive: true, mode: 0o755 })
    await fs.writeFile(flag, 'Pixloom deployment in progress\n', {
      mode: 0o644,
    })
    gateOwned = true
    await checkGate(configResult.origin)
    await asUser(
      release,
      ['node', '--import', 'tsx', 'scripts/deploy-state.ts', 'drain'],
      true,
    )
    // Stop the monitor while the three writers are intentionally offline.
    await run('systemctl', ['stop', 'pixloom-monitor.timer'])
    stopped = true // A partially failed stop must also take the rollback path.
    await run('systemctl', ['stop', ...services])
    await fs.mkdir(snapshot, { mode: 0o700 })
    await fs.cp(path.join(root, 'data'), path.join(snapshot, 'data'), {
      recursive: true,
      preserveTimestamps: true,
    })
    await fs.cp(
      path.join(root, 'published'),
      path.join(snapshot, 'published'),
      { recursive: true, preserveTimestamps: true },
    )
    await fs.copyFile(environment, path.join(snapshot, 'pixloom.env'))
    await fs.chmod(path.join(snapshot, 'pixloom.env'), 0o600)
    if (await exists(path.join(config, 'backup.sh')))
      await fs.copyFile(
        path.join(config, 'backup.sh'),
        path.join(snapshot, 'backup.sh'),
      )
    await fs.mkdir(path.join(snapshot, 'units'))
    for (const name of unitFiles)
      if (await exists(path.join(units, name)))
        await fs.copyFile(
          path.join(units, name),
          path.join(snapshot, 'units', name),
        )
    await fs.writeFile(
      path.join(snapshot, 'metadata.json'),
      JSON.stringify({ sha, previous, oldImage }, null, 2),
      { mode: 0o600 },
    )
    backedUp = true
    await record('backed-up')
    // Only after the cold snapshot may the new code migrate SQLite or reconcile containers.
    await asUser(
      release,
      ['node', '--import', 'tsx', 'scripts/deploy-state.ts', 'reset'],
      true,
    )
    await run('docker', ['tag', candidateTag, runtimeTag])
    for (const name of unitFiles)
      await fs.copyFile(
        path.join(release, 'deploy', name),
        path.join(units, name),
      )
    await fs.copyFile(
      path.join(release, 'deploy', 'backup.sh'),
      path.join(config, 'backup.sh'),
    )
    await fs.chmod(path.join(config, 'backup.sh'), 0o700)
    await switchLink(release, current)
    switched = true
    await run('systemctl', ['daemon-reload'])
    await run('systemctl', ['start', ...services])
    await checkHealth(sha)
    await asUser(
      release,
      ['node', '--import', 'tsx', 'scripts/deploy-state.ts', 'verify'],
      true,
    )
    await checkGate(configResult.origin)
    await run('systemctl', [
      'enable',
      ...services,
      'pixloom-backup.timer',
      'pixloom-monitor.timer',
    ])
    await run('systemctl', [
      'start',
      'pixloom-backup.timer',
      'pixloom-monitor.timer',
    ])
    await record('ready')
    // Once traffic/tasks may resume, automatic data rollback is forbidden.
    opened = true
    await fs.unlink(flag)
    await record('live')
    log(`Deployment healthy: ${sha}. Cold snapshot: ${snapshot}`)
    return { sha, release, snapshot }
  } catch (error) {
    if (stopped && !opened) {
      log(
        'Cutover failed; keeping maintenance active while restoring the previous release.',
      )
      try {
        await run('systemctl', ['stop', ...services])
        if (backedUp) {
          await restoreDirectory(
            path.join(snapshot, 'data'),
            path.join(root, 'data'),
          )
          await restoreDirectory(
            path.join(snapshot, 'published'),
            path.join(root, 'published'),
          )
          await run('chown', [
            '-R',
            'pixloom:pixloom',
            path.join(root, 'data'),
            path.join(root, 'published'),
          ])
          for (const name of unitFiles) {
            const saved = path.join(snapshot, 'units', name)
            if (await exists(saved))
              await fs.copyFile(saved, path.join(units, name))
            else await fs.rm(path.join(units, name), { force: true })
          }
          if (await exists(path.join(snapshot, 'backup.sh')))
            await fs.copyFile(
              path.join(snapshot, 'backup.sh'),
              path.join(config, 'backup.sh'),
            )
          else await fs.rm(path.join(config, 'backup.sh'), { force: true })
          if (oldImage) await run('docker', ['tag', oldImage, runtimeTag])
        }
        if (previous) {
          await asUser(release, [
            'node',
            path.join(library, 'retire-worker.mjs'),
            path.join(root, 'data', 'pixloom-v3.db'),
          ])
          if (switched) await switchLink(previous, current)
          await run('systemctl', ['daemon-reload'])
          await run('systemctl', ['start', ...services])
          const expected =
            (
              await fs
                .readFile(path.join(previous, '.pixloom-release'), 'utf8')
                .catch(() => '')
            ).trim() || undefined
          await checkHealth(expected)
          await record('rolled-back', { error: error.message })
          await fs.unlink(flag)
          await run('systemctl', ['start', 'pixloom-monitor.timer'])
        } else await record('failed-first-deploy', { error: error.message })
      } catch (rollbackError) {
        await record('rollback-failed', {
          error: error.message,
          rollbackError: rollbackError.message,
        }).catch(() => {})
        throw new Error(
          `Rollback incomplete; maintenance retained. ${rollbackError.message}`,
        )
      }
    } else if (gateOwned && previous && !opened) {
      await fs.unlink(flag)
      await run('systemctl', ['start', 'pixloom-monitor.timer']).catch(() => {})
    }
    throw error
  } finally {
    if (sourceOwned) await fs.rm(source, { force: true }).catch(() => {})
    // Never delete releases, snapshots, images, or failed-version data automatically.
    await fs.rm(incoming, { force: true }).catch(() => {})
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.getuid?.() !== 0) {
    console.error('Deployment controller requires root')
    process.exitCode = 1
  } else
    deployRelease({
      sha: process.argv[2],
      upload: process.argv[3],
      digest: process.argv[4],
    }).catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
