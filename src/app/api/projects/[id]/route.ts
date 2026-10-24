import { requireWorkspaceUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getProject, renameProject } from '@/lib/store'
import { errorResponse, readJson } from '@/lib/http'
import { z } from 'zod'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireWorkspaceUser(request)
    return NextResponse.json(getProject(params.id))
  } catch (e) {
    return errorResponse(e)
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(await readJson(request))
    return NextResponse.json(renameProject(params.id, name))
  } catch (e) {
    return errorResponse(e)
  }
}
