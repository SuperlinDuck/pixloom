import { NextResponse } from 'next/server'
import { assertAuthOrigin, startGoogleLogin, noStore } from '@/lib/auth'
import { StoreError } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    assertAuthOrigin(request)
    return await startGoogleLogin()
  } catch (error) {
    if (error instanceof StoreError)
      return noStore(
        NextResponse.json({ error: error.message }, { status: error.status }),
      )
    console.error(
      'Pixloom Google login initialization:',
      error instanceof Error ? error.name : 'Unknown error',
    )
    return noStore(
      NextResponse.json(
        { error: 'Google 登录初始化失败，请检查服务日志' },
        { status: 503 },
      ),
    )
  }
}
