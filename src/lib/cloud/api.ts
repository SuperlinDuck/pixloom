import { CloudApiError } from './errors'
import { StoreError } from '../store'
import { SUPABASE_API, projectRef } from './config'
import type { SupabaseProject } from './types'

export async function supabaseRequest<T>(
  token: string,
  pathname: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  if (!pathname.startsWith('/v1/') || pathname.includes('..'))
    throw new StoreError('Cloud API 路径无效')
  const isForm = options.body instanceof FormData
  let response: Response
  try {
    response = await fetch(SUPABASE_API + pathname, {
      method: options.method || 'GET',
      redirect: 'error',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body && !isForm
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body: options.body
        ? isForm
          ? (options.body as FormData)
          : JSON.stringify(options.body)
        : undefined,
    })
  } catch {
    options.signal?.throwIfAborted()
    throw new CloudApiError(
      '无法连接 Supabase；写操作结果可能未确认，请刷新资源状态后重试',
      502,
      'unknown',
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    const messages: Record<number, string> = {
      401: 'Supabase 授权已失效，请重新连接',
      403: 'Supabase 权限不足',
      404: 'Supabase 资源不存在',
      409: 'Supabase 资源冲突',
      429: 'Supabase 请求限流或资源额度不足',
    }
    throw new CloudApiError(
      messages[response.status] ||
        `Supabase 操作失败（HTTP ${response.status}）`,
      response.status === 401 ? 409 : response.status >= 500 ? 502 : 400,
      response.status >= 500 ? 'unknown' : 'rejected',
    )
  }
  if (response.status === 204) return undefined as T
  const reader = response.body?.getReader()
  if (!reader) return undefined as T
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1024 * 1024)
        throw new StoreError('Supabase 响应超过 1 MiB', 502)
      chunks.push(chunk.value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? (JSON.parse(text) as T) : (undefined as T)
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError('Supabase 响应格式无效', 502)
  } finally {
    await reader.cancel().catch(() => {})
  }
}
export async function listSupabaseProjects(
  token: string,
  signal?: AbortSignal,
) {
  const rows = await supabaseRequest<
    (SupabaseProject & { ref?: string; organization_slug?: string })[]
  >(token, '/v1/projects', { signal })
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new StoreError('Supabase 项目列表无效', 502)
  return rows.map((row) => ({
    id: projectRef(row.ref || row.id),
    name: String(row.name).slice(0, 120),
    organization_id: String(row.organization_slug || row.organization_id),
    region: row.region,
    status: row.status,
  }))
}
export async function publicKey(
  token: string,
  ref: string,
  signal: AbortSignal,
) {
  const rows = await supabaseRequest<
    { name: string; type?: string; api_key: string }[]
  >(token, `/v1/projects/${projectRef(ref)}/api-keys?reveal=true`, { signal })
  const key =
    rows.find(
      (row) => row.type === 'publishable' || row.name === 'publishable',
    ) || rows.find((row) => row.name === 'anon')
  if (
    !key ||
    !/^(sb_publishable_[a-zA-Z0-9_-]+|eyJ[a-zA-Z0-9_.-]+)$/.test(key.api_key)
  )
    throw new StoreError(
      '项目未提供公开 API key，请在 Supabase 中启用 publishable key',
      409,
    )
  return key.api_key
}
