import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { retireWorkerLease } from '../deploy/retire-worker.mjs'
import { execFileSync } from 'node:child_process'
import {
  deployRelease,
  services,
  unitFiles,
  validateRelease,
} from '../deploy/deploy.mjs'
import { maintenanceMode } from '../src/lib/maintenance'
import { caddyConfig, publicationConfig } from '../src/lib/publication/config'

let directory: string
const sha = 'a'.repeat(40),
  oldSha = 'b'.repeat(40),
  upload = `${sha}-123-1.tar`
beforeEach(async () => {
  directory = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), 'pixloom-deploy-test-')),
  )
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(directory, { recursive: true, force: true })
})
async function fixture(previous = true) {
  const root = path.join(directory, 'srv'),
    control = path.join(directory, 'control'),
    config = path.join(directory, 'config'),
    units = path.join(directory, 'units')
  for (const folder of [
    root,
    control,
    config,
    units,
    ...['incoming', 'releases', 'backups', 'data', 'published'].map((p) =>
      path.join(root, p),
    ),
  ])
    await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(config, 'pixloom.env'), 'SECRET=server-only\n', {
    mode: 0o640,
  })
  await fs.writeFile(path.join(config, 'backup.sh'), 'old-backup')
  await fs.writeFile(path.join(root, 'data', 'database'), 'original-data')
  await fs.writeFile(path.join(root, 'data', 'database-wal'), 'original-wal')
  await fs.writeFile(path.join(root, 'published', 'site'), 'original-site')
  for (const name of unitFiles)
    await fs.writeFile(path.join(units, name), 'old-unit')
  const old = path.join(root, 'releases', 'old')
  await fs.mkdir(old)
  await fs.writeFile(path.join(old, '.pixloom-release'), oldSha)
  if (previous) await fs.symlink(old, path.join(root, 'app'))
  const archive = Buffer.from('immutable source fixture')
  await fs.writeFile(path.join(root, 'incoming', upload), archive)
  const journal: string[] = []
  let defaultImage = 'sha256:old'
  let failAt = ''
  let healthCalls = 0
  const release = path.join(root, 'releases', upload.slice(0, -4))
  const run = vi.fn(async (binary: string, args: string[]) => {
    const event = [binary, ...args].join(' ')
    journal.push(event)
    if (failAt && event.includes(failAt))
      throw new Error('injected failure: ' + failAt)
    if (binary === 'python3') {
      await fs.mkdir(path.join(release, 'deploy'))
      for (const name of unitFiles)
        await fs.writeFile(path.join(release, 'deploy', name), 'new-unit')
      await fs.writeFile(
        path.join(release, 'deploy', 'backup.sh'),
        'new-backup',
      )
    }
    if (event.includes('scripts/deploy-state.ts preflight'))
      return JSON.stringify({ origin: 'https://pixloom.test' })
    if (event.includes('scripts/deploy-state.ts reset')) {
      // Simulate a new schema opening the live database after snapshot creation.
      await fs.writeFile(path.join(root, 'data', 'database'), 'new-schema')
      await fs.writeFile(path.join(root, 'published', 'site'), 'new-site')
    }
    if (binary === 'docker' && args[0] === 'context') return 'default'
    if (binary === 'docker' && args[0] === 'image') return defaultImage
    if (
      binary === 'docker' &&
      args[0] === 'tag' &&
      args[2] === 'pixloom-runtime:react-v2'
    )
      defaultImage = args[1]
    return ''
  })
  const probeGate = vi.fn(async () => {
    journal.push('gate')
    expect(maintenanceMode(path.join(control, 'maintenance'))).toBe(true)
    if (failAt === 'gate') throw new Error('gate not protecting writes')
  })
  const health = vi.fn(async (expected?: string) => {
    journal.push('health:' + expected)
    healthCalls++
    if (failAt === 'health' && healthCalls === 1)
      throw new Error('new release unhealthy')
    if (failAt === 'all-health') throw new Error('both releases unhealthy')
  })
  return {
    root,
    control,
    config,
    units,
    library: directory,
    sha,
    upload,
    digest: createHash('sha256').update(archive).digest('hex'),
    run,
    probeGate,
    health,
    log: vi.fn(),
    journal,
    old,
    release,
    fail: (at: string) => {
      failAt = at
    },
    image: () => defaultImage,
  }
}
describe('deployment controller safety', () => {
  it('builds before stopping, cold-backs up before migration, verifies identity before opening traffic', async () => {
    const f = await fixture()
    const result = await deployRelease(f)
    expect(await fs.realpath(path.join(f.root, 'app'))).toBe(f.release)
    expect(
      await fs.readFile(path.join(result.snapshot, 'data', 'database'), 'utf8'),
    ).toBe('original-data')
    expect(
      await fs.readFile(
        path.join(result.snapshot, 'data', 'database-wal'),
        'utf8',
      ),
    ).toBe('original-wal')
    expect(
      await fs.readFile(path.join(result.snapshot, 'pixloom.env'), 'utf8'),
    ).toContain('server-only')
    expect(maintenanceMode(path.join(f.control, 'maintenance'))).toBe(false)
    const at = (text: string) =>
      f.journal.findIndex((row) => row.includes(text))
    expect(at('pnpm build')).toBeLessThan(at('systemctl stop pixloom-web'))
    expect(at('gate')).toBeLessThan(at('systemctl stop pixloom-web'))
    expect(at('reset')).toBeLessThan(at('systemctl start pixloom-web'))
    expect(at('health:' + sha)).toBeLessThan(at('systemctl enable'))
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'last-deploy.json'), 'utf8'),
      ).stage,
    ).toBe('live')
    expect(f.log.mock.calls.flat().join(' ')).not.toContain('server-only')
  })
  it.each(['pnpm build', 'gate'])(
    'keeps the current services/data unchanged on preparation failure: %s',
    async (failure) => {
      const f = await fixture()
      f.fail(failure)
      await expect(deployRelease(f)).rejects.toThrow()
      expect(await fs.realpath(path.join(f.root, 'app'))).toBe(f.old)
      expect(
        await fs.readFile(path.join(f.root, 'data', 'database'), 'utf8'),
      ).toBe('original-data')
      expect(
        f.journal.some((row) => row.includes('systemctl stop pixloom-web')),
      ).toBe(false)
      expect(maintenanceMode(path.join(f.control, 'maintenance'))).toBe(false)
      expect(f.image()).toBe('sha256:old')
    },
  )
  it('restores SQLite+WAL, publication, units, backup helper, image and code on failed health', async () => {
    const f = await fixture()
    f.fail('health')
    await expect(deployRelease(f)).rejects.toThrow('unhealthy')
    expect(await fs.realpath(path.join(f.root, 'app'))).toBe(f.old)
    expect(
      await fs.readFile(path.join(f.root, 'data', 'database'), 'utf8'),
    ).toBe('original-data')
    expect(
      await fs.readFile(path.join(f.root, 'data', 'database-wal'), 'utf8'),
    ).toBe('original-wal')
    expect(
      await fs.readFile(path.join(f.root, 'published', 'site'), 'utf8'),
    ).toBe('original-site')
    expect(
      await fs.readFile(path.join(f.units, 'pixloom-worker.service'), 'utf8'),
    ).toBe('old-unit')
    expect(await fs.readFile(path.join(f.config, 'backup.sh'), 'utf8')).toBe(
      'old-backup',
    )
    expect(f.image()).toBe('sha256:old')
    expect(maintenanceMode(path.join(f.control, 'maintenance'))).toBe(false)
    expect(
      (await fs.readdir(f.root)).some((name) =>
        name.startsWith('data.failed-'),
      ),
    ).toBe(true)
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'last-deploy.json'), 'utf8'),
      ).stage,
    ).toBe('rolled-back')
  })
  it.each([true, false])(
    'retains maintenance on rollback failure or first-deploy failure (previous=%s)',
    async (previous) => {
      const f = await fixture(previous)
      f.fail(previous ? 'all-health' : 'health')
      await expect(deployRelease(f)).rejects.toThrow()
      expect(maintenanceMode(path.join(f.control, 'maintenance'))).toBe(true)
      expect(
        await fs.readFile(path.join(f.root, 'data', 'database'), 'utf8'),
      ).toBe('original-data')
    },
  )
  it('refuses a checksum mismatch, pre-existing maintenance or an unmanaged checkout', async () => {
    const f = await fixture()
    await expect(
      deployRelease({ ...f, digest: '0'.repeat(64) }),
    ).rejects.toThrow('checksum')
    expect(f.journal.some((row) => row.includes('systemctl stop'))).toBe(false)
    await fs.writeFile(path.join(f.control, 'maintenance'), 'investigate')
    await fs.writeFile(path.join(f.root, 'incoming', upload), 'source')
    await expect(deployRelease(f)).rejects.toThrow('Maintenance already')
    expect(await fs.readFile(path.join(f.control, 'maintenance'), 'utf8')).toBe(
      'investigate',
    )
    await fs.unlink(path.join(f.control, 'maintenance'))
    await fs.unlink(path.join(f.root, 'app'))
    await fs.mkdir(path.join(f.root, 'app'))
    await fs.writeFile(path.join(f.root, 'incoming', upload), 'source')
    await expect(deployRelease(f)).rejects.toThrow('symlink')
  })
  it('rolls back an enable failure before opening traffic', async () => {
    const f = await fixture()
    f.fail('systemctl enable')
    await expect(deployRelease(f)).rejects.toThrow()
    expect(
      await fs.readFile(path.join(f.root, 'data', 'database'), 'utf8'),
    ).toBe('original-data')
    expect(maintenanceMode(path.join(f.control, 'maintenance'))).toBe(false)
  })
  it('never rewinds accepted live data after the maintenance gate has opened', async () => {
    const f = await fixture()
    f.log.mockImplementation((message: string) => {
      if (message.startsWith('Deployment healthy:'))
        throw new Error('output sink failed')
    })
    await expect(deployRelease(f)).rejects.toThrow('output sink failed')
    expect(await fs.realpath(path.join(f.root, 'app'))).toBe(f.release)
    expect(
      await fs.readFile(path.join(f.root, 'data', 'database'), 'utf8'),
    ).toBe('new-schema')
    expect(maintenanceMode(path.join(f.control, 'maintenance'))).toBe(false)
  })
})
describe('retiring a restored heartbeat', () => {
  it('removes the lease without migrating legacy schema or changing user records', () => {
    const file = path.join(directory, 'legacy.db')
    const connection = new DatabaseSync(file)
    connection.exec(
      "CREATE TABLE worker (id INTEGER PRIMARY KEY,owner TEXT,heartbeat INTEGER); CREATE TABLE notes (content TEXT); INSERT INTO notes VALUES ('keep'); INSERT INTO worker VALUES (1,'stale',9999999999999)",
    )
    connection.close()
    retireWorkerLease(file)
    const restored = new DatabaseSync(file)
    try {
      expect(restored.prepare('SELECT * FROM worker').all()).toEqual([])
      expect(restored.prepare('SELECT content FROM notes').get()).toMatchObject(
        { content: 'keep' },
      )
      expect(restored.prepare('PRAGMA table_info(worker)').all()).toHaveLength(
        3,
      )
    } finally {
      restored.close()
    }
  })
})

describe('archive and workflow boundaries', () => {
  it('rejects shell/path injection in deployment arguments', () => {
    expect(() => validateRelease(sha, upload, '1'.repeat(64))).not.toThrow()
    for (const args of [
      [sha, '../../etc/passwd', '1'.repeat(64)],
      ['main', upload, '1'.repeat(64)],
      [sha, upload, '$(id)'],
    ])
      expect(() => validateRelease(args[0], args[1], args[2])).toThrow()
  })
  it('extracts regular Git archives and rejects traversal, links and credentials', async () => {
    const create = (name: string, type = 'file') => {
      const archive = path.join(directory, 'source.tar')
      execFileSync('python3', [
        '-c',
        `import tarfile,io,sys\nt=tarfile.open(sys.argv[1],'w');m=tarfile.TarInfo(sys.argv[2]);m.size=2\nif sys.argv[3]=='link': m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd';m.size=0\nt.addfile(m,io.BytesIO(b'ok') if m.isfile() else None);t.close()`,
        archive,
        name,
        type,
      ])
      return archive
    }
    for (const [index, name] of Array.from(
      [
        'src/App.jsx',
        '../escape',
        '/absolute',
        '.env.local',
        '.git/config',
      ].entries(),
    )) {
      const target = path.join(directory, 'extract' + index)
      await fs.mkdir(target)
      const archive = create(name)
      if (index === 0) {
        execFileSync('python3', ['deploy/archive.py', archive, target])
        expect(await fs.readFile(path.join(target, name), 'utf8')).toBe('ok')
      } else
        expect(() =>
          execFileSync('python3', ['deploy/archive.py', archive, target], {
            stdio: 'pipe',
          }),
        ).toThrow()
    }
    const target = path.join(directory, 'links')
    await fs.mkdir(target)
    expect(() =>
      execFileSync(
        'python3',
        ['deploy/archive.py', create('src/link', 'link'), target],
        { stdio: 'pipe' },
      ),
    ).toThrow()
  })
  it('keeps production behind successful CI on main and scopes maintenance to Pixloom routes', async () => {
    const workflow = await fs.readFile('.github/workflows/deploy.yml', 'utf8')
    expect(workflow).toContain('needs: checks')
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'")
    expect(workflow).toContain('ref: ${{ github.sha }}')
    const ci = await fs.readFile('.github/workflows/ci.yml', 'utf8')
    expect(ci).toContain('workflow_call:')
    expect(ci).toContain('pnpm invite:verify')
    vi.stubEnv('PIXLOOM_AUTH_URL', 'https://pixloom.test')
    const config = caddyConfig(publicationConfig())
    expect(config.match(/respond @maintenance/g)).toHaveLength(2)
    expect(config).toContain('root /var/lib/pixloom')
    expect(config).not.toContain('pm2')
  })
})
