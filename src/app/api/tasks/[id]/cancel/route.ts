import { requireTaskUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { cancelTask } from '@/lib/store'
import { errorResponse, readJson } from '@/lib/http'
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireTaskUser(request, params.id)
    await readJson(request)
    const { candidateFiles: _, ...task } = cancelTask(params.id)
    return NextResponse.json(task)
  } catch (e) {
    return errorResponse(e)
  }
}
