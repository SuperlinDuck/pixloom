import { NextResponse } from 'next/server'
import { noStore, requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/http'
import { adminOverview } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  try {
    requireAdmin(request)
    return noStore(NextResponse.json(adminOverview()))
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
