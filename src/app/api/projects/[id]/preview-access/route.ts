import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireProjectUser } from '@/lib/auth'
import { artifactProject, previewGrant } from '@/lib/preview-access'
import { errorResponse, readJson } from '@/lib/http'
import { StoreError } from '@/lib/store'
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const input = z
      .object({
        artifactId: z.string().uuid(),
        token: z.string().max(100).optional(),
      })
      .strict()
      .parse(await readJson(request, 1024))
    if (artifactProject(input.artifactId) !== params.id)
      throw new StoreError('预览不存在', 404)
    return NextResponse.json(
      previewGrant(request, input.artifactId, input.token),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return errorResponse(error)
  }
}
