import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { installPreviewStorageBridge } from '../src/lib/preview-storage'
import { storageClientSource } from '../src/lib/storage-client'

function host() {
  const data = new Map<string, string>()
  const listeners = new Set<(event: MessageEvent) => void>()
  const window = {
    addEventListener: (_: string, fn: (event: MessageEvent) => void) =>
      listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MessageEvent) => void) =>
      listeners.delete(fn),
  }
  const localStorage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
  }
  const install = runInNewContext(
    `(${installPreviewStorageBridge.toString()})`,
    {
      window,
      localStorage,
      __name: (value: unknown) => value,
    },
  ) as typeof installPreviewStorageBridge
  const frame = { contentWindow: {} } as HTMLIFrameElement
  function request(
    key: string,
    action = 'get',
    value?: string,
    overrides = {},
  ) {
    const port = { postMessage: vi.fn(), close: vi.fn() }
    const event = {
      source: frame.contentWindow,
      origin: 'null',
      data: { type: 'pixloom-storage-v1', nonce: 'nonce', action, key, value },
      ports: [port],
      ...overrides,
    }
    listeners.forEach((listener) => listener(event as unknown as MessageEvent))
    return port
  }
  return { data, localStorage, install, frame, request }
}

describe('trusted preview local persistence', () => {
  it('fails closed when the trusted host has no storage scope', () => {
    const h = host()
    expect(() => h.install(h.frame, '', 'nonce')).toThrow('作用域无效')
    expect(h.localStorage.getItem).not.toHaveBeenCalled()
  })
  it('retains completed items and deletions across frames/versions, and isolates users and projects', () => {
    const h = host()
    let dispose = h.install(h.frame, 'alice:project-a', 'nonce')
    expect(
      h.request('todos', 'set', '[{"title":"补测保留任务A","completed":true}]')
        .postMessage,
    ).toHaveBeenCalledWith({ ok: true, result: null })
    dispose()
    Object.defineProperty(h.frame, 'contentWindow', {
      value: {},
      configurable: true,
    })
    dispose = h.install(h.frame, 'alice:project-a', 'nonce')
    expect(h.request('todos').postMessage).toHaveBeenCalledWith({
      ok: true,
      result: '[{"title":"补测保留任务A","completed":true}]',
    })
    dispose()
    for (const scope of ['bob:project-a', 'alice:project-b']) {
      const stop = h.install(h.frame, scope, 'nonce')
      expect(h.request('todos').postMessage).toHaveBeenCalledWith({
        ok: true,
        result: null,
      })
      stop()
    }
    dispose = h.install(h.frame, 'alice:project-a', 'nonce')
    h.request('todos', 'remove')
    dispose()
    h.install(h.frame, 'alice:project-a', 'nonce')
    expect(h.request('todos').postMessage).toHaveBeenCalledWith({
      ok: true,
      result: null,
    })
  })

  it('rejects sibling frames, stale nonces and post-disposal messages without touching host storage', () => {
    const h = host()
    const dispose = h.install(h.frame, 'alice:project', 'nonce')
    expect(
      h.request('secret', 'get', undefined, { source: {} }).postMessage,
    ).not.toHaveBeenCalled()
    expect(
      h.request('secret', 'get', undefined, {
        data: {
          type: 'pixloom-storage-v1',
          nonce: 'stale',
          action: 'get',
          key: 'secret',
        },
      }).postMessage,
    ).not.toHaveBeenCalled()
    expect(
      h.request('secret', 'get', undefined, { origin: 'https://other.example' })
        .postMessage,
    ).not.toHaveBeenCalled()
    dispose()
    expect(h.request('secret').postMessage).not.toHaveBeenCalled()
    expect(h.localStorage.getItem).not.toHaveBeenCalled()
  })

  it('never reads arbitrary host keys, limits writes, and reports denied/quota/corrupt storage without overwriting', () => {
    const h = host()
    h.data.set('platform-secret', 'private')
    h.install(h.frame, 'scope', 'nonce')
    expect(h.request('platform-secret').postMessage).toHaveBeenCalledWith({
      ok: true,
      result: null,
    })
    expect(
      h.request('large', 'set', 'x'.repeat(262145)).postMessage,
    ).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    h.localStorage.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })
    expect(h.request('todos', 'set', '[]').postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('数据未保存'),
      }),
    )
    h.data.set('pixloom:preview-storage:v1:scope', 'broken JSON')
    h.localStorage.setItem.mockClear()
    expect(h.request('todos').postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    )
    expect(h.localStorage.setItem).not.toHaveBeenCalled()
    h.localStorage.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })
    expect(h.request('todos').postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    )
  })
})

describe('published storage client', () => {
  function client() {
    const values = new Map<string, string>()
    const localStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      }),
      removeItem: vi.fn((key: string) => values.delete(key)),
    }
    const window = {} as { parent: unknown }
    window.parent = window
    const storage = runInNewContext(
      storageClientSource
        .replaceAll('import.meta.env.BASE_URL', '"/"')
        .replace('export const storage=', 'const storage=') + '\nstorage',
      { window, localStorage, URL, location: { href: 'https://app.example/' } },
    ) as {
      get: (key: string, fallback?: unknown) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<void>
      remove: (key: string) => Promise<void>
    }
    return { storage, values, localStorage }
  }
  it('uses native storage and distinguishes missing values from read/corruption failures', async () => {
    const { storage, values, localStorage } = client()
    expect(await storage.get('todos', [])).toEqual([])
    await storage.set('todos', [{ completed: true }])
    expect(await storage.get('todos')).toEqual([{ completed: true }])
    values.set('todos', 'bad JSON')
    await expect(storage.get('todos', [])).rejects.toThrow()
    localStorage.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })
    await expect(storage.get('todos', [])).rejects.toThrow('本地保存失败')
    await storage.remove('todos')
    expect(await storage.get('todos')).toBeNull()
  })
  it('rejects failed writes and invalid values instead of reporting success', async () => {
    const { storage, localStorage } = client()
    localStorage.setItem.mockImplementationOnce(() => {
      throw new Error('quota')
    })
    await expect(storage.set('todos', [])).rejects.toThrow('本地保存失败')
    await expect(storage.set('todos', undefined)).rejects.toThrow('可序列化')
    await expect(storage.set('', [])).rejects.toThrow('存储键')
  })
})
