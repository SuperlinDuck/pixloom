const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])

export function workspaceOrigin() {
  const url = new URL(process.env.PIXLOOM_AUTH_URL || 'http://127.0.0.1:3000')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (!loopback.has(url.hostname) && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('工作台地址配置无效')
  return url.origin
}

// Trust only the explicitly configured origin, including when a local proxy
// terminates HTTPS and forwards requests to Next over HTTP.
export function workspaceRequestOrigin(request: Request): string | null {
  const url = new URL(request.url)
  const host = request.headers.get('host') || url.host
  let incoming: URL
  try {
    incoming = new URL(`${url.protocol}//${host}`)
    if (incoming.host !== host) return null
  } catch {
    return null
  }
  const local = loopback.has(incoming.hostname)
  try {
    const configured = workspaceOrigin()
    const expected = new URL(configured).host
    if (
      host === expected ||
      (local && request.headers.get('x-forwarded-host') === expected)
    )
      return configured
  } catch {
    // Keep local diagnostics reachable when the configured URL is invalid.
  }
  if (!local) return null
  return incoming.origin
}

export function workspaceMutationAllowed(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const expected = workspaceRequestOrigin(request)
  if (!expected) return false
  try {
    const source = new URL(origin)
    if (source.origin === expected) return true

    // Whistle can rewrite Origin to the HTTP upstream while retaining the
    // browser's Fetch Metadata. Accept that rewrite only for a same-origin
    // browser request through loopback to the explicitly forwarded workspace.
    const host = request.headers.get('host') || new URL(request.url).host
    return (
      request.headers.get('sec-fetch-site') === 'same-origin' &&
      ['http:', 'https:'].includes(source.protocol) &&
      loopback.has(source.hostname) &&
      source.host === host &&
      request.headers.get('x-forwarded-host') === new URL(expected).host
    )
  } catch {
    return false
  }
}
