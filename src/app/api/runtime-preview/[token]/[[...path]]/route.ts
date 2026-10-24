import { runtimePreviewHeaders } from '@/lib/runtime/preview'
import { DockerRuntime } from '@/lib/runtime/docker'
import { runtimeByToken } from '@/lib/runtime/store'
import { errorResponse } from '@/lib/http'
import { RuntimeError } from '@/lib/runtime/types'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { token: string; path?: string[] } },
) {
  try {
    const workspace = runtimeByToken(params.token)
    if (!workspace || !workspace.built || workspace.state !== 'ready')
      throw new RuntimeError('预览不存在或尚未构建，请返回工作台构建预览', 404)
    const asset = await new DockerRuntime().preview(
      workspace.projectId,
      (params.path || []).join('/'),
    )
    const headers = runtimePreviewHeaders(request, asset.contentType)
    return new Response(Buffer.from(asset.body, 'base64'), {
      status: asset.status,
      headers,
    })
  } catch (e) {
    return errorResponse(e)
  }
}
