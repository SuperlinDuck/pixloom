'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  parseWorkspacePath,
  workspaceHome,
  workspacePath,
  type WorkspaceRoute,
} from '@/lib/workspace-route'

const positionKey = 'pixloomWorkspacePosition'

// All workspace URLs share one layout. History API navigation keeps the editor
// mounted, while direct visits are resolved by the matching Next.js pages.
export function useWorkspaceNavigation(beforeLeave: () => Promise<boolean>) {
  const pathname = usePathname()
  const [route, setRoute] = useState(
    () => parseWorkspacePath(pathname) || workspaceHome,
  )
  const current = useRef(route)
  const position = useRef(0)
  const pending = useRef(false)
  const guard = useRef(beforeLeave)
  guard.current = beforeLeave

  const accept = useCallback((next: WorkspaceRoute, index: number) => {
    current.current = next
    position.current = index
    setRoute(next)
  }, [])

  useEffect(() => {
    position.current = window.history.state?.[positionKey] ?? 0
    // This mount effect may run before Next.js patches History API. Preserve
    // its existing state here; no URL is changing yet.
    window.history.replaceState(
      { ...window.history.state, [positionKey]: position.current },
      '',
    )
    let target: { route: WorkspaceRoute; index: number } | null = null
    let alive = true
    const onPop = async (event: PopStateEvent) => {
      const next = parseWorkspacePath(window.location.pathname)
      if (!next) return
      target = { route: next, index: event.state?.[positionKey] ?? 0 }
      if (pending.current) return
      pending.current = true
      try {
        const allowed =
          next.projectId === current.current.projectId ||
          (await guard.current())
        if (!alive) return
        // A second Back/Forward action during the dialog updates the target.
        const destination = target
        if (allowed) accept(destination.route, destination.index)
        else {
          const delta = position.current - destination.index
          if (delta) window.history.go(delta)
          else
            window.history.replaceState(
              { [positionKey]: position.current },
              '',
              workspacePath(current.current),
            )
        }
      } finally {
        pending.current = false
      }
    }
    window.addEventListener('popstate', onPop)
    return () => {
      alive = false
      window.removeEventListener('popstate', onPop)
    }
  }, [accept])

  const navigate = useCallback(
    async (next: WorkspaceRoute, replace = false) => {
      if (pending.current) return false
      const path = workspacePath(next)
      if (path === window.location.pathname && !replace) return true
      pending.current = true
      try {
        if (
          next.projectId !== current.current.projectId &&
          !(await guard.current())
        )
          return false
        const index = position.current + (replace ? 0 : 1)
        window.history[replace ? 'replaceState' : 'pushState'](
          // Next.js copies its router state into this object and updates
          // usePathname. Passing its internal __NA flag would bypass that.
          { [positionKey]: index },
          '',
          path,
        )
        accept(next, index)
        return true
      } finally {
        pending.current = false
      }
    },
    [accept],
  )

  return { route, navigate }
}
