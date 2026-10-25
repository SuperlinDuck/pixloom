import { NextResponse } from 'next/server'
import { z } from 'zod'
import { noStore, requireSignedIn } from '@/lib/auth'
import { checkMutation, errorResponse } from '@/lib/http'
import { redeemInvitation } from '@/lib/tenancy'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    const user = requireSignedIn(request)
    checkMutation(request, 1024)
    const text = await request.text()
    if (Buffer.byteLength(text) > 1024)
      return noStore(NextResponse.json({ error: '请求过大' }, { status: 413 }))
    const { code } = z
      .object({ code: z.string().trim().max(100) })
      .strict()
      .parse(JSON.parse(text))
    return noStore(NextResponse.json(redeemInvitation(user.id, code)))
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
