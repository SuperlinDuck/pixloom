import { addEvent, completeTask, failTask, getProject, getTask } from './store'
import { parseArtifact, providerFor, type ModelProvider } from './ai/provider'
import { validateArtifact } from './artifact'
import type { Task, Usage } from './types'

export async function runTask(
  task: Task,
  provider: ModelProvider = providerFor(task.provider),
  shutdown?: AbortSignal,
) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  shutdown?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 180000)
  const poll = setInterval(() => {
    if (getTask(task.id).status !== 'running') cancel()
  }, 500)
  try {
    const { project, versions, tasks } = getProject(task.projectId)
    const current = versions.find((v) => v.id === project.currentVersionId)
    const history = tasks
      .filter((t) => t.status === 'completed')
      .slice(-6)
      .map((t) => t.prompt)
    let prompt = JSON.stringify({
      projectName: project.name,
      previousRequests: history,
      currentHtml: current?.html || null,
      request: task.prompt,
    })
    addEvent(
      task.id,
      current ? '已读取当前版本，开始增量修改' : '开始根据需求创建应用',
    )
    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) throw new Error('任务已中断')
      addEvent(
        task.id,
        `正在调用 ${task.provider === 'gemini' ? 'Gemini' : 'GPT'} · ${task.model}${attempt ? '（修复）' : ''}`,
      )
      const result = await provider.generate({
        provider: task.provider,
        model: task.model,
        prompt,
        signal: controller.signal,
      })
      usage.inputTokens += result.usage.inputTokens
      usage.outputTokens += result.usage.outputTokens
      if (controller.signal.aborted) throw new Error('任务已中断')
      addEvent(task.id, '已收到代码，检查 HTML 结构与 JavaScript 语法')
      let artifact: { summary: string; html: string }
      let html: string
      try {
        artifact = parseArtifact(result.text)
        html = validateArtifact(artifact.html)
      } catch (error) {
        if (attempt === 1) throw error
        const reason = (error as Error).message
        addEvent(task.id, `检查未通过，尝试修复一次：${reason}`)
        prompt = JSON.stringify({
          originalTask: prompt,
          invalidOutput: result.text.slice(0, 310000),
          validationError: reason,
          instruction: 'Fix the error and return the full JSON artifact.',
        })
        continue
      }
      completeTask(task.id, html, artifact.summary, usage)
      return
    }
  } catch (error) {
    if (shutdown?.aborted) return // Leave running task for recovery on the next Worker start.
    failTask(
      task.id,
      controller.signal.aborted
        ? '生成超时或已中断，请重试'
        : (error as Error).message,
    )
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
    shutdown?.removeEventListener('abort', cancel)
  }
}
