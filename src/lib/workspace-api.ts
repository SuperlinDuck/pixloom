import { z } from 'zod'
import { StoreError, workerOnline } from './store'
import { requireModel } from './ai/config'
import type { AgentState, Provider } from './types'
export const agentRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  provider: z.enum(['gemini', 'openai']),
})
export function initialAgentState(
  provider: Provider,
  prompt: string,
): AgentState {
  requireWorker()
  let config
  try {
    config = requireModel(provider)
  } catch (error) {
    throw new StoreError((error as Error).message, 400)
  }
  return {
    provider,
    model: config.model,
    prompt,
    steps: 0,
    toolCalls: 0,
    buildFailures: 0,
    responseBytes: 0,
    reservedOutputTokens: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    startedAt: null,
  }
}
export const baselineSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  expectedVersionId: z.string().uuid().nullable(),
})
export function requireWorker() {
  if (!workerOnline())
    throw new StoreError('Worker 未连接，请运行 pnpm dev 或 pnpm worker', 503)
}
export const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('write'),
      path: z.string().max(160),
      content: z.string().max(131072),
    })
    .strict(),
  z.object({ type: z.literal('delete'), path: z.string().max(160) }).strict(),
  z
    .object({
      type: z.literal('rename'),
      path: z.string().max(160),
      to: z.string().max(160),
    })
    .strict(),
])
