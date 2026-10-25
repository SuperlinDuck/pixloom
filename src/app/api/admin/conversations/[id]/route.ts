import { NextResponse } from 'next/server'
import { noStore, requireAdmin } from '@/lib/auth'
import { errorResponse } from '@/lib/http'
import { adminConversation, adminQuery } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireAdmin(request)
    return noStore(
      NextResponse.json(adminConversation(params.id, adminQuery(request))),
    )
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
