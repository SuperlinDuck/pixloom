import { requireProjectUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDraft, getVersion, updateDraft } from '@/lib/store'
import { operationSchema } from '@/lib/workspace-api'
import { errorResponse, readJson } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const versionId = new URL(request.url).searchParams.get('versionId')
    return NextResponse.json(
      versionId ? getVersion(params.id, versionId) : getDraft(params.id),
    )
  } catch (e) {
    return errorResponse(e)
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const input = z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        operations: z.array(operationSchema).min(1).max(128),
      })
      .strict()
      .parse(await readJson(request, 7 * 1024 * 1024))
    return NextResponse.json(
      updateDraft(params.id, input.expectedRevision, input.operations),
    )
  } catch (e) {
    return errorResponse(e)
  }
}
