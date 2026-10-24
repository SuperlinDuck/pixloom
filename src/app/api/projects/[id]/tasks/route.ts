import { NextResponse } from 'next/server'
import { enqueueTask } from '@/lib/store'
import { errorResponse, readJson } from '@/lib/http'
import {
  agentRequestSchema,
  baselineSchema,
  initialAgentState,
} from '@/lib/workspace-api'
const schema = baselineSchema.merge(agentRequestSchema).strict()
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = schema.parse(await readJson(request, 64000))
    const agent = initialAgentState(input.provider, input.prompt)
    const task = enqueueTask(
      params.id,
      'agent',
      input.expectedRevision,
      input.expectedVersionId,
      undefined,
      undefined,
      agent,
    )
    const { candidateFiles: _files, ...summary } = task
    return NextResponse.json(summary, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}
