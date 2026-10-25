import { CloudApiError } from './errors'
import { workspaceOrigin } from '../workspace-origin'
import { db, StoreError, transaction } from '../store'
import { managedConfig } from './config'
import { unseal } from './crypto'
import { externalToken } from './oauth'
import {
  binding,
  environments,
  reserveBinding,
  resource,
  resources,
  setBindingState,
  type SetupInput,
} from './store'
import { listSupabaseProjects, publicKey, supabaseRequest } from './api'
import type { CloudResource, SupabaseProject } from './types'
import { sharedApp } from './shared-store'
import { ensureSharedEnvironment } from './shared-db'

export async function managementToken(projectId: string, signal?: AbortSignal) {
  const row = binding(projectId)
  if (!row) throw new StoreError('请先启用云后端', 409)
  return row.mode === 'managed'
    ? managedConfig().token
    : externalToken(row.connectionId!, signal)
}
export type CloudExecution = {
  signal: AbortSignal
  check: () => void
  waitMs?: number
}
export async function prepareCloud(
  projectId: string,
  input: SetupInput,
  execution: CloudExecution,
) {
  execution.check()
  if (
    input.mode === 'managed' &&
    (sharedApp(projectId) ||
      (!binding(projectId) &&
        process.env.PIXLOOM_CLOUD_LEGACY_PROVISIONING !== '1'))
  ) {
    await ensureSharedEnvironment(projectId, 'development', execution)
    return
  }
  const bound = reserveBinding(projectId, input)
  setBindingState(projectId, 'provisioning')
  try {
    const token = await managementToken(projectId, execution.signal)
    const projects = await listSupabaseProjects(token, execution.signal)
    execution.check()
    for (const environment of environments) {
      let row = resource(projectId, environment)
      let remote: SupabaseProject | undefined = row.ref
        ? projects.find((project) => project.id === row.ref)
        : undefined
      if (bound.mode === 'managed' && !row.ref) {
        const config = managedConfig()
        const matches = projects.filter(
          (project) =>
            project.name === row.name &&
            project.organization_id === config.organization,
        )
        if (matches.length > 1)
          throw new StoreError(
            '检测到重复 Cloud 资源，请联系管理员核对后再继续',
            409,
          )
        remote = matches[0]
        if (!remote) {
          // A lost POST response cannot be retried blindly. A subsequent run first lists by the persisted unique name.
          if (row.status !== 'reserved')
            throw new StoreError(
              '上次创建结果尚未确认，请在 Supabase 核对资源后重试；不会重复创建',
              409,
            )
          execution.check()
          const claimed = db()
            .prepare(
              "UPDATE cloud_resources SET status='creating' WHERE projectId=? AND environment=? AND status='reserved' AND ref IS NULL",
            )
            .run(projectId, environment)
          if (!claimed.changes)
            throw new StoreError('资源创建已被其他执行接管，请刷新后重试', 409)
          try {
            remote = await supabaseRequest<SupabaseProject>(
              token,
              '/v1/projects',
              {
                method: 'POST',
                body: {
                  name: row.name,
                  organization_slug: config.organization,
                  region_selection: { type: 'smartGroup', code: config.region },
                  db_pass: unseal(
                    row.password!,
                    `database:${projectId}:${environment}`,
                  ),
                },
                signal: execution.signal,
              },
            )
          } catch (error) {
            db()
              .prepare(
                'UPDATE cloud_resources SET status=? WHERE projectId=? AND environment=? AND ref IS NULL',
              )
              .run(
                error instanceof CloudApiError && error.outcome === 'rejected'
                  ? 'reserved'
                  : 'uncertain',
                projectId,
                environment,
              )
            throw error
          }
        }
        // Persist the external side effect even after cancellation, but never submit source/version results.
        if (remote && 'ref' in remote) remote.id = String(remote.ref)
        if (!remote?.id || !/^[a-z]{20}$/.test(remote.id))
          throw new StoreError('Supabase 创建结果无效，请核对资源', 502)
        db()
          .prepare(
            "UPDATE cloud_resources SET ref=?,status='pending',password=NULL WHERE projectId=? AND environment=? AND ref IS NULL",
          )
          .run(remote.id, projectId, environment)
        row = resource(projectId, environment)
      }
      execution.check()
      if (!remote || remote.id !== row.ref)
        throw new StoreError('所选 Supabase 项目不存在或当前授权无权访问', 409)
    }
    const deadline = Date.now() + (execution.waitMs || 0)
    for (const environment of environments) {
      const row = resource(projectId, environment)
      let health: { name: string; status: string }[]
      do {
        execution.check()
        health = await supabaseRequest<{ name: string; status: string }[]>(
          token,
          `/v1/projects/${row.ref}/health?services=auth,db,rest,storage`,
          { signal: execution.signal },
        )
        execution.check()
        if (
          Array.isArray(health) &&
          health.length &&
          health.every((service) => service.status === 'ACTIVE_HEALTHY')
        )
          break
        if (Date.now() >= deadline) break
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer)
            reject(new StoreError('云资源准备已中断', 409))
          }
          const timer = setTimeout(() => {
            execution.signal.removeEventListener('abort', abort)
            resolve()
          }, 2000)
          execution.signal.addEventListener('abort', abort, { once: true })
          if (execution.signal.aborted) abort()
        })
      } while (Date.now() < deadline)
      execution.check()
      if (
        !Array.isArray(health) ||
        !health.length ||
        health.some((service) => service.status !== 'ACTIVE_HEALTHY')
      )
        throw new StoreError(
          '云资源正在启动，请稍后点击继续准备；不会重复创建',
          409,
        )
      const key = await publicKey(token, row.ref!, execution.signal)
      execution.check()
      // Configure only platform-owned projects. Existing user project auth settings stay under user control.
      if (bound.mode === 'managed')
        await supabaseRequest(token, `/v1/projects/${row.ref}/config/auth`, {
          method: 'PATCH',
          body: {
            site_url: workspaceOrigin(),
            uri_allow_list: workspaceOrigin() + '/api/previews/**',
            external_email_enabled: true,
            mailer_autoconfirm: false,
            disable_signup: false,
          },
          signal: execution.signal,
        })
      execution.check()
      db()
        .prepare(
          "UPDATE cloud_resources SET publishableKey=?,status='ready',password=NULL WHERE projectId=? AND environment=?",
        )
        .run(key, projectId, environment)
    }
    execution.check()
    setBindingState(projectId, 'ready')
    return resources(projectId).map(publicResource)
  } catch (error) {
    try {
      transaction(() => {
        execution.check()
        setBindingState(
          projectId,
          'error',
          error instanceof StoreError
            ? error.message
            : '云后端准备失败，请检查配置并重试',
        )
      })
    } catch {
      /* A replacement attempt owns the state; keep its checkpoint intact. */
    }
    throw error
  }
}
function publicResource(row: CloudResource) {
  return { environment: row.environment, ref: row.ref, status: row.status }
}

export async function configureProductionAuth(
  projectId: string,
  appUrl: string,
  execution: CloudExecution,
) {
  if (binding(projectId)?.mode !== 'managed') return
  const url = new URL(appUrl)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new StoreError('应用发布地址无效')
  const row = resource(projectId, 'production')
  if (!row.ref || row.status !== 'ready')
    throw new StoreError('生产资源未就绪', 409)
  const token = await managementToken(projectId, execution.signal)
  execution.check()
  await supabaseRequest(token, `/v1/projects/${row.ref}/config/auth`, {
    method: 'PATCH',
    body: { site_url: url.origin, uri_allow_list: url.origin + '/**' },
    signal: execution.signal,
  })
  execution.check()
}
