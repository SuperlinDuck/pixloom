import { requireProjectUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { draftBackups, recoverDraftBackup } from '@/lib/store'
import { errorResponse, readJson } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    return NextResponse.json(draftBackups(params.id))
  } catch (e) {
    return errorResponse(e)
  }
}
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const input = z
      .object({
        backupId: z.string().uuid(),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await readJson(request))
    return NextResponse.json(
      recoverDraftBackup(params.id, input.backupId, input.expectedRevision),
    )
  } catch (e) {
    return errorResponse(e)
  }
}
