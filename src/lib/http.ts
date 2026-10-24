import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { StoreError } from './store'

export function errorResponse(error: unknown) {
  if (error instanceof StoreError)
    return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message || '输入无效' },
      { status: 400 },
    )
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: '请求不是有效 JSON' }, { status: 400 })
  console.error(
    'Pixloom API error:',
    error instanceof Error ? error.name : 'Unknown error',
  )
  return NextResponse.json(
    { error: '操作失败，请检查服务日志' },
    { status: 500 },
  )
}
export function checkMutation(request: Request) {
  const origin = request.headers.get('origin')
  const url = new URL(request.url)
  const host = request.headers.get('host') || url.host
  if (origin && new URL(origin).host !== host)
    throw new StoreError('不允许跨站请求', 403)
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new StoreError('请求必须使用 JSON', 415)
  const size = Number(request.headers.get('content-length') || 0)
  if (size > 32000) throw new StoreError('请求过大', 413)
}
export async function readJson(request: Request) {
  checkMutation(request)
  const text = await request.text()
  if (Buffer.byteLength(text) > 32000) throw new StoreError('请求过大', 413)
  return JSON.parse(text)
}
