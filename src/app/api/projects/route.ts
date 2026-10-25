import { requireWorkspaceUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createProject,
  createAgentProject,
  enqueueTask,
  listProjects,
  workerOnline,
} from '@/lib/store'
import { templateFiles } from '@/lib/runtime/template'
import { errorResponse, readJson } from '@/lib/http'
import { agentRequestSchema, initialAgentState } from '@/lib/workspace-api'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const user = requireWorkspaceUser(request)
    return NextResponse.json(listProjects(user?.id))
  } catch (e) {
    return errorResponse(e)
  }
}
export async function POST(request: Request) {
  try {
    const user = requireWorkspaceUser(request)
    const input = z
      .union([
        agentRequestSchema.strict(),
        z.object({ name: z.string().trim().min(1).max(80) }).strict(),
      ])
      .parse(await readJson(request, 64000))
    if ('prompt' in input) {
      const agent = initialAgentState(input.provider, input.prompt)
      const title = Array.from(input.prompt.replace(/\s+/g, ' '))
        .slice(0, 28)
        .join('')
      const project = createAgentProject(
        title,
        await templateFiles(),
        agent,
        user?.id,
      )
      return NextResponse.json(project, { status: 201 })
    }
    const { name } = input
    const project = createProject(name, await templateFiles(), user?.id)
    if (workerOnline()) enqueueTask(project.id, 'initialize', 0, null)
    return NextResponse.json(project, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
