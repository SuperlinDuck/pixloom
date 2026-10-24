import { startSupabaseOAuth } from '@/lib/cloud/oauth'
import { errorResponse } from '@/lib/http'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    return startSupabaseOAuth(
      request,
      new URL(request.url).searchParams.get('projectId') || '',
    )
  } catch (error) {
    return errorResponse(error)
  }
}
