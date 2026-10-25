import { NextResponse } from 'next/server'
import { noStore, requireAdmin } from '@/lib/auth'
import { errorResponse, readJson } from '@/lib/http'
import { adminInvitations, adminQuery, invitationSchema } from '@/lib/admin'
import { createInvitation } from '@/lib/tenancy'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    requireAdmin(request)
    return noStore(NextResponse.json(adminInvitations(adminQuery(request))))
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
export async function POST(request: Request) {
  try {
    requireAdmin(request)
    const options = invitationSchema.parse(await readJson(request, 2048))
    return noStore(
      NextResponse.json(createInvitation(options), { status: 201 }),
    )
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
