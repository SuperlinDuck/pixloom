'use client'

import { useCallback, useEffect, useState } from 'react'
import { Cloud, Database, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import type { CloudStatus, SupabaseProject } from '@/lib/cloud/types'

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { cache: 'no-store' },
  )
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || '云后端请求失败')
  return value
}
export function WorkspaceCloud({
  projectId,
  locked,
  workerOnline,
  onQueued,
}: {
  projectId: string
  locked: boolean
  workerOnline: boolean
  onQueued: () => Promise<void>
}) {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [mode, setMode] = useState<'managed' | 'external'>('managed')
  const [projects, setProjects] = useState<SupabaseProject[]>([])
  const [development, setDevelopment] = useState(''),
    [production, setProduction] = useState('')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const value = await request<CloudStatus>(`/api/projects/${projectId}/cloud`)
    setStatus(value)
    setMode(value.mode)
    for (const row of value.resources) {
      if (row.environment === 'development' && row.ref) setDevelopment(row.ref)
      if (row.environment === 'production' && row.ref) setProduction(row.ref)
    }
  }, [projectId])
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        if (alive) await refresh()
      } catch (error) {
        if (alive) setError((error as Error).message)
      }
    }
    void load()
    const timer = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])
  async function perform(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const hasBinding = !!status && status.status !== 'disabled'
  async function selectMode(value: 'managed' | 'external') {
    await perform(async () => {
      const response = await fetch(`/api/projects/${projectId}/cloud`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: value }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setMode(value)
      await refresh()
    })
  }
  return (
    <div className="cloud-panel">
      <div className="cloud-heading">
        <Cloud size={24} />
        <div>
          <h2>云后端</h2>
          <p>为应用提供登录、数据库和私有文件存储。</p>
        </div>
      </div>
      <div className="cloud-modes" role="group" aria-label="后端提供方式">
        <button
          type="button"
          className={mode === 'managed' ? 'selected' : ''}
          disabled={locked || busy || hasBinding}
          onClick={() => void selectMode('managed')}
        >
          <strong>
            Pixloom Cloud <span>默认</span>
          </strong>
          <small>复用平台共享资源池，按应用隔离数据。</small>
        </button>
        <button
          type="button"
          className={mode === 'external' ? 'selected' : ''}
          disabled={locked || busy || hasBinding}
          onClick={() => void selectMode('external')}
        >
          <strong>自有 Supabase</strong>
          <small>连接自己的项目，自行管理资源与费用。</small>
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {status?.error && (
        <p className="error-banner" role="alert">
          {status.error}
        </p>
      )}
      {!status ? (
        <p>正在读取后端状态…</p>
      ) : (
        <>
          <div className="cloud-state">
            <Database size={17} />
            <strong>
              {
                {
                  disabled: '尚未启用',
                  provisioning: '正在准备资源',
                  ready: '后端已就绪',
                  error: '需要继续准备',
                }[status.status]
              }
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label="刷新云后端状态"
              onClick={() => void perform(refresh)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {mode === 'managed' && (
            <>
              <p>
                {status.provider === 'legacy'
                  ? '此应用沿用原有独立开发与生产资源。'
                  : '多个应用共用开发池和生产池。启用时准备开发环境，首次发布时准备生产环境；纯静态应用不占后端资源。'}
              </p>
              {status.provider === 'shared' && (
                <>
                  <p className="workspace-hint">
                    同一池共享账号体系，应用数据分别授权。共享池暂不支持自定义服务端函数。
                  </p>
                  {!status.productionConfigured && (
                    <p className="workspace-hint">
                      生产池尚未配置，不影响开发；发布前需管理员完成配置。
                    </p>
                  )}
                  {status.limits && (
                    <p className="workspace-hint">
                      每池最多 {status.limits.maxApps}{' '}
                      个应用环境；每应用环境最多{' '}
                      {status.limits.maxRows.toLocaleString()} 条记录、
                      {Math.round(status.limits.maxBytes / 1048576)} MB 数据和{' '}
                      {Math.round(status.limits.maxFileBytes / 1048576)} MB
                      文件。实际池容量仍会限制写入。
                    </p>
                  )}
                </>
              )}
              {!status.managedConfigured && (
                <p className="workspace-hint">
                  平台尚未配置 Pixloom Cloud，请联系管理员配置后启用，或选择自有
                  Supabase。
                </p>
              )}
            </>
          )}
          {mode === 'external' && (
            <div className="cloud-external">
              <p>
                先授权
                Supabase，再选择两个不同的项目作为开发与生产环境。已有表和数据保留。
              </p>
              {!status.oauthConfigured && (
                <p className="workspace-hint">
                  管理员尚未配置 Supabase OAuth 应用。
                </p>
              )}
              {status.oauthConfigured && (
                <a
                  className="cloud-connect"
                  href={`/api/cloud/supabase/connect?projectId=${projectId}`}
                >
                  <ExternalLink size={15} />
                  {status.connected ? '重新授权 Supabase' : '连接 Supabase'}
                </a>
              )}
              {status.connected && (
                <>
                  <button
                    type="button"
                    disabled={busy || locked}
                    onClick={() =>
                      void perform(async () =>
                        setProjects(
                          await request<SupabaseProject[]>(
                            '/api/cloud/supabase/projects',
                          ),
                        ),
                      )
                    }
                  >
                    读取可用项目
                  </button>
                  {!hasBinding && (
                    <div className="cloud-project-selectors">
                      {(['development', 'production'] as const).map(
                        (environment) => (
                          <label key={environment}>
                            {environment === 'development'
                              ? '开发项目'
                              : '生产项目'}
                            <select
                              aria-label={
                                environment === 'development'
                                  ? 'Supabase 开发项目'
                                  : 'Supabase 生产项目'
                              }
                              value={
                                environment === 'development'
                                  ? development
                                  : production
                              }
                              disabled={busy || locked}
                              onChange={(event) =>
                                environment === 'development'
                                  ? setDevelopment(event.target.value)
                                  : setProduction(event.target.value)
                              }
                            >
                              <option value="">请选择项目</option>
                              {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name} · {project.id}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {status.cleanupPending > 0 && (
            <p className="workspace-hint">
              有 {status.cleanupPending} 个开发测试账号待清理，Worker
              重启时会重试。
            </p>
          )}
          {status.resources.length > 0 && (
            <div className="cloud-resources">
              {status.resources.map((row) => (
                <div key={row.environment}>
                  <strong>
                    {row.environment === 'development'
                      ? '开发环境'
                      : '生产环境'}
                  </strong>
                  {mode === 'external' && <span>{row.ref || '等待分配'}</span>}
                  <small>{row.status === 'ready' ? '已就绪' : '准备中'}</small>
                  {mode === 'external' && row.ref && (
                    <a
                      href={`https://supabase.com/dashboard/project/${row.ref}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`查看${row.environment === 'development' ? '开发' : '生产'}资源`}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {status.status !== 'ready' && (
            <button
              type="button"
              className="primary-button"
              disabled={
                busy ||
                locked ||
                !workerOnline ||
                (mode === 'managed'
                  ? !status.managedConfigured
                  : !status.connected ||
                    !development ||
                    !production ||
                    development === production)
              }
              onClick={() =>
                void perform(async () => {
                  await request(
                    `/api/projects/${projectId}/cloud`,
                    mode === 'managed'
                      ? { mode }
                      : { mode, development, production },
                  )
                  await onQueued()
                  await refresh()
                })
              }
            >
              {busy || status.status === 'provisioning' ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Cloud size={15} />
              )}{' '}
              {hasBinding
                ? '继续准备后端'
                : mode === 'managed'
                  ? '启用 Pixloom Cloud'
                  : '绑定并准备 Supabase'}
            </button>
          )}
          <p className="workspace-hint">
            开发与生产数据分开保存。发布会更新生产结构；代码回滚不恢复业务数据。
            {mode === 'managed'
              ? '资源用量计入平台额度。'
              : '资源用量由你的 Supabase 账号承担。'}
          </p>
        </>
      )}
    </div>
  )
}
