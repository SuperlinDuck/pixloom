import { loadEnvConfig } from '@next/env'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import {
  DockerRuntime,
  containerName,
  dockerCommand,
} from '../src/lib/runtime/docker'
import { templateFiles } from '../src/lib/runtime/template'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
async function main() {
  const runtime = new DockerRuntime()
  const command = process.argv[2] || 'doctor'
  const health = await runtime.health()
  console.log(JSON.stringify(health, null, 2))
  if (!health.available) throw new Error(health.reason || 'Docker 不可用')
  if (command === 'prepare') {
    console.log('正在构建固定镜像，首次需下载基础镜像与依赖。')
    await runtime.prepare()
    console.log('固定 React/Vite 镜像已构建。')
    return
  }
  if (command === 'doctor') {
    if (!health.imageReady) process.exitCode = 1
    return
  }
  if (command !== 'verify')
    throw new Error('支持的命令：doctor / prepare / verify')
  if (!health.imageReady) throw new Error('请先运行 pnpm sandbox:prepare')
  const project = randomUUID(),
    token = randomUUID()
  const files = await templateFiles()
  try {
    await runtime.create(project, token, files)
    assert.equal(await runtime.state(project), 'running')
    const inspection = await dockerCommand([
      'container',
      'inspect',
      containerName(project),
    ])
    const info = JSON.parse(inspection.stdout)[0]
    assert.equal(info.HostConfig.NetworkMode, 'none')
    assert.equal(info.HostConfig.ReadonlyRootfs, true)
    assert.equal(info.HostConfig.Memory, 512 * 1024 * 1024)
    assert.equal(info.HostConfig.PidsLimit, 128)
    assert.equal(info.Config.User, '1000:1000')
    assert.equal(info.Mounts.length, 0)
    assert.equal((await runtime.listFiles(project)).length, 4)
    assert.ok((await runtime.searchFiles(project, 'useState')).length > 0)
    const unicode = '中文🙂'.repeat(7000)
    await runtime.writeFile(project, 'src/probe.txt', unicode)
    assert.equal(await runtime.readFile(project, 'src/probe.txt'), unicode)

    const source = await runtime.readFile(project, 'src/App.jsx')
    assert.ok(source.includes('useState'))
    const changed = source.replace('useState(0)', 'useState(7)')
    await runtime.writeFile(project, 'src/App.jsx', changed)
    const first = await runtime.execute(project, 'build')
    console.log(first.output)
    assert.equal(first.exitCode, 0)
    const preview = await runtime.preview(project, '')
    assert.equal(preview.status, 200)
    const html = Buffer.from(preview.body, 'base64').toString()
    assert.ok(html.includes(`/api/runtime-preview/${token}/`))
    const assetPath = html.match(/src="[^\"]*\/assets\/([^\"]+)"/)?.[1]
    assert.ok(assetPath)
    assert.equal(
      (await runtime.preview(project, 'assets/' + assetPath)).status,
      200,
    )
    await runtime.writeFile(
      project,
      'src/App.jsx',
      'export default function App( {',
    )
    assert.notEqual((await runtime.execute(project, 'build')).exitCode, 0)
    await runtime.stop(project)
    assert.equal(await runtime.state(project), 'stopped')
    await runtime.start(
      project,
      files.map((f) =>
        f.path === 'src/App.jsx' ? { ...f, content: changed } : f,
      ),
    )
    assert.equal(await runtime.readFile(project, 'src/App.jsx'), changed)
    assert.equal((await runtime.execute(project, 'build')).exitCode, 0)
    console.log('PASS 创建、读写、构建、预览资源、构建失败、停止、源码恢复。')
  } finally {
    await runtime.remove(project)
    assert.equal(await runtime.state(project), 'absent')
    console.log('验证容器已清理。')
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
