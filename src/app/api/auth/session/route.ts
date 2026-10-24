import { NextResponse } from 'next/server'
import {
  authRequired,
  currentAccount,
  googleConfigured,
  noStore,
} from '@/lib/auth'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    return noStore(
      NextResponse.json({
        configured: googleConfigured(),
        required: authRequired(),
        user: currentAccount(request),
      }),
    )
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
