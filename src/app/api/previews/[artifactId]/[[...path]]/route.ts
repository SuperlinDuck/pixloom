import { artifactManifest } from '@/lib/cloud/manifest'
import { previewAsset, StoreError } from '@/lib/store'
import { runtimePreviewHeaders } from '@/lib/runtime/preview'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { artifactId: string; path?: string[] } },
) {
  try {
    const file = (params.path || ['index.html']).join('/')
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(file) ||
      file.split('/').some((p) => !p || p === '.' || p.startsWith('.'))
    )
      throw new StoreError('资源路径无效')
    const asset = previewAsset(params.artifactId, file)
    return new Response(Buffer.from(asset.body), {
      headers: runtimePreviewHeaders(
        request,
        asset.contentType,
        artifactManifest(params.artifactId)?.development.url,
      ),
    })
  } catch (e) {
    return errorResponse(e)
  }
}
