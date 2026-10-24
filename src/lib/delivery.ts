import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { versionDelivery } from './store'
import { snapshot } from './workspace-files'
import { createZip, type ArchiveFile } from './zip'

export async function exportVersion(projectId: string, versionId: string) {
  const { project, version, assets } = versionDelivery(projectId, versionId)
  if (snapshot(version.files).hash !== version.hash)
    throw new Error('版本源码校验失败')
  const [packageSource, lock] = await Promise.all(
    ['package.json', 'package-lock.json'].map((name) =>
      readFile(path.join(process.cwd(), 'sandbox/template', name)),
    ),
  )
  const pkg = JSON.parse(packageSource.toString())
  pkg.scripts = {
    dev: 'vite --host 127.0.0.1',
    build: 'vite build',
    preview: 'vite preview --host 127.0.0.1',
  }
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
  const files: ArchiveFile[] = []
  const add = (name: string, content: string | Buffer) =>
    files.push({ path: name, body: Buffer.from(content) })
  for (const file of version.files) add(`source/${file.path}`, file.content)
  add('source/package.json', json(pkg))
  add('source/package-lock.json', lock)
  add(
    'source/vite.config.mjs',
    "export default { base: './', build: { outDir: 'dist', emptyOutDir: true } }\n",
  )

  // Keep every verified byte and its original Vite base, including dynamic asset URLs.
  // A static server rooted at site/ can resolve these paths without Pixloom APIs.
  const base = `/api/previews/${version.artifactId}/`
  for (const asset of assets) add(`site${base}${asset.path}`, asset.body)
  add(
    'site/index.html',
    assets.find((asset) => asset.path === 'index.html')!.body,
  )
  add(
    'README.md',
    `# Pixloom 版本交付包

版本：v${version.number}
版本 ID：${version.id}
源码 SHA-256：${version.hash}

本包固定导出所选版本，不包含工作草稿、其他版本、任务对话或平台配置。
manifest.json 记录来源、构建产物 ID、原始模板镜像标识与各文件 SHA-256。
源码 hash 的算法为：将源码按路径排序，对 JSON.stringify([{path,content}, ...]) 的 UTF-8 内容计算 SHA-256。

## 直接运行已保存的静态产物

在本目录执行：

    python3 -m http.server 8080 --bind 127.0.0.1 --directory site

打开 http://127.0.0.1:8080 。也可将 site/ 的全部内容交给静态服务器，作为独立站点的根目录。
site/api/previews/ 是保留原构建资源路径的静态目录，不需要运行 Pixloom 或调用平台 API。
请保留该目录结构；不要直接双击 HTML，也不要将原始 site/ 产物部署到 URL 子目录。
需要子目录部署时，从 source/ 重新构建并配置相应 base。

## 继续开发或重新构建

需要 Node.js 22.13+（推荐 24）与 npm。在 source/ 中执行：

    npm ci
    npm run dev

构建执行 npm run build，产物在 source/dist/；npm run preview 可本地查看。
源码与所选版本一致；package.json、锁文件来自当前平台固定模板，vite.config.mjs 为独立运行配置，使用相对资源路径。
重新构建使用本机环境，并不保证与原模板镜像产生逐字节相同的产物；site/ 才是该版本已保存的构建快照。

## 验收与发布边界

导出不会重新构建、运行模型或补做验证。手工版本仅保证构建通过；AI 行为验证仅覆盖当时的测试断言。
独立托管时不会自动携带 Pixloom 的 iframe sandbox/CSP 隔离策略，正式上线前需审核应用并配置目标站点的安全策略。
应用数据持久化、后端、登录及数据库不会由导出自动提供；本包不包含业务数据。
本包是交付文件，不代表已经发布到公网。
`,
  )
  const manifest = {
    format: 'pixloom-delivery',
    formatVersion: 1,
    project: { id: project.id, name: project.name },
    version: {
      id: version.id,
      number: version.number,
      parentVersionId: version.parentVersionId,
      restoredFromVersionId: version.restoredFromVersionId,
      source: version.source,
      sourceHash: version.hash,
      templateId: version.templateId,
      artifactId: version.artifactId,
      createdAt: version.createdAt,
    },
    staticSite: { root: 'site/', base, entry: 'index.html' },
    files: files.map((file) => ({
      path: file.path,
      bytes: file.body.length,
      sha256: createHash('sha256').update(file.body).digest('hex'),
    })),
  }
  add('manifest.json', json(manifest))
  return {
    filename: `pixloom-${project.id}-v${version.number}.zip`,
    body: createZip(files),
  }
}
