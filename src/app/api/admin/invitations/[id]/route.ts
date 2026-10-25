import { NextResponse } from 'next/server'
import { z } from 'zod'
import { noStore, requireAdmin } from '@/lib/auth'
import { errorResponse, readJson } from '@/lib/http'
import { disableAdminInvitation } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireAdmin(request)
    z.object({ disabled: z.literal(true) })
      .strict()
      .parse(await readJson(request, 1024))
    return noStore(NextResponse.json(disableAdminInvitation(params.id)))
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
