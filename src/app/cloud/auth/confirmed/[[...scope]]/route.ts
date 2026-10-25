import { emailConfirmationResponse } from '@/lib/cloud/email-confirmation'

export const dynamic = 'force-dynamic'

export function GET(
  _request: Request,
  { params }: { params: { scope?: string[] } },
) {
  return emailConfirmationResponse(params.scope)
}
