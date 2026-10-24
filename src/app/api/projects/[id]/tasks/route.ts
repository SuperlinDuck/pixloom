import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createTask, StoreError, workerOnline } from '@/lib/store'
import { modelConfig } from '@/lib/ai/config'
import { errorResponse, readJson } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = z
      .object({
        prompt: z
          .string()
          .trim()
          .min(1, '请输入需求')
          .max(12000, '需求请控制在 12000 字以内'),
        provider: z.enum(['gemini', 'openai']).default('gemini'),
      })
      .parse(await readJson(request))
    const model = modelConfig(input.provider)
    if (!model.configured)
      throw new StoreError(
        '该模型尚未配置 API Key，请设置 .env.local 后重启服务',
        422,
      )
    if (!workerOnline())
      throw new StoreError(
        'Worker 未连接，请运行 pnpm dev 或单独启动 pnpm worker',
        503,
      )
    return NextResponse.json(
      createTask(params.id, input.prompt, input.provider, model.model),
      { status: 202 },
    )
  } catch (e) {
    return errorResponse(e)
  }
}
