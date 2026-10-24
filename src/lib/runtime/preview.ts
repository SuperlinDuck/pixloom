import { RuntimeError } from './types'

export function runtimePreviewHeaders(request: Request, contentType: string) {
  // Next may normalize request.url to localhost even when the browser used 127.0.0.1.
  // Use the validated actual Host so the CSP allows this preview's ES module URLs.
  const url = new URL(request.url)
  const host = request.headers.get('host') || url.host
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))
    throw new RuntimeError('预览只允许本机 Host', 403)
  const origin = new URL(`${url.protocol}//${host}`).origin
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data:; font-src ${origin} data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
}
