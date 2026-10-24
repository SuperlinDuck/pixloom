import { NextResponse } from 'next/server'
import { cancelTask } from '@/lib/store'
import { errorResponse, readJson } from '@/lib/http'
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    await readJson(request)
    return NextResponse.json(cancelTask(params.id))
  } catch (e) {
    return errorResponse(e)
  }
}
