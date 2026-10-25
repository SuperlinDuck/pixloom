// This function is intentionally self-contained: the browser verifier runs the same bridge.
export function installPreviewAuthBridge(
  frame: HTMLIFrameElement,
  artifactId: string,
  resourceBase = `/api/previews/${artifactId}/`,
) {
  let active = true
  let channel: BroadcastChannel | undefined
  let serial = Promise.resolve()
  let pendingLogout = false
  const nonce = crypto.randomUUID()
  let config: Promise<{ scope: string; marker: string }> | undefined
  const getConfig = () =>
    (config ||= fetch(`${resourceBase}pixloom-cloud.json`, {
      credentials: 'omit',
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error('Cloud 配置未就绪')
      const value = await response.json()
      if (value.format !== 'pixloom-cloud-v2')
        throw new Error('此预览不支持持久登录')
      const scope = [
        value.endpoint,
        value.environmentId,
        value.generation,
      ].join('|')
      try {
        channel = new BroadcastChannel('pixloom-cloud-auth')
        channel.onmessage = (event) => {
          if (
            active &&
            event.data?.scope === scope &&
            ['signedout', 'changed'].includes(event.data?.type)
          ) {
            // Reload makes existing generated UIs re-run getUser, without requiring a new UI subscription API.
            frame.src = frame.src
          }
        }
      } catch {
        /* Auth remains correct when tab notifications are unavailable. */
      }
      return { scope, marker: 'pixloom:pending-logout:' + scope }
    }))
  const send = async (action: string, payload: unknown = {}) => {
    const response = await fetch(`/api/app-auth/${artifactId}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await response.json()
    if (!response.ok)
      throw new Error(result.message || result.error || '登录服务暂不可用')
    return result
  }
  const listener = (event: MessageEvent) => {
    if (
      !active ||
      event.source !== frame.contentWindow ||
      event.data?.nonce !== nonce ||
      event.data?.type !== 'pixloom-cloud-auth-v1' ||
      event.ports.length !== 1
    )
      return
    const { action, payload } = event.data
    const port = event.ports[0]
    if (!['signin', 'verify', 'resume', 'signout'].includes(action)) {
      port.close()
      return
    }
    if (action === 'signout') pendingLogout = true
    const execute = async () => {
      try {
        const { scope, marker } = await getConfig()
        if (action === 'signout') {
          try {
            localStorage.setItem(marker, '1')
          } catch {
            /* Server confirmation is still required. */
          }
          channel?.postMessage({ scope, type: 'signedout' })
        }
        let marked = pendingLogout
        try {
          marked ||= localStorage.getItem(marker) === '1'
        } catch {}
        if (marked) {
          // Fail closed after an offline logout, including on the next browser launch.
          await send('signout')
          pendingLogout = false
          try {
            localStorage.removeItem(marker)
          } catch {}
          if (action === 'signout') {
            if (active) port.postMessage({ ok: true, result: { ok: true } })
            return
          }
        }
        const result = await send(action, payload)
        if (action === 'signin' || action === 'verify')
          channel?.postMessage({ scope, type: 'changed' })
        if (active) port.postMessage({ ok: true, result })
      } catch (error) {
        if (active)
          port.postMessage({
            ok: false,
            message:
              error instanceof Error ? error.message : '登录服务暂不可用',
          })
      } finally {
        port.close()
      }
    }
    serial = serial.then(execute, execute)
  }
  window.addEventListener('message', listener)
  const source = new URL(`${resourceBase}index.html`, location.href)
  source.searchParams.set('__pixloom_auth', nonce)
  frame.src = source.href
  return () => {
    active = false
    window.removeEventListener('message', listener)
    channel?.close()
  }
}
