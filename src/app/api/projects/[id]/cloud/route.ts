import { requireProjectUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, readJson } from '@/lib/http'
import { requireWorker } from '@/lib/workspace-api'
import {
  cloudStatus,
  enqueueCloudSetup,
  setCloudPreference,
} from '@/lib/cloud/store'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    return NextResponse.json(cloudStatus(params.id), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const input = z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('managed') }).strict(),
        z
          .object({
            mode: z.literal('external'),
            development: z.string().regex(/^[a-z]{20}$/),
            production: z.string().regex(/^[a-z]{20}$/),
          })
          .strict(),
      ])
      .parse(await readJson(request))
    requireWorker()
    return NextResponse.json(enqueueCloudSetup(params.id, input), {
      status: 202,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const input = z
      .object({ mode: z.enum(['managed', 'external']) })
      .strict()
      .parse(await readJson(request))
    return NextResponse.json(setCloudPreference(params.id, input.mode))
  } catch (error) {
    return errorResponse(error)
  }
}
