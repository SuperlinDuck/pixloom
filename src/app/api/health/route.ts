import { releaseSha } from '@/lib/maintenance'
import { db, workerOnline } from '@/lib/store'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    db().prepare('SELECT 1').get()
    const release = releaseSha()
    const ok = workerOnline(release)
    return Response.json(
      { ok, release },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return Response.json(
      { ok: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
