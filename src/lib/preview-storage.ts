// Self-contained so the real browser verifier can run this exact trusted bridge.
// The host chooses scope; the untrusted frame can never select another namespace.
export function installPreviewStorageBridge(
  frame: HTMLIFrameElement,
  scope: string,
  nonce: string,
) {
  if (typeof scope !== 'string' || !scope || scope.length > 500 || !nonce)
    throw new Error('预览存储作用域无效，请重新打开预览')
  let active = true
  const namespace = 'pixloom:preview-storage:v1:' + scope
  const listener = (event: MessageEvent) => {
    if (
      !active ||
      event.source !== frame.contentWindow ||
      event.origin !== 'null' ||
      event.data?.type !== 'pixloom-storage-v1' ||
      event.data?.nonce !== nonce ||
      event.ports.length !== 1
    )
      return
    const port = event.ports[0]
    try {
      const { action, key, value } = event.data
      if (
        !['get', 'set', 'remove'].includes(action) ||
        typeof key !== 'string' ||
        !key.length ||
        key.length > 200 ||
        (action === 'set' &&
          (typeof value !== 'string' || value.length > 262144))
      )
        throw new Error('存储请求无效')
      const raw = localStorage.getItem(namespace)
      const entries: unknown = raw === null ? [] : JSON.parse(raw)
      if (
        !Array.isArray(entries) ||
        entries.some(
          (entry) =>
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== 'string' ||
            typeof entry[1] !== 'string',
        )
      )
        throw new Error('已有本地数据损坏，请先备份或清理此项目的数据')
      const items = new Map<string, string>(entries)
      let result: string | null = null
      if (action === 'get') result = items.get(key) ?? null
      else {
        if (action === 'set') items.set(key, value)
        else items.delete(key)
        const serialized = JSON.stringify(Array.from(items))
        if (items.size > 100 || serialized.length > 1048576)
          throw new Error('此项目的本地存储已满，请清理数据后重试')
        localStorage.setItem(namespace, serialized)
      }
      port.postMessage({ ok: true, result })
    } catch (error) {
      port.postMessage({
        ok: false,
        message:
          error instanceof Error &&
          /^(存储请求无效|已有本地数据损坏|此项目的本地存储已满)/.test(
            error.message,
          )
            ? error.message
            : '本地存储不可用或空间不足；数据未保存，请保留输入并重试',
      })
    } finally {
      port.close()
    }
  }
  window.addEventListener('message', listener)
  return () => {
    active = false
    window.removeEventListener('message', listener)
  }
}
