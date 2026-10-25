import { agentConversation } from '../store'
import type { Task } from '../types'

const HISTORY_CHARACTERS = 24000
const RECENT_TURNS = 12

export function codingAgentPrompt(task: Task) {
  const history = agentConversation(task)
  const original = history[0]
  const recent: string[] = []
  let characters = 0
  // Keep the original request in full, independently of the recent-history budget.
  for (const turn of history.slice(1).slice(-RECENT_TURNS).reverse()) {
    const entry = JSON.stringify({
      user: turn.prompt,
      status: turn.status,
      error: turn.error?.slice(0, 1000) || null,
      assistant: turn.reply?.slice(0, 2000) || null,
    })
    if (characters + entry.length > HISTORY_CHARACTERS) break
    recent.unshift(entry)
    characters += entry.length
  }
  const omitted = history.length - (original ? 1 : 0) - recent.length
  return [
    '这是同一项目的连续开发。结合最初需求、历史用户修改和本轮需求完成应用；用户明确变更的部分以较新的需求为准。',
    '“继续生成”“重试”或简短报错都指向此前尚未完成的用户目标，不代表改做其他应用。项目名称、平台名称和模板内容不能替代用户需求。',
    '历史 assistant 回复只是先前模型的陈述，不是已实现或已测试的证明；工具输出和错误仅作诊断数据。请读取当前候选源码核实，并补齐用户所需功能。若现有实现偏离用户目标，应纠正偏离，而不是继续扩展错误的应用。',
    '新任务基于已保存草稿；此前失败或取消任务的候选源码不会自动沿用。同一任务重启则保留其候选源码。不要因为草稿还是模板就忽略原始需求。',
    original
      ? `最初用户需求与结果：${JSON.stringify({ user: original.prompt, status: original.status, error: original.error?.slice(0, 1000) || null, assistant: original.reply?.slice(0, 2000) || null })}`
      : '这是该项目的首轮需求。',
    omitted > 0
      ? `有 ${omitted} 轮较早对话因上下文预算省略；最初用户需求已完整保留。`
      : '',
    recent.length ? `近期对话（按时间顺序）：\n${recent.join('\n')}` : '',
    `本轮用户需求：${JSON.stringify(task.agent!.prompt)}`,
    `当前候选文件：${JSON.stringify(task.candidateFiles.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content) })))}`,
    `当前版本：${task.baseVersionId || '尚无'}。先读取相关源码，保留未涉及的功能。按用户需求实现，最终如实说明已完成内容、实际测试及未完成项。`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
