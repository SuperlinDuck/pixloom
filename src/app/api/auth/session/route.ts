import { NextResponse } from 'next/server'
import {
  authRequired,
  currentAccount,
  googleConfigured,
  noStore,
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
        ...(user ? { usage: usageSummary(user.id) } : {}),
      }),
    )
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
