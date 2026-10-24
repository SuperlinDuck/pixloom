import { NextResponse } from 'next/server'
import {
  assertAuthOrigin,
  consumeGoogleFlow,
  flowCookie,
  googleConfig,
  googleIdentity,
  loginResponse,
  noStore,
  revokeSession,
  setAuthCookie,
  signInAccount,
} from '@/lib/auth'
import { StoreError } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    assertAuthOrigin(request)
  } catch {
    return noStore(
      NextResponse.json({ error: '登录回调地址配置无效' }, { status: 400 }),
    )
  }
  let reason = 'failed'
  try {
    const flow = consumeGoogleFlow(request)
    const query = new URL(request.url).searchParams
    if (query.has('error')) {
      reason = query.get('error') === 'access_denied' ? 'cancelled' : 'failed'
    } else {
      const code = query.get('code')
      if (!code || code.length > 4096) throw new StoreError('登录授权无效', 400)
      const profile = await googleIdentity(code, flow)
      const session = signInAccount(profile)
      revokeSession(request)
      return loginResponse(session)
    }
  } catch (error) {
    reason =
      error instanceof StoreError && error.status === 403 ? 'account' : 'failed'
  }
  const response = noStore(
    NextResponse.redirect(`${googleConfig().origin}/?auth_error=${reason}`),
  )
  setAuthCookie(response, flowCookie, '', 0)
  return response
}
