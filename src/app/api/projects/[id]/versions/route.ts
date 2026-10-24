import { requireWorkspaceUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { versionSummaries } from '@/lib/store'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireWorkspaceUser(request)
    const query = new URL(request.url).searchParams
    const before = z.coerce
      .number()
      .int()
      .positive()
      .parse(query.get('before') || Number.MAX_SAFE_INTEGER)
    return NextResponse.json(versionSummaries(params.id, 50, before))
  } catch (e) {
    return errorResponse(e)
  }
}
