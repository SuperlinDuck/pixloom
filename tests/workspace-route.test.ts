import { describe, expect, it } from 'vitest'
import {
  parseWorkspacePath,
  workspaceHome,
  workspacePath,
  workspaceTabs,
} from '../src/lib/workspace-route'

const projectId = '9813a779-f7b0-4aa4-8840-9d602401ecf6'
const versionId = 'eb6ba059-eebf-4949-a990-c1e5e6cf4cba'

describe('workspace addresses', () => {
  it('supports direct links to every project view and historical version', () => {
    expect(parseWorkspacePath('/')).toEqual(workspaceHome)
    for (const tab of workspaceTabs) {
      for (const version of [null, versionId]) {
        const route = { projectId, tab, versionId: version }
        const path = workspacePath(route)
        expect(path).toBe(
          `/projects/${projectId}` +
            (version ? `/versions/${version}` : '') +
            (tab === 'preview' ? '' : `/${tab}`),
        )
        expect(parseWorkspacePath(path)).toEqual(route)
      }
    }
  })

  it('rejects malformed identifiers, unsupported views and extra segments', () => {
    for (const path of [
      '/projects',
      '/projects/not-an-id',
      '/projects/../../api/projects',
      `/projects/${projectId}/settings`,
      `/projects/${projectId}/code/extra`,
      `/projects/${projectId}/versions`,
      `/projects/${projectId}/versions/no-version`,
      `/projects/${projectId}/versions/${versionId}/code/extra`,
      `/preview/${versionId}`,
    ])
      expect(parseWorkspacePath(path)).toBeNull()
  })
})
