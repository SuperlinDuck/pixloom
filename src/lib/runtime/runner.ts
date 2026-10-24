import { DockerRuntime } from './docker'
import {
  finishRuntimeJob,
  getRuntime,
  runtimeEvent,
  runtimeJob,
  updateRuntime,
  updateRuntimeForJob,
} from './store'
import type { ProjectRuntime, RuntimeJob } from './types'

export async function runRuntimeJob(
  job: RuntimeJob,
  runtime: ProjectRuntime = new DockerRuntime(),
  shutdown?: AbortSignal,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  shutdown?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 150000)
  const poll = setInterval(() => {
    if (runtimeJob(job.id).status !== 'running') abort()
  }, 400)
  const id = job.projectId
  try {
    const workspace = getRuntime(id).workspace!
    runtimeEvent(
      job.id,
      {
        create: '创建独立容器并写入 React 模板',
        start: '启动容器并恢复已保存的源码',
        build: '在容器中构建 React 应用',
        stop: '停止容器，源码保留在本机数据库',
        remove: '移除容器，源码快照仍然保留',
        write: `保存源码 ${job.payload.path}`,
      }[job.action],
    )
    if (
      shutdown?.aborted ||
      controller.signal.aborted ||
      runtimeJob(job.id).status !== 'running'
    )
      throw new Error('操作已中断')
    if (job.action === 'create') {
      // Recovery can encounter a container created before the Worker was interrupted.
      if ((await runtime.state(id)) === 'absent')
        await runtime.create(
          id,
          workspace.token,
          workspace.files,
          controller.signal,
        )
      else {
        await runtime.stop(id)
        await runtime.start(id, workspace.files, controller.signal)
      }
      updateRuntimeForJob(job.id, 'running', false)
    } else if (job.action === 'start') {
      const previous = await runtime.state(id)
      if (
        previous === 'running' &&
        !['running', 'ready'].includes(workspace.state)
      )
        await runtime.stop(id)
      await runtime.start(id, workspace.files, controller.signal)
      updateRuntimeForJob(
        job.id,
        previous === 'running' && workspace.built ? 'ready' : 'running',
        previous === 'running' && workspace.built,
      )
    } else if (job.action === 'build') {
      updateRuntimeForJob(job.id, 'running', false)
      const result = await runtime.execute(id, 'build', controller.signal)
      runtimeEvent(job.id, result.output || '构建命令没有输出')
      if (result.exitCode !== 0)
        throw new Error(
          result.timedOut
            ? '构建超过 90 秒，子进程已终止'
            : `构建失败（退出码 ${result.exitCode}），请查看操作日志`,
        )
      updateRuntimeForJob(job.id, 'ready', true)
    } else if (job.action === 'write') {
      updateRuntimeForJob(job.id, 'running', false)
      await runtime.writeFile(
        id,
        job.payload.path!,
        job.payload.content!,
        controller.signal,
      )
      const files = workspace.files
        .filter((f) => f.path !== job.payload.path)
        .concat({ path: job.payload.path!, content: job.payload.content! })
      updateRuntimeForJob(job.id, 'running', false, files)
    } else if (job.action === 'stop') {
      await runtime.stop(id)
      updateRuntimeForJob(job.id, 'stopped', false)
    } else {
      await runtime.remove(id)
      updateRuntimeForJob(job.id, 'absent', false)
    }
    if (controller.signal.aborted || runtimeJob(job.id).status !== 'running') {
      await runtime.stop(id)
      updateRuntime(id, 'stopped', false)
      return
    }
    runtimeEvent(
      job.id,
      job.action === 'build' ? '构建完成，隔离预览已就绪' : '操作完成',
    )
    finishRuntimeJob(job.id)
  } catch (error) {
    const message = controller.signal.aborted
      ? '操作已中断，容器已尝试停止，可重新启动'
      : (error as Error).message
    if (controller.signal.aborted) await runtime.stop(id).catch(() => {})
    updateRuntime(id, 'error', false)
    if (shutdown?.aborted) return // Recovered by the next Worker lease owner.
    runtimeEvent(job.id, message)
    finishRuntimeJob(job.id, message)
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
    shutdown?.removeEventListener('abort', abort)
  }
}
