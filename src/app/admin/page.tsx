import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { StoreError } from '@/lib/store'
import { AdminDashboard } from '@/components/admin-dashboard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const metadata = {
  title: '管理后台 · Pixloom',
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  try {
    requireAdmin(new Request('http://localhost/admin', { headers: headers() }))
  } catch (error) {
    if (error instanceof StoreError) notFound()
    throw error
  }
  return <AdminDashboard />
}
