import {
  mkdir,
  lstat,
  realpath,
  open,
  writeFile,
  rename,
  rm,
  readdir,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { validateAssets, assetContentType, db } from '../store'
import type { Release } from '../types'
import { publicationConfig, type PublicationConfig } from './config'

const id = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const assetPath = (value: string) =>
  value.length <= 240 &&
  /^[a-zA-Z0-9_./-]+$/.test(value) &&
  value.split('/').every((part) => part && !part.startsWith('.'))
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex')
const schema = z
  .object({
    artifactId: z.string().regex(id),
    projectId: z.string().regex(id),
    sourceHash: z.string(),
    templateId: z.string(),
    files: z
      .array(
        z
          .object({
            path: z.string().refine(assetPath),
            bytes: z
              .number()
              .int()
              .min(0)
              .max(2 * 1024 * 1024),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            contentType: z.string().max(100),
          })
          .strict(),
      )
      .min(1)
      .max(128),
  })
  .strict()
type Asset = ReturnType<typeof validateAssets>['assets'][number]

export class PublicationFiles {
  constructor(readonly config: PublicationConfig = publicationConfig()) {}
  private async root() {
    await mkdir(this.config.root, { recursive: true })
    if ((await lstat(this.config.root)).isSymbolicLink())
      throw new Error('发布根目录不能是符号链接')
    return realpath(this.config.root)
  }
  private async directory(parts: string[], create = false) {
    let target = await this.root()
    for (const part of parts) {
      target = path.join(target, part)
      if (create) await mkdir(target, { recursive: true })
      const info = await lstat(target)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('发布目录不允许符号链接或特殊文件')
    }
    return target
  }
  private parts(projectId: string, artifactId: string) {
    if (!id.test(projectId) || !id.test(artifactId))
      throw new Error('发布标识无效')
    return [projectId, 'artifacts', artifactId]
  }
  private async read(target: string, limit: number) {
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > limit)
        throw new Error('发布文件无效或超过大小限制')
      return await handle.readFile()
    } finally {
      await handle.close()
    }
  }
  private async manifest(projectId: string, artifactId: string) {
    const directory = await this.directory(this.parts(projectId, artifactId))
    const manifest = schema.parse(
      JSON.parse(
        (
          await this.read(path.join(directory, 'manifest.json'), 128 * 1024)
        ).toString(),
      ),
    )
    if (manifest.projectId !== projectId || manifest.artifactId !== artifactId)
      throw new Error('发布清单不匹配')
    if (
      new Set(manifest.files.map((file) => file.path)).size !==
        manifest.files.length ||
      manifest.files.reduce((sum, file) => sum + file.bytes, 0) >
        8 * 1024 * 1024
    )
      throw new Error('发布清单超过限制或包含重复文件')
    return manifest
  }
  async readAsset(
    projectId: string,
    artifactId: string,
    file: string,
  ): Promise<Asset> {
    if (!assetPath(file)) throw new Error('发布资源路径无效')
    const manifest = await this.manifest(projectId, artifactId)
    const entry = manifest.files.find((entry) => entry.path === file)
    if (!entry)
      throw Object.assign(new Error('发布资源不存在'), { code: 'ENOENT' })
    const parts = file.split('/')
    const directory = await this.directory([
      ...this.parts(projectId, artifactId),
      'site',
      ...parts.slice(0, -1),
    ])
    const body = await this.read(
      path.join(directory, parts[parts.length - 1]),
      entry.bytes,
    )
    if (body.length !== entry.bytes || sha(body) !== entry.sha256)
      throw new Error('发布资源校验失败')
    // MIME comes from the platform's whitelist, never a filesystem manifest header.
    const contentType = assetContentType(file)
    return { path: file, body, contentType }
  }
  async load(release: Release) {
    const manifest = await this.manifest(release.projectId, release.artifactId)
    if (
      manifest.sourceHash !== release.sourceHash ||
      manifest.templateId !== release.templateId
    )
      throw new Error('发布清单与版本不匹配')
    return Promise.all(
      manifest.files.map((file) =>
        this.readAsset(release.projectId, release.artifactId, file.path),
      ),
    )
  }
  async stage(
    release: Release,
    assets: Asset[],
    attemptId: string,
    signal: AbortSignal,
  ) {
    if (!id.test(attemptId)) throw new Error('发布 attempt 无效')
    const parts = this.parts(release.projectId, release.artifactId)
    const parent = await this.directory(parts.slice(0, -1), true)
    // Remove abandoned copies, never a replacement worker's active attempt.
    for (const name of await readdir(parent)) {
      const prefix = `.stage-${release.id}-`
      const oldAttempt = name.startsWith(prefix)
        ? name.slice(prefix.length)
        : ''
      if (
        id.test(oldAttempt) &&
        !db()
          .prepare(
            "SELECT id FROM tasks WHERE id=? AND status='running' AND attemptId=?",
          )
          .get(release.taskId, oldAttempt)
      )
        await rm(path.join(parent, name), { recursive: true, force: true })
    }
    const final = path.join(parent, release.artifactId)
    try {
      await lstat(final)
      return await this.load(release)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const temporary = path.join(parent, `.stage-${release.id}-${attemptId}`)
    await mkdir(temporary)
    try {
      for (const asset of assets) {
        signal.throwIfAborted()
        if (!assetPath(asset.path)) throw new Error('发布资源路径无效')
        const target = path.join(temporary, 'site', asset.path)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, asset.body, { flag: 'wx' })
      }
      await writeFile(
        path.join(temporary, 'manifest.json'),
        JSON.stringify({
          artifactId: release.artifactId,
          projectId: release.projectId,
          sourceHash: release.sourceHash,
          templateId: release.templateId,
          files: assets.map((asset) => ({
            path: asset.path,
            contentType: asset.contentType,
            bytes: asset.body.length,
            sha256: sha(asset.body),
          })),
        }),
        { flag: 'wx' },
      )
      signal.throwIfAborted()
      try {
        await rename(temporary, final)
      } catch (error) {
        if (
          !['EEXIST', 'ENOTEMPTY'].includes(
            (error as NodeJS.ErrnoException).code || '',
          )
        )
          throw error
      }
      return await this.load(release)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
}
