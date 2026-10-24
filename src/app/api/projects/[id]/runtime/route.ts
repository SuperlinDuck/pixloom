import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, readJson } from '@/lib/http'
import { getProject, StoreError, workerOnline } from '@/lib/store'
import { DockerRuntime } from '@/lib/runtime/docker'
import { runtimeHealth } from '@/lib/runtime/health'
import { templateFiles } from '@/lib/runtime/template'
import {
  cancelRuntimeJob,
  enqueueRuntimeJob,
  getRuntime,
  reconcileRuntime,
} from '@/lib/runtime/store'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    getProject(params.id)
    const query = new URL(request.url).searchParams
    if (query.has('files'))
      return NextResponse.json(await new DockerRuntime().listFiles(params.id))
    if (query.has('search'))
      return NextResponse.json(
        await new DockerRuntime().searchFiles(params.id, query.get('search')!),
      )
    if (query.has('file')) {
      return NextResponse.json({
        content: await new DockerRuntime().readFile(
          params.id,
          query.get('file')!,
        ),
      })
    }
    if (query.has('logs'))
      return NextResponse.json({
        logs: await new DockerRuntime().logs(params.id),
      })
    let detail = getRuntime(params.id)
    const health = await runtimeHealth(query.has('refresh'))
    let liveState: string | null = null
    if (health.available && detail.workspace) {
      try {
        liveState = await new DockerRuntime().state(params.id)
      } catch {
        liveState = 'unknown'
      }
    }
    if (
      detail.workspace &&
      !detail.jobs.some(
        (job) => job.status === 'queued' || job.status === 'running',
      ) &&
      (liveState === 'absent' || liveState === 'stopped') &&
      detail.workspace.state !== liveState
    ) {
      reconcileRuntime(params.id, liveState, detail.workspace.updatedAt)
      detail = getRuntime(params.id)
    }
    return NextResponse.json({
      ...detail,
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
    const input = z
      .object({
        action: z.enum([
          'create',
          'start',
          'build',
          'stop',
          'remove',
          'write',
          'cancel',
        ]),
        path: z.string().max(160).optional(),
        content: z.string().max(131072).optional(),
      })
      .parse(await readJson(request, 800000))
    getProject(params.id)
    if (input.action === 'cancel') {
      cancelRuntimeJob(params.id)
      return NextResponse.json({ ok: true })
    }
    if (!workerOnline())
      throw new StoreError('Worker 未连接，请运行 pnpm dev', 503)
    const health = await runtimeHealth()
    if (!health.available || (input.action === 'create' && !health.imageReady))
      throw new StoreError(health.reason || 'Docker 环境未就绪', 503)
    const files =
      input.action === 'create' && !getRuntime(params.id).workspace
        ? await templateFiles()
        : []
    return NextResponse.json(
      enqueueRuntimeJob(params.id, input.action, files, {
        path: input.path,
        content: input.content,
      }),
      { status: 202 },
    )
  } catch (e) {
    return errorResponse(e)
  }
}
