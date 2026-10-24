import { NextResponse } from 'next/server'
import { restoreVersion } from '@/lib/store'
import { errorResponse, readJson } from '@/lib/http'
export async function POST(
  request: Request,
  { params }: { params: { id: string; versionId: string } },
) {
  try {
    await readJson(request)
    restoreVersion(params.id, params.versionId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
