export const workspaceTabs = [
  'preview',
  'code',
  'history',
  'diff',
  'runtime',
  'cloud',
  'publish',
] as const
export type WorkspaceTab = (typeof workspaceTabs)[number]
export type WorkspaceRoute = {
  projectId: string | null
  tab: WorkspaceTab
  versionId: string | null
}
export const workspaceHome: WorkspaceRoute = {
  projectId: null,
  tab: 'preview',
  versionId: null,
}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

export function parseWorkspacePath(pathname: string): WorkspaceRoute | null {
  if (pathname === '/') return workspaceHome
  const parts = pathname.split('/').slice(1)
  if (parts.shift() !== 'projects') return null
  const projectId = parts.shift()
  if (!projectId || !uuid.test(projectId)) return null
  let versionId: string | null = null
  if (parts[0] === 'versions') {
    parts.shift()
    versionId = parts.shift() || null
    if (!versionId || !uuid.test(versionId)) return null
  }
  const tab = parts.shift() || 'preview'
  if (parts.length || !workspaceTabs.includes(tab as WorkspaceTab)) return null
  return { projectId, tab: tab as WorkspaceTab, versionId }
}

export function workspacePath(route: WorkspaceRoute): string {
  if (!route.projectId) return '/'
  return (
    `/projects/${route.projectId}` +
    (route.versionId ? `/versions/${route.versionId}` : '') +
    (route.tab === 'preview' ? '' : `/${route.tab}`)
  )
}
