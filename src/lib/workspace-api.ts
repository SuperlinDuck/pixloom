import { z } from 'zod'
import { StoreError, workerOnline } from './store'
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
