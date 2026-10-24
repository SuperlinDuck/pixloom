import { artifactDelivery, addEvent, transaction } from '../store'
import type { Task } from '../types'
import type { BrowserVerifier } from '../browser'
import { PublicationFiles } from './files'
import { publicationConfig, publicationTarget } from './config'
import {
  completePublication,
  installationId,
  releaseForTask,
  setReleasePhase,
} from './store'

export type PublicationRuntime = Pick<PublicationFiles, 'stage'> & {
  preflight: (signal: AbortSignal) => Promise<void>
}
export function filePublicationRuntime(): PublicationRuntime {
  const config = publicationConfig(),
    files = new PublicationFiles(config)
  return {
    stage: files.stage.bind(files),
    preflight: async (signal) => {
      const response = await fetch(
        `http://127.0.0.1:${config.port}/_pixloom/health`,
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          redirect: 'error',
        },
      )
      if (!response.ok) throw new Error('发布网关未就绪，请运行 pnpm gateway')
      const health = await response.json()
      if (
        health.installationId !== installationId() ||
        health.rootHash !== config.rootHash ||
        health.domain !== config.domain ||
        health.publicPort !== config.publicPort ||
        !health.enabled
      )
        throw new Error('发布网关与 Worker 的数据库或发布配置不一致')
    },
  }
}
export async function runPublication(
  task: Task,
  options: {
    signal: AbortSignal
    active: () => boolean
    owner?: string
    verify: BrowserVerifier
    runtime?: PublicationRuntime
  },
) {
  const check = () => {
    if (!options.active()) throw new Error('发布已中断')
  }
  check()
  const release = releaseForTask(task)
  if (task.kind === 'unpublish') {
    completePublication(task, options.owner)
    return
  }
  const config = publicationConfig(),
    target = publicationTarget(task.projectId, config)
  if (
    !config.enabled ||
    target.domain !== release.domain ||
    target.url !== release.url
  )
    throw new Error('发布配置已变化或未启用；原线上版本保留')
  const runtime = options.runtime || filePublicationRuntime()
  const checkGateway = async () => {
    try {
      await runtime.preflight(options.signal)
    } catch (error) {
      options.signal.throwIfAborted()
      throw new Error(
        error instanceof Error && error.message.includes('配置')
          ? error.message
          : '发布网关未就绪，请运行 pnpm gateway 并检查端口配置',
      )
    }
  }
  addEvent(task, '检查发布网关与持久化目录')
  await checkGateway()
  check()
  setReleasePhase(task, 'staging', options.owner)
  const assets = transaction(() =>
    artifactDelivery(
      task.projectId,
      release.artifactId,
      release.sourceHash,
      release.templateId,
    ),
  )
  addEvent(task, '暂存固定版本的构建产物，保留当前线上版本')
  const staged = await runtime.stage(
    release,
    assets,
    task.attemptId!,
    options.signal,
  )
  check()
  setReleasePhase(task, 'verifying', options.owner)
  addEvent(task, '验证发布产物加载与页面异常', { type: 'validation' })
  const report = await options.verify(
    release.artifactId,
    staged.map((asset) => ({ ...asset, body: asset.body.toString('base64') })),
    [],
    options.signal,
  )
  check()
  addEvent(task, report.output, { type: 'validation' })
  if (!report.ok) throw new Error('发布页面验证失败，原线上版本保留')
  // Recheck the independent serving process immediately before the atomic pointer update.
  await checkGateway()
  check()
  completePublication(task, options.owner)
}
