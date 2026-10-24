import { NextResponse } from 'next/server'
import { z } from 'zod'
import { DockerRuntime } from '@/lib/runtime/docker'
import { runtimeHealth } from '@/lib/runtime/health'
import { enqueueTask, getRuntime, projectById, workerOnline } from '@/lib/store'
import { baselineSchema, requireWorker } from '@/lib/workspace-api'
import { errorResponse, readJson } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    projectById(params.id)
    const health = await runtimeHealth(
      new URL(request.url).searchParams.has('refresh'),
    )
    const runtime = new DockerRuntime()
    let liveState: string = 'unknown'
    if (health.available)
      try {
        liveState = await runtime.state(params.id)
      } catch {}
    return NextResponse.json({
      runtime: getRuntime(params.id),
      health,
      liveState,
      workerOnline: workerOnline(),
    })
  } catch (e) {
    return errorResponse(e)
  }
}
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = baselineSchema
      .extend({ action: z.enum(['start', 'stop', 'remove']) })
      .strict()
      .parse(await readJson(request))
    requireWorker()
    const { candidateFiles: _, ...task } = enqueueTask(
      params.id,
      input.action,
      input.expectedRevision,
      input.expectedVersionId,
    )
    return NextResponse.json(task, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}
