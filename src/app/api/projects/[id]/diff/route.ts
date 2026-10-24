import { requireWorkspaceUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getDraft, getVersion, projectById } from '@/lib/store'
import { diffFiles } from '@/lib/diff'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireWorkspaceUser(request)
    const q = new URL(request.url).searchParams,
      project = projectById(params.id)
    const to = q.get('to') || 'draft'
    const target =
      to === 'draft' ? getDraft(params.id) : getVersion(params.id, to)
    const from =
      q.get('from') ||
      (to === 'draft'
        ? project.currentVersionId
        : 'parentVersionId' in target
          ? target.parentVersionId
          : null)
    const files =
      from && from !== 'empty'
        ? (from === 'draft' ? getDraft(params.id) : getVersion(params.id, from))
            .files
        : []
    return NextResponse.json(diffFiles(files, target.files))
  } catch (e) {
    return errorResponse(e)
  }
}
