import { NextResponse } from 'next/server'
import {
  flowCookie,
  noStore,
  revokeSession,
  sessionCookie,
  setAuthCookie,
} from '@/lib/auth'
import { checkMutation, errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    checkMutation(request)
    revokeSession(request)
    const response = noStore(NextResponse.json({ ok: true }))
    setAuthCookie(response, sessionCookie, '', 0)
    setAuthCookie(response, flowCookie, '', 0)
    return response
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
