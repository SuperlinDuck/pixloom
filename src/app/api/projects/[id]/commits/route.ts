import { requireProjectUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enqueueTask, projectById } from '@/lib/store'
import { baselineSchema, requireWorker } from '@/lib/workspace-api'
import { errorResponse, readJson } from '@/lib/http'
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const input = baselineSchema
      .extend({ summary: z.string().trim().max(500).optional() })
      .strict()
      .parse(await readJson(request))
    requireWorker()
    const project = projectById(params.id)
    const task = enqueueTask(
      params.id,
      project.currentVersionId ? 'commit' : 'initialize',
      input.expectedRevision,
      input.expectedVersionId,
      undefined,
      input.summary,
    )
    const { candidateFiles: _, ...result } = task
    return NextResponse.json(result, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}
