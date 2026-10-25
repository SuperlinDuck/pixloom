import { NextResponse } from 'next/server'
import {
  authRequired,
  currentAccount,
  googleConfigured,
  noStore,
  canManagePlatform,
  sessionUser,
} from '@/lib/auth'
import { usageSummary } from '@/lib/tenancy'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const user = currentAccount(request)
    return noStore(
      NextResponse.json({
        configured: googleConfigured(),
        required: authRequired(),
        user,
        ...(user ? { canManage: canManagePlatform(sessionUser(request)) } : {}),
        ...(user ? { usage: usageSummary(user.id) } : {}),
      }),
    )
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
