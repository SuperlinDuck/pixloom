import {
  todoSource,
  categorizedTodoSource,
  todoSteps,
  categorizedTodoSteps,
} from '../tests/fixtures/todo'
import type { BrowserStep } from '../src/lib/browser-schema'
import type { ModelProvider } from '../src/lib/ai/provider'
import { loadEnvConfig } from '@next/env'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { templateFiles } from '../src/lib/runtime/template'
import { requireModel } from '../src/lib/ai/config'
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
} from '../src/lib/store'
import { runTask } from '../src/lib/runner'
import type { Provider } from '../src/lib/types'
loadEnvConfig(process.cwd())
async function main() {
  const provider =
    process.argv
      .find((value) => value.startsWith('--provider='))
      ?.split('=')[1] || 'gemini'
  if (!['gemini', 'openai'].includes(provider))
    throw new Error('provider 必须为 gemini 或 openai')
  const live = process.argv.includes('--live')
  const outputDir = process.argv
    .find((value) => value.startsWith('--output-dir='))
    ?.slice('--output-dir='.length)
  const config = live
    ? requireModel(provider as Provider)
    : { model: 'deterministic-fixture' }
  console.log(
    live
      ? '真实调用验收：将候选源码发送给所选模型服务（可能产生费用）'
      : '本地 Docker 验证：使用确定性模型夹具，无模型网络调用',
  )
  const runtime = new DockerRuntime()
  const health = await runtime.health()
  if (!health.available || !health.imageReady)
    throw new Error(health.reason || '请先运行 pnpm sandbox:prepare')
  const directory = await mkdtemp(path.join(tmpdir(), 'pixloom-agent-'))
  process.env.PIXLOOM_DATA_DIR = directory
  const project = createProject(
    'Coding Agent integration',
    await templateFiles(),
  )
  async function run(prompt: string, source: string, steps: BrowserStep[]) {
    const detail = getProject(project.id)
    enqueueTask(
      project.id,
      'agent',
      detail.draft.revision,
      detail.project.currentVersionId,
      undefined,
      undefined,
      {
        provider: provider as Provider,
        model: config.model,
        prompt,
        steps: 0,
        toolCalls: 0,
        buildFailures: 0,
        responseBytes: 0,
        reservedOutputTokens: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        startedAt: null,
      },
    )
    const task = claimTask()!
    console.log(`开始 ${prompt}`)
    let seen = 0
    const timer = setInterval(() => {
      const events = getTask(task.id).events
      for (const event of events.slice(seen))
        console.log(event.message.slice(0, 500))
      seen = events.length
    }, 1000)
    try {
      let step = 0
      const fixture: ModelProvider = {
        createSession: () => ({
          next: async () => {
            step++
            return {
              text: step === 4 ? '完成' : '',
              calls:
                step === 1
                  ? [
                      {
                        id: 'read',
                        name: 'read_file',
                        arguments: {
                          path: 'src/App.jsx',
                          startLine: 1,
                          endLine: 200,
                        },
                      },
                    ]
                  : step === 2
                    ? [
                        {
                          id: 'write',
                          name: 'write_file',
                          arguments: { path: 'src/App.jsx', content: source },
                        },
                        { id: 'build', name: 'build', arguments: {} },
                      ]
                    : step === 3
                      ? [
                          {
                            id: 'browser',
                            name: 'browser_test',
                            arguments: { steps },
                          },
                        ]
                      : [],
              usage: { inputTokens: 0, outputTokens: 0 },
              responseBytes: 0,
            }
          },
        }),
      }
      await runTask(
        task,
        runtime,
        undefined,
        undefined,
        live ? undefined : fixture,
      )
    } finally {
      clearInterval(timer)
    }
    const result = getTask(task.id)
    assert.equal(
      result.status,
      'completed',
      result.error || result.events.at(-1)?.message,
    )
    const version = getVersion(project.id, result.resultVersionId!)
    assert.equal(version.source, 'agent')
    assert.ok(
      result.events.some((event) => event.type === 'ready'),
      '缺少浏览器行为验证完成事件',
    )
    assert.ok(previewAsset(version.artifactId, 'index.html').body.length)
    if (outputDir) {
      await mkdir(outputDir, { recursive: true })
      const assets = (
        db()
          .prepare(
            'SELECT path,contentType,body FROM preview_assets WHERE artifactId=?',
          )
          .all(version.artifactId) as {
          path: string
          contentType: string
          body: Uint8Array
        }[]
      ).map((asset) => ({
        ...asset,
        body: Buffer.from(asset.body).toString('base64'),
      }))
      await writeFile(
        path.join(outputDir, `v${version.number}.json`),
        JSON.stringify({
          version,
          assets,
          agent: result.agent,
          events: result.events,
        }),
      )
    }
    console.log(
      `PASS v${version.number}: ${result.agent!.steps} 步，输出 ${result.agent!.usage.outputTokens} tokens`,
    )
    return version
  }
  try {
    const v1 = await run(
      '创建精简的中文待办应用，仅支持新增、勾选完成、删除。先不添加分类或筛选功能，后续再扩展。使用有标签的输入和按钮；预览禁止原生表单提交，新增操作须使用 type=button 和 onClick；存储不可用时保持内存状态工作。',
      todoSource,
      todoSteps,
    )
    const v2 = await run(
      '增加分类筛选：每个待办可选择工作或生活分类，可按全部、工作、生活筛选。保留新增、勾选完成、删除和 localStorage 持久化功能。',
      categorizedTodoSource,
      categorizedTodoSteps,
    )
    assert.equal(v2.parentVersionId, v1.id)
    assert.notEqual(v2.hash, v1.hash)
    assert.deepEqual(getVersion(project.id, v1.id).files, v1.files)
    assert.deepEqual(getDraft(project.id).files, v2.files)
    assert.equal(getProject(project.id).versions.length, 2)
    console.log(
      'PASS 两轮生成、Docker 构建、浏览器行为验证、父版本关联、不可变历史与预览。',
    )
  } finally {
    await runtime.remove(project.id)
    db().close()
    delete (globalThis as { pixloomDb?: unknown }).pixloomDb
    delete process.env.PIXLOOM_DATA_DIR
    await rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
