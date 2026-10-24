import { NextResponse } from 'next/server'
import { getVersion } from '@/lib/store'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  _: Request,
  { params }: { params: { id: string; versionId: string } },
) {
  try {
    return NextResponse.json(getVersion(params.id, params.versionId))
  } catch (e) {
    return errorResponse(e)
  }
}
