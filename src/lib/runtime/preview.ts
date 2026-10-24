import { RuntimeError } from './types'
import { workspaceRequestOrigin } from '../workspace-origin'

export function runtimePreviewHeaders(
  request: Request,
  contentType: string,
  backendOrigin?: string,
) {
  const origin = workspaceRequestOrigin(request)
  if (!origin) throw new RuntimeError('预览地址未获允许', 403)
  if (
    backendOrigin &&
    !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(backendOrigin)
  )
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
