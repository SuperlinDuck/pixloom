import { NextResponse, type NextRequest } from 'next/server'

// This first release is a local, single-user workspace. Add authentication before hosting.
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0]
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(hostname) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return NextResponse.json(
      { error: 'Pixloom 当前仅支持本机访问' },
      { status: 403 },
    )
  }
  return NextResponse.next()
}
export const config = { matcher: ['/api/:path*'] }
