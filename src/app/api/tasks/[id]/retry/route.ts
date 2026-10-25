import { z } from 'zod'
import { NextResponse } from 'next/server'
import { requireTaskUser } from '@/lib/auth'
import { errorResponse, readJson } from '@/lib/http'
import { getTask, retryAgentTask, StoreError } from '@/lib/store'
import { baselineSchema, initialAgentState } from '@/lib/workspace-api'

const schema = baselineSchema
  .extend({ provider: z.enum(['gemini', 'openai']) })
  .strict()

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireTaskUser(request, params.id)
    const input = schema.parse(await readJson(request))
    const original = getTask(params.id)
    if (
      original.kind !== 'agent' ||
      original.status !== 'failed' ||
      !original.agent
    )
      throw new StoreError('只能重试失败的 AI 任务', 409)
    const agent = initialAgentState(input.provider, original.agent.prompt)
    const { candidateFiles: _, ...task } = retryAgentTask(
      original.id,
      input.expectedRevision,
      input.expectedVersionId,
      agent,
    )
    return NextResponse.json(task, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}
