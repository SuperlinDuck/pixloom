import { NextResponse } from 'next/server'
import { noStore, requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/http'
import { adminConversations, adminQuery } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    requireAdmin(request)
    return noStore(NextResponse.json(adminConversations(adminQuery(request))))
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
