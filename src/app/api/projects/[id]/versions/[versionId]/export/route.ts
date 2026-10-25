import { requireProjectUser } from '@/lib/auth'
import { exportVersion } from '@/lib/delivery'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: { id: string; versionId: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const bundle = await exportVersion(params.id, params.versionId)
    return new Response(bundle.body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${bundle.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
