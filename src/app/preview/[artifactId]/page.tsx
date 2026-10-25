import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { artifactProject, requireArtifactUser } from '@/lib/preview-access'
import { workspaceOrigin } from '@/lib/workspace-origin'
import { notFound } from 'next/navigation'
import { TrustedPreview } from '@/components/trusted-preview'
import { previewAsset } from '@/lib/store'
export const dynamic = 'force-dynamic'
export default function Preview({
  params,
}: {
  params: { artifactId: string }
}) {
  try {
    requireArtifactUser(
      new Request(`${workspaceOrigin()}/preview/${params.artifactId}`, {
        headers: headers(),
      }),
      params.artifactId,
    )
  } catch (error) {
    if ((error as { status?: number }).status === 401) redirect('/')
    notFound()
  }
  try {
    previewAsset(params.artifactId, 'index.html')
  } catch {
    notFound()
  }
  return (
    <main style={{ height: '100dvh', width: '100%', overflow: 'hidden' }}>
      <TrustedPreview
        projectId={artifactProject(params.artifactId)}
        artifactId={params.artifactId}
        title="应用预览"
        className="standalone-preview"
      />
    </main>
  )
}
