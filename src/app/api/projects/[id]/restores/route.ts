import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enqueueTask } from '@/lib/store'
import { baselineSchema, requireWorker } from '@/lib/workspace-api'
import { errorResponse, readJson } from '@/lib/http'
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = baselineSchema
      .extend({ versionId: z.string().uuid() })
      .strict()
      .parse(await readJson(request))
    requireWorker()
    const { candidateFiles: _, ...task } = enqueueTask(
      params.id,
      'restore',
      input.expectedRevision,
      input.expectedVersionId,
      input.versionId,
    )
    return NextResponse.json(task, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}
