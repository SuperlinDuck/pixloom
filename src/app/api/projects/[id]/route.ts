import { NextResponse } from 'next/server'
import { getProject } from '@/lib/store'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(getProject(params.id))
  } catch (e) {
    return errorResponse(e)
  }
}
