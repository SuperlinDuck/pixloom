import { withModelBilling } from './billing'
import {
  cloudTestAccount,
  redactTestCredentials,
  assertNoTestCredentials,
} from '../cloud/test-account'
import { enableCloud, inspectSchema } from '../cloud/backend'
import { addEvent as storeAddEvent, checkpointAgent } from '../store'
import { applyOperations, snapshot } from '../workspace-files'
import type { BuildAsset, Task } from '../types'
import type { ModelProvider } from './provider'
import { agentTools, type AgentInput, type ToolCall } from './tools'
import type { BrowserStep, BrowserReport } from '../browser-schema'

function addEvent(
  task: Task,
  message: string,
  metadata: Parameters<typeof storeAddEvent>[2] = {},
) {
  storeAddEvent(task, redactTestCredentials(task.id, message), metadata)
}

export const AGENT_LIMITS = {
  steps: 100,
  toolCalls: 80,
  outputTokens: 48000,
  responseBytes: 1024 * 1024,
  durationMs: 300000,
  failedBuilds: 3,
  failedValidations: 3,
}
export type AgentBuild = {
  artifactId: string
  assets?: BuildAsset[]
  output: string
  ok: boolean
}
export async function runCodingAgent(
  task: Task,
  options: {
    provider: ModelProvider
    signal: AbortSignal
    active: () => boolean
    owner?: string
    build: () => Promise<AgentBuild>
    verify: (build: AgentBuild, steps: BrowserStep[]) => Promise<BrowserReport>
  },
) {
  const state = task.agent!
  const check = () => {
    if (!options.active()) throw new Error('操作已中断')
    if (Date.now() - state.startedAt! >= AGENT_LIMITS.durationMs)
      throw new Error('Coding Agent 超过 5 分钟总时限')
  }
  state.startedAt ??= Date.now()
  state.reservedOutputTokens ??= 0
  checkpointAgent(task, options.owner)
  const session = options.provider.createSession({
    model: state.model,
    signal: options.signal,
    prompt: `用户需求：${state.prompt}\n当前候选文件：${JSON.stringify(task.candidateFiles.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content) })))}\n当前版本：${task.baseVersionId || '尚无'}。先读取相关源码，保留未涉及的功能。`,
  })
  let inputs: AgentInput[] = []
  let lastOutput = '尚未运行构建'
  const cache: { validated: { hash: string; result: AgentBuild } | null } = {
    validated: null,
  }
  let behaviorHash: string | null = null
  const verify = async (result: AgentBuild, steps: BrowserStep[]) => {
    check()
    if ((state.validationFailures || 0) >= AGENT_LIMITS.failedValidations)
      throw new Error('浏览器验证已达到三次失败上限；上一可用版本保留')
    addEvent(
      task,
      steps.length
        ? `验证候选预览的 ${steps.length} 个行为步骤：\n${JSON.stringify(steps).slice(0, 8000)}`
        : '验证候选预览加载与页面错误',
      { type: 'validation' },
    )
    const report = await options.verify(result, steps)
    check()
    lastOutput = report.output.slice(-16000)
    addEvent(task, lastOutput, { type: 'validation' })
    if (!report.ok) {
      behaviorHash = null
      state.validationFailures = (state.validationFailures || 0) + 1
      checkpointAgent(task, options.owner)
      if (state.validationFailures >= AGENT_LIMITS.failedValidations)
        throw new Error('浏览器验证已达到三次失败上限；上一可用版本保留')
    }
    return report
  }
  const build = async () => {
    check()
    if (state.buildFailures >= AGENT_LIMITS.failedBuilds)
      throw new Error('构建修复次数已用尽（最多两轮修复）')
    addEvent(task, '运行候选快照的固定 Vite 构建', { type: 'build' })
    const result = await options.build()
    check()
    lastOutput = result.output.slice(-16000)
    addEvent(task, lastOutput || '构建没有输出', { type: 'build' })
    if (result.ok) {
      const report = await verify(result, [])
      if (!report.ok) {
        cache.validated = null
        return { ok: false, output: lastOutput }
      }
      cache.validated = { hash: snapshot(task.candidateFiles).hash, result }
    } else {
      cache.validated = null
      state.buildFailures++
      checkpointAgent(task, options.owner)
      if (state.buildFailures >= AGENT_LIMITS.failedBuilds)
        throw new Error('构建修复未通过，已达到三次失败上限；上一可用版本保留')
    }
    return { ok: result.ok, output: lastOutput }
  }
  const execute = async (call: ToolCall): Promise<unknown> => {
    const tool = agentTools.find((t) => t.name === call.name)
    if (!tool) return { error: '未知工具' }
    const parsed = tool.schema.safeParse(call.arguments)
    if (!parsed.success) return { error: '工具参数无效，请按定义提供参数' }
    const args = parsed.data
    const files = task.candidateFiles
    const file = () => {
      const f = files.find((f) => f.path === args.path)
      if (!f) throw new Error('文件不存在')
      return f.content
    }
    switch (call.name) {
      case 'cloud_test_account':
        return cloudTestAccount(task, { signal: options.signal, check })
      case 'cloud_enable': {
        const result = await enableCloud(task, {
          signal: options.signal,
          check,
        })
        checkpointAgent(task, options.owner)
        return result
      }
      case 'cloud_schema':
        return inspectSchema(task.projectId, options.signal)
      case 'list_files':
        return files.map((f) => ({
          path: f.path,
          bytes: Buffer.byteLength(f.content),
        }))
      case 'read_file': {
        if (
          args.endLine < args.startLine ||
          args.endLine - args.startLine >= 200
        )
          throw new Error('每次最多读取 200 行')
        const lines = file().split('\n')
        return {
          totalLines: lines.length,
          content: lines
            .slice(args.startLine - 1, args.endLine)
            .map((line, i) => `${i + args.startLine}: ${line}`)
            .join('\n')
            .slice(0, 16000),
        }
      }
      case 'search_files': {
        const matches: { path: string; line: number; text: string }[] = []
        for (const f of files)
          for (const [i, line] of Array.from(f.content.split('\n').entries())) {
            if (line.includes(args.query))
              matches.push({
                path: f.path,
                line: i + 1,
                text: line.slice(0, 240),
              })
            if (matches.length >= 50) return matches
          }
        return matches
      }
      case 'read_errors':
        return { output: lastOutput }
      case 'build':
        return build()
      case 'browser_test': {
        const hash = snapshot(task.candidateFiles).hash
        if (!cache.validated || cache.validated.hash !== hash) {
          const result = await build()
          if (!result.ok) return result
        }
        const report = await verify(cache.validated!.result, args.steps)
        behaviorHash = report.ok ? hash : null
        return report
      }
      default: {
        let next
        try {
          if (call.name === 'delete_file')
            next = applyOperations(files, [{ type: 'delete', path: args.path }])
          else {
            let content = args.content
            if (call.name === 'edit_file') {
              const source = file()
              if (
                !source.includes(args.oldText) ||
                source.indexOf(args.oldText) !==
                  source.lastIndexOf(args.oldText)
              )
                throw new Error('oldText 必须精确匹配一处，请重新读取文件')
              content = source.replace(args.oldText, () => args.newText)
            }
            next = applyOperations(files, [
              { type: 'write', path: args.path, content },
            ])
          }
          assertNoTestCredentials(task.id, next.files)
        } catch (error) {
          return { error: (error as Error).message }
        }
        task.candidateFiles = next.files
        checkpointAgent(task, options.owner)
        return { ok: true, path: args.path, hash: next.hash }
      }
    }
  }
  while (state.steps < AGENT_LIMITS.steps) {
    check()
    const remaining =
      AGENT_LIMITS.outputTokens -
      state.usage.outputTokens -
      state.reservedOutputTokens
    if (remaining < 256 || state.responseBytes >= AGENT_LIMITS.responseBytes)
      throw new Error('Coding Agent 输出预算已用尽')
    // Reserve a turn before requesting, so restarts cannot reset the step budget.
    state.steps++
    const allocation = Math.min(24000, remaining)
    // An interrupted in-flight request keeps its reservation on restart.
    state.reservedOutputTokens += allocation
    checkpointAgent(task, options.owner)
    addEvent(
      task,
      `模型第 ${state.steps}/${AGENT_LIMITS.steps} 步 · ${state.model}`,
      { type: 'model' },
    )
    const turn = await withModelBilling(task, () =>
      session.next(inputs, allocation),
    )
    check()
    state.reservedOutputTokens -= allocation
    state.usage.inputTokens += turn.usage.inputTokens
    state.usage.outputTokens += turn.usage.outputTokens
    state.responseBytes += turn.responseBytes
    checkpointAgent(task, options.owner)
    if (
      state.usage.outputTokens > AGENT_LIMITS.outputTokens ||
      state.responseBytes > AGENT_LIMITS.responseBytes
    )
      throw new Error('Coding Agent 输出预算已用尽')
    if (turn.text) addEvent(task, turn.text.slice(0, 4000), { type: 'model' })
    if (!turn.calls.length) {
      if (!turn.text.trim()) throw new Error('模型没有返回工具调用或完成说明')
      if (
        !cache.validated ||
        cache.validated.hash !== snapshot(task.candidateFiles).hash
      ) {
        const result = await build()
        if (!result.ok) {
          inputs = [
            {
              type: 'user',
              text: `最终构建或浏览器加载检查失败，请读取并修复错误后重试：\n${lastOutput}`,
            },
          ]
          continue
        }
      }
      check()
      if (behaviorHash !== snapshot(task.candidateFiles).hash) {
        inputs = [
          {
            type: 'user',
            text: '候选预览尚未通过当前源码的行为测试。请调用 browser_test，操作所请求功能并断言结果；失败时修复后重试。静态页面也需要内容断言。',
          },
        ]
        continue
      }
      addEvent(task, '构建、页面加载与指定行为测试通过，预览就绪', {
        type: 'ready',
      })
      addEvent(task, turn.text.slice(0, 4000), { type: 'reply' })
      addEvent(
        task,
        `模型累计用量：输入 ${state.usage.inputTokens} / 输出 ${state.usage.outputTokens} tokens`,
        { type: 'usage' },
      )
      return cache.validated!.result
    }
    inputs = []
    for (const call of turn.calls) {
      check()
      if (state.toolCalls >= AGENT_LIMITS.toolCalls)
        throw new Error('Coding Agent 工具调用次数已达上限')
      state.toolCalls++
      checkpointAgent(task, options.owner)
      addEvent(
        task,
        `工具 ${call.name}${typeof call.arguments === 'object' && call.arguments && 'path' in call.arguments ? ` · ${String(call.arguments.path).slice(0, 160)}` : ''}`,
        { type: 'tool', tool: call.name },
      )
      let result: unknown
      // Read/edit validation failures are repairable; build/runtime/storage failures propagate.
      if (['read_file', 'edit_file'].includes(call.name)) {
        try {
          result = await execute(call)
        } catch (error) {
          check()
          if (call.name === 'edit_file') throw error
          result = { error: (error as Error).message }
        }
      } else result = await execute(call)
      check()
      inputs.push({
        type: 'tool',
        id: call.id,
        name: call.name,
        output: JSON.stringify(result),
      })
    }
  }
  throw new Error(
    `Coding Agent 已达到最大 ${AGENT_LIMITS.steps} 步，候选源码保留在任务中`,
  )
}
