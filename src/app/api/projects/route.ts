import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createExampleProject, createProject, listProjects } from '@/lib/store'
import { exampleHtml } from '@/lib/example'
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
    const { name, example } = z
      .object({
        name: z.string().trim().min(1, '请输入项目名称').max(80),
        example: z.boolean().default(false),
      })
      .parse(await readJson(request))
    return NextResponse.json(
      example ? createExampleProject(name, exampleHtml) : createProject(name),
      { status: 201 },
    )
  } catch (e) {
    return errorResponse(e)
  }
}
