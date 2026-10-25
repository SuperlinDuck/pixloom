import { authorizePreviewAsset } from '@/lib/preview-access'
import { artifactManifest, manifestEndpoint } from '@/lib/cloud/manifest'
import { previewAsset, StoreError } from '@/lib/store'
import { runtimePreviewHeaders } from '@/lib/runtime/preview'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { artifactId: string; path?: string[] } },
) {
  try {
    const { file, base } = authorizePreviewAsset(
      request,
      params.artifactId,
      params.path || [],
    )
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(file) ||
      file.split('/').some((p) => !p || p === '.' || p.startsWith('.'))
    )
      throw new StoreError('资源路径无效')
    const asset = previewAsset(params.artifactId, file)
    let body = Buffer.from(asset.body)
    if (
      base &&
      /(?:javascript|text\/html|text\/css|application\/json)/.test(
        asset.contentType,
      )
    )
      body = Buffer.from(
        body
          .toString('utf8')
          .replaceAll(`/api/previews/${params.artifactId}/`, base),
      )
    return new Response(body, {
      headers: runtimePreviewHeaders(
        request,
        asset.contentType,
        manifestEndpoint(artifactManifest(params.artifactId)),
      ),
    })
  } catch (e) {
    return errorResponse(e)
  }
}
