import { RuntimeError } from './types'
import { workspaceRequestOrigin } from '../workspace-origin'

export function runtimePreviewHeaders(request: Request, contentType: string) {
  const origin = workspaceRequestOrigin(request)
  if (!origin) throw new RuntimeError('预览地址未获允许', 403)
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
