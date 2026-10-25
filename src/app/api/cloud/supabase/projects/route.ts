import { NextResponse } from 'next/server'
import { requireWorkspaceUser } from '@/lib/auth'
import { connectionId } from '@/lib/cloud/store'
import { externalToken } from '@/lib/cloud/oauth'
import { listSupabaseProjects } from '@/lib/cloud/api'
import { errorResponse } from '@/lib/http'
import { StoreError } from '@/lib/store'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const user = requireWorkspaceUser(request)
    const id = connectionId(user?.id)
    if (!id) throw new StoreError('请先连接 Supabase', 409)
    return NextResponse.json(
      await listSupabaseProjects(
        await externalToken(id, request.signal),
        request.signal,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return errorResponse(error)
  }
}
