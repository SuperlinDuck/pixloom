import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { db, getTask, StoreError, transaction } from '../store'
import {
  assertAiAvailable,
  dailyUsage,
  ownerOf,
  usageSummary,
} from '../tenancy'
import { limit, modelWeights } from '../platform-config'
import type { Task, Usage } from '../types'

const billing = new AsyncLocalStorage<Task>()
export const withModelBilling = <T>(task: Task, operation: () => Promise<T>) =>
  billing.run(task, operation)
// Reserve once per HTTP attempt, including retries. Unknown outcomes keep their reservation.
export function reserveModelCall(payload: string, maxOutput: number) {
  const task = billing.getStore()
  if (!task?.agent) return undefined
  const userId = ownerOf(task.projectId)
  // Local fixture/developer workspaces retain their existing per-task limits.
  if (!userId && process.env.NODE_ENV !== 'production') return undefined
  if (!userId) throw new StoreError('任务缺少用户归属，拒绝模型调用', 403)
  const input = Buffer.byteLength(payload) // conservative byte bound for replayed history + tool schemas
  const output = maxOutput
  const weight = modelWeights()[
    `${task.agent.provider}:${task.agent.model}`
  ] || { input: 1, output: 4 }
  const credits = input * weight.input + output * weight.output
  return transaction(() => {
    const current = getTask(task.id)
    if (current.status !== 'running' || current.attemptId !== task.attemptId)
      throw new StoreError('任务已中断', 409)
    assertAiAvailable(userId)
    const previous = db()
      .prepare(
        `SELECT COALESCE(sum(COALESCE(inputTokens,inputReserved)),0) AS n, COALESCE(sum(COALESCE(outputTokens,outputReserved)),0) AS output FROM usage_ledger WHERE taskId=?`,
      )
      .get(task.id) as { n: number; output: number }
    if (previous.output + output > 48000)
      throw new StoreError('任务输出预算不足，含未确认调用的预留', 429)
    if (previous.n + input > limit('PIXLOOM_TASK_INPUT_TOKENS', 1_000_000))
      throw new StoreError('任务输入预算不足，请缩小需求', 429)
    if (credits > usageSummary(userId).remainingCredits)
      throw new StoreError(
        '剩余额度不足以执行下一次模型调用，已有项目保留',
        429,
      )
    const daily = dailyUsage()
    if (daily.used + credits > daily.limit)
      throw new StoreError('平台今日 AI 额度不足，请稍后重试', 429)
    const id = randomUUID()
    db()
      .prepare(
        `INSERT INTO usage_ledger (id,taskId,userId,provider,model,day,inputReserved,outputReserved,creditsReserved,createdAt,inputWeight,outputWeight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        task.id,
        userId,
        task.agent!.provider,
        task.agent!.model,
        daily.day,
        input,
        output,
        credits,
        Date.now(),
        weight.input,
        weight.output,
      )
    return { id, weight }
  })
}
export function settleModelCall(
  reservation: ReturnType<typeof reserveModelCall>,
  usage: Usage,
) {
  if (!reservation) return
  const valid = (value: number) => Number.isSafeInteger(value) && value >= 0
  if (!valid(usage.inputTokens) || !valid(usage.outputTokens)) return // Missing/malformed usage stays reserved.
  const credits =
    usage.inputTokens * reservation.weight.input +
    usage.outputTokens * reservation.weight.output
  if (!Number.isSafeInteger(credits)) return
  transaction(() => {
    db()
      .prepare(
        `UPDATE usage_ledger SET inputTokens=?,outputTokens=?,credits=?,status='settled',settledAt=? WHERE id=? AND status='reserved'`,
      )
      .run(
        usage.inputTokens,
        usage.outputTokens,
        credits,
        Date.now(),
        reservation.id,
      )
  })
}
export function releaseModelCall(
  reservation: ReturnType<typeof reserveModelCall>,
) {
  if (!reservation) return
  db()
    .prepare(
      `UPDATE usage_ledger SET inputTokens=0,outputTokens=0,credits=0,status='released',settledAt=? WHERE id=? AND status='reserved'`,
    )
    .run(Date.now(), reservation.id)
}
