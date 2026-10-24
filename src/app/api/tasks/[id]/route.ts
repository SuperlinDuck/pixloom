import { NextResponse } from 'next/server'
import { getTask, StoreError } from '@/lib/store'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const { candidateFiles, ...task } = getTask(params.id)
    if (new URL(request.url).searchParams.get('candidate') === '1') {
      if (
        task.kind !== 'agent' ||
        !['failed', 'cancelled'].includes(task.status)
      )
        throw new StoreError('仅失败或取消的 AI 任务可以载入候选源码', 409)
      return NextResponse.json({ files: candidateFiles })
    }
    return NextResponse.json(task)
  } catch (e) {
    return errorResponse(e)
  }
}
