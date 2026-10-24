import { NextResponse, type NextRequest } from 'next/server'
import { workspaceRequestOrigin } from './lib/workspace-origin'

// Allow loopback and the explicitly configured workspace/proxy origin.
export function middleware(request: NextRequest) {
  const previewRead =
    request.method === 'GET' &&
    /^\/api\/previews\/[a-f0-9-]{36}(?:\/|$)/.test(request.nextUrl.pathname)
  const googleCallback =
    request.method === 'GET' &&
    ['/api/auth/callback/google', '/api/cloud/supabase/callback'].includes(
      request.nextUrl.pathname,
    )
  if (
    !workspaceRequestOrigin(request) ||
    (request.headers.get('sec-fetch-site') === 'cross-site' &&
      !previewRead &&
      !googleCallback)
  ) {
    return NextResponse.json(
      { error: '不允许从此地址或来源访问 Pixloom' },
      { status: 403 },
    )
  }
  return NextResponse.next()
}
export const config = { matcher: ['/api/:path*'] }
