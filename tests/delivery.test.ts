import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import {
  claimTask,
  completeBuild,
  createProject,
  db,
  enqueueTask,
  finishTask,
  getDraft,
  getProject,
  getVersion,
  updateDraft,
} from '../src/lib/store'
import { exportVersion } from '../src/lib/delivery'
import { createZip } from '../src/lib/zip'
import { templateFiles } from '../src/lib/runtime/template'
import { GET } from '../src/app/api/projects/[id]/versions/[versionId]/export/route'
import { middleware } from '../src/middleware'
import { NextRequest } from 'next/server'
import type { SourceFile, TaskKind } from '../src/lib/types'

let directory: string, files: SourceFile[]
// Read the central directory independently of the writer's local-header traversal.
function readZip(zip: Buffer) {
  const end = zip.length - 22
  expect(zip.readUInt32LE(end)).toBe(0x06054b50)
  const entries = new Map<string, Buffer>()
  let cursor = zip.readUInt32LE(end + 16)
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50)
    expect(zip.readUInt16LE(cursor + 10)).toBe(0)
    const size = zip.readUInt32LE(cursor + 24)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString()
    const local = zip.readUInt32LE(cursor + 42)
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    entries.set(name, zip.subarray(start, start + size))
    cursor +=
      46 +
      nameLength +
      zip.readUInt16LE(cursor + 30) +
      zip.readUInt16LE(cursor + 32)
  }
  return entries
}
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex')
function commit(projectId: string, kind: TaskKind = 'commit', target?: string) {
  const detail = getProject(projectId)
  enqueueTask(
    projectId,
    kind,
    detail.draft.revision,
    detail.project.currentVersionId,
    target,
  )
  const task = claimTask()!
  const artifactId = randomUUID()
  const html = `<script type="module" src="/api/previews/${artifactId}/assets/app.js"></script>`
  const assets = [
    {
      path: 'index.html',
      contentType: '',
      body: Buffer.from(html).toString('base64'),
    },
    {
      path: 'assets/app.js',
      contentType: '',
      body: Buffer.from('import("./lazy.js")').toString('base64'),
    },
    {
      path: 'assets/lazy.js',
      contentType: '',
      body: Buffer.from('export default "中文"').toString('base64'),
    },
    {
      path: 'assets/image.png',
      contentType: '',
      body: Buffer.from([0, 255, 128, 1]).toString('base64'),
    },
  ]
  return completeBuild(task, 'sha256:test-template', artifactId, assets)!
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-delivery-test-'))
  process.env.PIXLOOM_DATA_DIR = directory
  files = await templateFiles()
})
beforeEach(() => {
  db().exec('DELETE FROM versions; DELETE FROM projects; DELETE FROM worker;')
})
afterAll(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  delete process.env.PIXLOOM_DATA_DIR
  await rm(directory, { recursive: true, force: true })
})

describe('version delivery', () => {
  it('exports pinned source and a standalone site with unchanged binary and lazy assets', async () => {
    const project = createProject('中文项目', files)
    const v1 = commit(project.id, 'initialize')
    updateDraft(project.id, getDraft(project.id).revision, [
      { type: 'write', path: 'src/private.txt', content: 'only-in-draft' },
    ])
    const before = getProject(project.id),
      draft = getDraft(project.id)
    const bundle = await exportVersion(project.id, v1.id)
    const entries = readZip(bundle.body)
    const manifest = JSON.parse(entries.get('manifest.json')!.toString())
    expect(manifest.version).toMatchObject({
      id: v1.id,
      sourceHash: v1.hash,
      artifactId: v1.artifactId,
    })
    expect(entries.get('source/src/App.jsx')!.toString()).toBe(
      files.find((f) => f.path === 'src/App.jsx')!.content,
    )
    expect(entries.has('source/src/private.txt')).toBe(false)
    expect(
      Array.from(entries.keys()).some(
        (key) => key.includes('.env') || key.includes('pixloom-v3.db'),
      ),
    ).toBe(false)
    const base = `site/api/previews/${v1.artifactId}/`
    expect(entries.get('site/index.html')).toEqual(
      entries.get(`${base}index.html`),
    )
    expect(entries.get(`${base}assets/image.png`)).toEqual(
      Buffer.from([0, 255, 128, 1]),
    )
    expect(entries.get(`${base}assets/app.js`)!.toString()).toBe(
      'import("./lazy.js")',
    )
    expect(entries.get(`${base}assets/lazy.js`)!.toString()).toContain('中文')
    expect(manifest.files).toHaveLength(entries.size - 1)
    for (const file of manifest.files) {
      expect(entries.get(file.path)!.length).toBe(file.bytes)
      expect(sha(entries.get(file.path)!)).toBe(file.sha256)
    }
    const pkg = JSON.parse(entries.get('source/package.json')!.toString())
    const lock = JSON.parse(entries.get('source/package-lock.json')!.toString())
    expect(pkg.dependencies).toEqual(lock.packages[''].dependencies)
    expect(pkg.devDependencies).toEqual(lock.packages[''].devDependencies)
    expect(pkg.scripts).toMatchObject({
      build: 'vite build',
      dev: 'vite --host 127.0.0.1',
    })
    expect(entries.get('source/vite.config.mjs')!.toString()).toContain(
      "base: './'",
    )
    expect(getProject(project.id)).toEqual(before)
    expect(getDraft(project.id)).toEqual(draft)
    expect((await exportVersion(project.id, v1.id)).body).toEqual(bundle.body)
  })

  it('exports historical versions after newer commits and failures without switching the current version', async () => {
    const project = createProject('history', files),
      v1 = commit(project.id, 'initialize')
    updateDraft(project.id, getDraft(project.id).revision, [
      {
        type: 'write',
        path: 'src/App.jsx',
        content: 'export default () => <h1>v2</h1>',
      },
    ])
    const v2 = commit(project.id)
    updateDraft(project.id, getDraft(project.id).revision, [
      {
        type: 'write',
        path: 'src/App.jsx',
        content: 'export default function (',
      },
    ])
    const detail = getProject(project.id)
    enqueueTask(project.id, 'commit', detail.draft.revision, v2.id)
    finishTask(claimTask()!, 'failed-build')
    const bundle = await exportVersion(project.id, v1.id)
    const entries = readZip(bundle.body)
    expect(
      JSON.parse(entries.get('manifest.json')!.toString()).version.number,
    ).toBe(1)
    expect(entries.get('source/src/App.jsx')!.toString()).not.toContain(
      '<h1>v2</h1>',
    )
    expect(getProject(project.id).project.currentVersionId).toBe(v2.id)
    expect(getVersion(project.id, v1.id).artifactId).toBe(v1.artifactId)
  })

  it('uses the pinned artifact even if a preview is rebuilt during template loading', async () => {
    const project = createProject('snapshot', files),
      v1 = commit(project.id, 'initialize')
    const pending = exportVersion(project.id, v1.id)
    const rebuilt = commit(project.id, 'preview', v1.id)
    expect(rebuilt).toBeNull()
    expect(getVersion(project.id, v1.id).artifactId).not.toBe(v1.artifactId)
    const entries = readZip((await pending).body)
    const manifest = JSON.parse(entries.get('manifest.json')!.toString())
    expect(manifest.version.artifactId).toBe(v1.artifactId)
    expect(entries.get('site/index.html')!.toString()).toContain(v1.artifactId)
  })

  it('serves ZIP attachments, refuses cross-project versions and retains the local API boundary', async () => {
    const project = createProject('含引号"\r\n的项目', files),
      version = commit(project.id, 'initialize')
    const other = createProject('other', files)
    const request = new Request('http://127.0.0.1/api')
    const response = await GET(request, {
      params: { id: project.id, versionId: version.id },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="pixloom-${project.id}-v1.zip"`,
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(
      readZip(Buffer.from(await response.arrayBuffer())).has('manifest.json'),
    ).toBe(true)
    for (const params of [
      { id: other.id, versionId: version.id },
      { id: project.id, versionId: randomUUID() },
      { id: randomUUID(), versionId: version.id },
    ])
      expect((await GET(request, { params })).status).toBe(404)
    const blocked = middleware(
      new NextRequest(
        `http://localhost/api/projects/${project.id}/versions/${version.id}/export`,
        {
          headers: { host: 'localhost', 'sec-fetch-site': 'cross-site' },
        },
      ),
    )
    expect(blocked.status).toBe(403)
  })

  it('rejects missing or mismatched artifacts instead of returning an incomplete package', async () => {
    const project = createProject('broken', files),
      version = commit(project.id, 'initialize')
    const params = { id: project.id, versionId: version.id }
    db()
      .prepare('UPDATE preview_artifacts SET sourceHash=? WHERE id=?')
      .run('wrong', version.artifactId)
    expect(
      (await GET(new Request('http://localhost'), { params })).status,
    ).toBe(409)
    db()
      .prepare('UPDATE preview_artifacts SET sourceHash=? WHERE id=?')
      .run(version.hash, version.artifactId)
    db()
      .prepare('DELETE FROM preview_assets WHERE artifactId=? AND path=?')
      .run(version.artifactId, 'index.html')
    expect(
      (await GET(new Request('http://localhost'), { params })).status,
    ).toBe(400)
  })
})

describe('delivery archive bounds', () => {
  it('rejects traversal, duplicate names and file/directory conflicts', () => {
    const file = (name: string) => ({ path: name, body: Buffer.from('x') })
    for (const name of [
      '../x',
      '/root',
      'source/../x',
      'a\\b',
      'a//b',
      '.env',
      'a/./b',
    ])
      expect(() => createZip([file(name)])).toThrow('路径')
    expect(() => createZip([file('a'), file('a')])).toThrow('路径')
    expect(() => createZip([file('a/b'), file('a')])).toThrow('冲突')
    expect(() => createZip([])).toThrow('数量')
  })
  it('bounds file count and total contents before assembling an archive', () => {
    expect(() =>
      createZip(
        Array.from({ length: 257 }, (_, i) => ({
          path: `f${i}`,
          body: Buffer.alloc(0),
        })),
      ),
    ).toThrow('数量')
    expect(() =>
      createZip([{ path: 'large', body: Buffer.alloc(12 * 1024 * 1024 + 1) }]),
    ).toThrow('12 MiB')
  })
})
