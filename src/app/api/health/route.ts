import { db, workerOnline } from '@/lib/store'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    db().prepare('SELECT 1').get()
    const ok = workerOnline()
    return Response.json(
      { ok },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return Response.json(
      { ok: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
