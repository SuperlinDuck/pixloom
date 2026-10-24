import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createProject,
  enqueueTask,
  listProjects,
  workerOnline,
} from '@/lib/store'
import { templateFiles } from '@/lib/runtime/template'
import { errorResponse, readJson } from '@/lib/http'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    return NextResponse.json(listProjects())
  } catch (e) {
    return errorResponse(e)
  }
}
export async function POST(request: Request) {
  try {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(await readJson(request))
    const project = createProject(name, await templateFiles())
    if (workerOnline()) enqueueTask(project.id, 'initialize', 0, null)
    return NextResponse.json(project, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
