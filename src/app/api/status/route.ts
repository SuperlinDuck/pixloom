import { NextResponse } from 'next/server'
import { modelOptions } from '@/lib/ai/config'
import { workerOnline } from '@/lib/store'
import { errorResponse } from '@/lib/http'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    return NextResponse.json({
      models: modelOptions(),
      workerOnline: workerOnline(),
      storage: 'sqlite',
    })
  } catch (e) {
    return errorResponse(e)
  }
}
