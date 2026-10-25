import { artifactManifest } from '@/lib/cloud/manifest'
import { browserAuth } from '@/lib/cloud/browser-auth'
import { workspaceRequestOrigin, workspaceMutationAllowed } from '@/lib/workspace-origin'
import { errorResponse } from '@/lib/http'
import { StoreError } from '@/lib/store'
export const dynamic = 'force-dynamic'
export async function POST(request: Request, {params}: {params: {artifactId: string; action: string}}) {
  try {
    const origin = workspaceRequestOrigin(request)
    if (!origin) throw new StoreError('预览地址未获允许',403)
    const manifest = artifactManifest(params.artifactId)
    if (manifest?.format !== 'pixloom-cloud-v2') throw new StoreError('此预览不支持持久登录',404)
    // App users do not need a workspace Google account. Cookie auth is separate and same-origin only.
    return browserAuth(request, manifest, origin, 'preview', workspaceMutationAllowed(request))
  } catch (error) { return errorResponse(error) }
}
