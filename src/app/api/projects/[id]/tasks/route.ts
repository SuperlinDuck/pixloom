import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enqueueTask, StoreError } from '@/lib/store'
import { requireModel } from '@/lib/ai/config'
import { errorResponse, readJson } from '@/lib/http'
import { baselineSchema, requireWorker } from '@/lib/workspace-api'
const schema = baselineSchema
  .extend({
    prompt: z.string().trim().min(1).max(8000),
    provider: z.enum(['gemini', 'openai']),
  })
  .strict()
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = schema.parse(await readJson(request, 64000))
    requireWorker()
    let config
    try {
      config = requireModel(input.provider)
    } catch (error) {
      throw new StoreError((error as Error).message, 400)
    }
    const task = enqueueTask(
      params.id,
      'agent',
      input.expectedRevision,
      input.expectedVersionId,
      undefined,
      undefined,
      {
        provider: input.provider,
        model: config.model,
        prompt: input.prompt,
        steps: 0,
        toolCalls: 0,
        buildFailures: 0,
        responseBytes: 0,
        reservedOutputTokens: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        startedAt: null,
      },
    )
    const { candidateFiles: _files, ...summary } = task
    return NextResponse.json(summary, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}
