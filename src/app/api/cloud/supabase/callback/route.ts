import { finishSupabaseOAuth } from '@/lib/cloud/oauth'
import { errorResponse } from '@/lib/http'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    return await finishSupabaseOAuth(request)
  } catch (error) {
    return errorResponse(error)
  }
}
