import { requireProjectUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getVersion } from '@/lib/store'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string; versionId: string } },
) {
  try {
    requireProjectUser(request, params.id)
    return NextResponse.json(getVersion(params.id, params.versionId))
  } catch (e) {
    return errorResponse(e)
  }
}
