import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { templateFiles } from '../src/lib/runtime/template'
import {
  claimTask,
  createProject,
  db,
  enqueueTask,
  getDraft,
  getProject,
  getTask,
  getVersion,
  previewAsset,
  updateDraft,
} from '../src/lib/store'
import { runTask } from '../src/lib/runner'

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixloom-versions-'))
  process.env.PIXLOOM_DATA_DIR = directory
  const runtime = new DockerRuntime()
  const project = createProject('Workspace integration', await templateFiles())
  async function run(
    kind: 'initialize' | 'commit' | 'restore' | 'remove',
    target?: string,
  ) {
    const detail = getProject(project.id)
    enqueueTask(
      project.id,
      kind,
      detail.draft.revision,
      detail.project.currentVersionId,
      target,
    )
    const task = claimTask()!
    await runTask(task, runtime)
    return getTask(task.id)
  }
  try {
    assert.equal((await run('initialize')).status, 'completed')
    const v1 = getVersion(
      project.id,
      getProject(project.id).project.currentVersionId!,
    )
    const html = Buffer.from(
      previewAsset(v1.artifactId, 'index.html').body,
    ).toString()
    assert.ok(html.includes(`/api/previews/${v1.artifactId}/`))
    const script = html.match(/src="[^\"]*\/assets\/([^\"]+)"/)?.[1]
    assert.ok(script)
    assert.ok(previewAsset(v1.artifactId, 'assets/' + script).body.length)
    const source = getDraft(project.id).files.find(
      (f) => f.path === 'src/App.jsx',
    )!.content
    updateDraft(project.id, getDraft(project.id).revision, [
      {
        type: 'write',
        path: 'src/App.jsx',
        content: source.replace('useState(0)', 'useState(7)'),
      },
      { type: 'write', path: 'src/future.jsx', content: 'export default 7' },
    ])
    assert.equal((await run('commit')).status, 'completed')
    const v2 = getProject(project.id).project.currentVersionId!
    updateDraft(project.id, getDraft(project.id).revision, [
      {
        type: 'write',
        path: 'src/App.jsx',
        content: 'export default function App( {',
      },
    ])
    assert.equal((await run('commit')).status, 'failed')
    assert.equal(getProject(project.id).project.currentVersionId, v2)
    assert.ok(previewAsset(v1.artifactId, 'index.html').body.length)
    assert.equal((await run('restore', v1.id)).status, 'completed')
    const v3 = getVersion(
      project.id,
      getProject(project.id).project.currentVersionId!,
    )
    assert.equal(v3.number, 3)
    assert.deepEqual(v3.files, v1.files)
    updateDraft(project.id, getDraft(project.id).revision, [
      {
        type: 'write',
        path: 'src/App.jsx',
        content: source.replace('useState(0)', 'useState(9)'),
      },
    ])
    assert.equal((await run('commit')).status, 'completed')
    assert.equal(getProject(project.id).versions[0].number, 4)
    await assert.rejects(runtime.readFile(project.id, 'src/future.jsx'))
    assert.equal((await run('remove')).status, 'completed')
    assert.ok(previewAsset(v1.artifactId, 'index.html').body.length)
    console.log(
      'PASS v1/v2 构建、失败保留、持久资源、恢复 v3、继续 v4、旧文件清理、移除容器后预览。',
    )
  } finally {
    await runtime.remove(project.id)
    db().close()
    delete (globalThis as { pixloomDb?: unknown }).pixloomDb
    delete process.env.PIXLOOM_DATA_DIR
    await rm(directory, { recursive: true, force: true })
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
