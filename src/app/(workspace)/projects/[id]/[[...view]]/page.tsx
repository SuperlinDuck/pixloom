import { notFound, redirect } from 'next/navigation'
import { parseWorkspacePath, workspacePath } from '@/lib/workspace-route'

export default function ProjectPage({
  params,
}: {
  params: { id: string; view?: string[] }
}) {
  const path = `/projects/${params.id}${params.view ? `/${params.view.join('/')}` : ''}`
  const route = parseWorkspacePath(path)
  if (!route) notFound()
  const canonical = workspacePath(route)
  if (canonical !== path) redirect(canonical)
  return null
}
