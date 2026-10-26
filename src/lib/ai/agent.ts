import { withModelBilling } from './billing'
import { codingAgentPrompt } from './context'
import {
  AgentContextHistory,
  contextInputBudget,
  SUMMARY_CHARACTERS,
  SUMMARY_OUTPUT_TOKENS,
  summaryInstructions,
} from './compaction'
import {
  cloudTestAccount,
  redactTestCredentials,
  assertNoTestCredentials,
} from '../cloud/test-account'
import { enableCloud, inspectSchema } from '../cloud/backend'
import { addEvent as storeAddEvent, checkpointAgent, getDraft } from '../store'
import { applyOperations, snapshot } from '../workspace-files'
import type { BuildAsset, Task } from '../types'
import type { ModelProvider } from './provider'
import { agentTools, type AgentInput, type ToolCall } from './tools'
import {
  readSource,
  readSourceEvent,
  searchSource,
  searchSourceEvent,
} from './source-inspection'
import type { BrowserStep, BrowserReport } from '../browser-schema'

function addEvent(
  task: Task,
  message: string,
  metadata: Parameters<typeof storeAddEvent>[2] = {},
) {
  storeAddEvent(task, redactTestCredentials(task.id, message), metadata)
}

export const AGENT_LIMITS = {
  steps: 200,
  toolCalls: 400,
  outputTokensPerCall: 24000,
  durationMs: 1200000,
  failedBuilds: 3,
  failedValidations: 3,
  validationDurationMs: 90000,
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
    ready?: (build: AgentBuild) => void
    verify: (
      build: AgentBuild,
      steps: BrowserStep[],
      onLoaded: () => void,
      timeoutMs: number,
    ) => Promise<BrowserReport>
  },
) {
  const state = task.agent!
  const check = () => {
    if (!options.active()) throw new Error('操作已中断')
    if (Date.now() - state.startedAt! >= AGENT_LIMITS.durationMs)
      throw new Error('Coding Agent 超过 20 分钟总时限')
  }
  state.startedAt ??= Date.now()
  state.reservedOutputTokens ??= 0
  checkpointAgent(task, options.owner)
  const createSession = () =>
    options.provider.createSession({
      model: state.model,
      signal: options.signal,
      prompt: codingAgentPrompt(task),
    })
  let session = createSession()
  let context = new AgentContextHistory()
  let inputs: AgentInput[] = []
  let lastOutput = '尚未运行构建'
  let shownArtifactId: string | undefined
  const initialFrontend = snapshot(
    getDraft(task.projectId).files.filter(
      (file) =>
        file.path !== 'src/pixloom-cloud.js' &&
        file.path !== 'src/pixloom-schema.json' &&
        !file.path.startsWith('src/backend/'),
    ),
  ).hash
  const cache: {
    built: {
      hash: string
      result: AgentBuild
      smoke: BrowserReport
      behavior: BrowserReport | null
      testedSteps: BrowserStep[]
    } | null
  } = {
    built: null,
  }
  const verify = async (result: AgentBuild, steps: BrowserStep[]) => {
    check()
    options.signal.throwIfAborted()
    const remaining =
      AGENT_LIMITS.validationDurationMs - (state.validationDurationMs || 0)
    if (
      (state.validationFailures || 0) >= AGENT_LIMITS.failedValidations ||
      remaining <= 0
    ) {
      const report = {
        ok: false,
        output:
          remaining <= 0
            ? '自动测试已达到 90 秒时间预算，跳过后续浏览器验证；不阻塞版本保存。'
            : '自动测试已失败三次，跳过后续浏览器验证；不阻塞版本保存。',
        completedSteps: 0,
        loaded: false,
      }
      lastOutput = report.output
      addEvent(task, lastOutput, { type: 'validation' })
      return report
    }
    addEvent(
      task,
      steps.length
        ? `验证候选预览的 ${steps.length} 个行为步骤：\n${JSON.stringify(steps).slice(0, 8000)}`
        : '验证候选预览加载与页面错误',
      { type: 'validation' },
    )
    let report: BrowserReport
    let loaded = false
    const onLoaded = () => {
      check()
      options.signal.throwIfAborted()
      if (loaded) return
      if (shownArtifactId !== result.artifactId) {
        options.ready?.(result)
        shownArtifactId = result.artifactId
        addEvent(task, '候选预览已就绪，正在完成检查；完成后保存版本', {
          type: 'validation',
        })
      }
      loaded = true
    }
    const started = Date.now()
    try {
      report = await options.verify(result, steps, onLoaded, remaining)
    } catch (error) {
      // Browser/environment failures are advisory; cancellation and task limits still apply.
      options.signal.throwIfAborted()
      check()
      report = {
        ok: false,
        output: error instanceof Error ? error.message : '浏览器验证异常',
        completedSteps: 0,
      }
    } finally {
      state.validationDurationMs =
        (state.validationDurationMs || 0) + Date.now() - started
    }
    options.signal.throwIfAborted()
    check()
    // Verifiers without progressive callbacks can still expose a successful result.
    if (report.ok) onLoaded()
    lastOutput = report.ok
      ? report.output.slice(-16000)
      : `自动测试告警\n${report.output.slice(-16000)}`
    addEvent(task, lastOutput, { type: 'validation' })
    if (!report.ok) {
      state.validationFailures = (state.validationFailures || 0) + 1
    }
    checkpointAgent(task, options.owner)
    return { ...report, output: lastOutput, loaded }
  }
  const build = async (steps: BrowserStep[] = []) => {
    check()
    const hash = snapshot(task.candidateFiles).hash
    if (!steps.length && cache.built?.hash === hash)
      return {
        ok: true,
        output: cache.built.result.output,
        validation: cache.built.smoke,
      }
    if (state.buildFailures >= AGENT_LIMITS.failedBuilds)
      throw new Error('构建修复次数已用尽（最多两轮修复）')
    addEvent(task, '运行候选快照的固定 Vite 构建', { type: 'build' })
    const result = await options.build()
    check()
    lastOutput = result.output.slice(-16000)
    addEvent(task, lastOutput || '构建没有输出', { type: 'build' })
    if (result.ok) {
      const report = await verify(result, steps)
      cache.built = {
        hash,
        result,
        smoke: report.loaded
          ? { ok: true, output: '页面加载检查通过', completedSteps: 0 }
          : report,
        behavior: steps.length ? report : null,
        testedSteps: steps,
      }
      return { ok: true, output: lastOutput, validation: report }
    } else {
      cache.built = null
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
    if (!parsed.success) {
      if (['read_file', 'search_files'].includes(call.name))
        addEvent(
          task,
          `工具 ${call.name} · 失败：工具参数无效，请按定义提供参数`,
          { type: 'tool', tool: call.name },
        )
      return { error: '工具参数无效，请按定义提供参数' }
    }
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
        const readArgs = {
          path: args.path,
          startLine: args.startLine,
          endLine: args.endLine,
          startColumn: args.startColumn,
        }
        try {
          const result = readSource(file(), readArgs)
          addEvent(task, readSourceEvent(readArgs, result), {
            type: 'tool',
            tool: call.name,
          })
          return result
        } catch (error) {
          const message = (error as Error).message
          addEvent(
            task,
            `工具 read_file · ${args.path} · 请求 ${args.startLine}:${args.startColumn}–${args.endLine} 行 · 失败：${message}`,
            { type: 'tool', tool: call.name },
          )
          return { error: message }
        }
      }
      case 'search_files': {
        const result = searchSource(files, args.query)
        addEvent(task, searchSourceEvent(args.query, result), {
          type: 'tool',
          tool: call.name,
        })
        return result
      }
      case 'read_errors':
        return { output: lastOutput }
      case 'build': {
        const frontend = snapshot(
          files.filter(
            (file) =>
              file.path !== 'src/pixloom-cloud.js' &&
              file.path !== 'src/pixloom-schema.json' &&
              !file.path.startsWith('src/backend/'),
          ),
        ).hash
        if (
          !task.baseVersionId &&
          !cache.built &&
          frontend === initialFrontend &&
          files.some((file) => file.path === 'src/pixloom-schema.json')
        ) {
          return {
            ok: false,
            deferred: true,
            output:
              '首次生成尚未修改页面。请先完成页面、样式和数据库定义，再使用 browser_test 一次完成构建、加载检查和核心功能验证；无需单独构建以读取 schema，当前定义就在 src/pixloom-schema.json。此延期不计为构建失败。',
          }
        }
        return build()
      }
      case 'browser_test': {
        const hash = snapshot(task.candidateFiles).hash
        if (!cache.built || cache.built.hash !== hash) {
          const result = await build(args.steps)
          return result.ok ? result.validation! : result
        }
        if (cache.built.behavior?.ok) {
          return {
            ok: true,
            skipped: true,
            completedSteps: 0,
            testedSteps: cache.built.testedSteps,
            output:
              '当前源码已通过一轮功能测试，本次步骤未执行。请基于已执行的测试如实总结并结束，不要继续扩测；若发现明确的应用问题，先修复源码再验证。',
          }
        }
        const report = await verify(cache.built!.result, args.steps)
        cache.built!.behavior = report
        cache.built!.testedSteps = args.steps
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
    const compact = session.needsCompaction?.(
      inputs,
      AGENT_LIMITS.outputTokensPerCall,
    )
    if (compact && context.empty)
      throw new Error(
        '需求与必要上下文超过模型单次容量，请精简需求或配置更大上下文的模型',
      )
    const allocation = compact
      ? SUMMARY_OUTPUT_TOKENS
      : AGENT_LIMITS.outputTokensPerCall
    const requestSession = compact
      ? options.provider.createSession({
          model: state.model,
          signal: options.signal,
          instructions: summaryInstructions,
          tools: false,
          prompt: context.summaryPrompt(
            codingAgentPrompt(task),
            inputs,
            contextInputBudget(state.provider, state.model, allocation),
          ),
        })
      : session
    if (compact && requestSession.needsCompaction?.([], allocation))
      throw new Error('必要上下文过长，无法生成压缩摘要，请精简需求')
    // Reserve a turn before requesting, so restarts cannot reset the step budget.
    state.steps++
    // Track in-flight allocations for diagnostics, never as a task-wide cap.
    // Account credit reservations are maintained independently by the ledger.
    state.reservedOutputTokens += allocation
    checkpointAgent(task, options.owner)
    addEvent(
      task,
      `模型第 ${state.steps}/${AGENT_LIMITS.steps} 步 · ${state.model}${compact ? ' · 自动压缩上下文' : ''}`,
      { type: 'model' },
    )
    const turn = await withModelBilling(task, () =>
      requestSession.next(compact ? [] : inputs, allocation),
    )
    check()
    state.reservedOutputTokens -= allocation
    state.usage.inputTokens += turn.usage.inputTokens
    state.usage.outputTokens += turn.usage.outputTokens
    state.responseBytes += turn.responseBytes
    checkpointAgent(task, options.owner)
    if (compact) {
      if (!turn.text.trim() || turn.calls.length)
        throw new Error('上下文压缩未返回有效摘要，请重新发起任务')
      state.contextSummary = redactTestCredentials(
        task.id,
        turn.text.trim(),
      ).slice(0, SUMMARY_CHARACTERS)
      checkpointAgent(task, options.owner)
      // Start a fresh native session only after all pending tool results have
      // entered the summary. Never splice signatures or orphan tool outputs.
      session = createSession()
      context = new AgentContextHistory()
      inputs = []
      addEvent(task, '上下文已自动压缩，保留需求和开发进展后继续生成', {
        type: 'model',
      })
      continue
    }
    context.record(inputs, turn)
    if (turn.text && turn.calls.length)
      addEvent(task, turn.text.slice(0, 4000), { type: 'model' })
    if (!turn.calls.length) {
      if (!turn.text.trim()) throw new Error('模型没有返回工具调用或完成说明')
      if (
        !cache.built ||
        cache.built.hash !== snapshot(task.candidateFiles).hash
      ) {
        const result = await build()
        if (!result.ok) {
          inputs = [
            {
              type: 'user',
              text: `最终构建失败，请读取并修复错误后重试：\n${lastOutput}`,
            },
          ]
          continue
        }
      }
      check()
      const built = cache.built!
      const warning =
        !built.smoke.ok || built.behavior?.ok === false
          ? '自动测试未通过或未完成，请在预览中检查实际效果。'
          : !built.behavior
            ? '尚未进行功能测试，请在预览中检查实际效果。'
            : ''
      addEvent(task, `构建成功，预览就绪。${warning}`, {
        type: 'ready',
      })
      addEvent(
        task,
        turn.text.slice(0, 4000) +
          (warning ? `\n\n自动测试提示：${warning}` : ''),
        { type: 'reply' },
      )
      addEvent(
        task,
        `模型累计用量：输入 ${state.usage.inputTokens} / 输出 ${state.usage.outputTokens} tokens`,
        { type: 'usage' },
      )
      return built.result
    }
    inputs = []
    for (const call of turn.calls) {
      check()
      if (state.toolCalls >= AGENT_LIMITS.toolCalls)
        throw new Error('Coding Agent 工具调用次数已达上限')
      state.toolCalls++
      checkpointAgent(task, options.owner)
      if (!['read_file', 'search_files'].includes(call.name))
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
