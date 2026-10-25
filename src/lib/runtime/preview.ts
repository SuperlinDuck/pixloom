import { RuntimeError } from './types'
import { workspaceRequestOrigin } from '../workspace-origin'

export function runtimePreviewHeaders(
  request: Request,
  contentType: string,
  backendOrigin?: string,
) {
  const origin = workspaceRequestOrigin(request)
  if (!origin) throw new RuntimeError('预览地址未获允许', 403)
  if (backendOrigin && !validCloudEndpoint(backendOrigin))
    throw new RuntimeError('Cloud 预览端点无效', 403)
  const previewPath =
    new URL(request.url).pathname.match(
      /^\/api\/previews\/[a-f0-9-]{36}\//,
    )?.[0] || '/'
  const connect = backendOrigin
    ? `${origin}${previewPath} ${backendOrigin}`
    : "'none'"
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data: ${backendOrigin ? 'blob: ' + backendOrigin : ''}; font-src ${origin} data:; connect-src ${connect}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
}
export function validCloudEndpoint(value: string) {
  if (/^https:\/\/[a-z]{20}\.supabase\.co$/.test(value)) return true
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(url.hostname))) &&
      /^\/cloud\/v2\/apps\/[a-f0-9-]{36}\/environments\/(development|production)\/[a-f0-9-]{36}\/$/.test(
        url.pathname,
      )
    )
  } catch {
    return false
  }
}
