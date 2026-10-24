'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  Box,
  Check,
  Code2,
  ExternalLink,
  FileCode2,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import type {
  DockerHealth,
  RuntimeAction,
  RuntimeDetail,
} from '@/lib/runtime/types'

type Detail = RuntimeDetail & {
  health: DockerHealth
  liveState: string | null
  workerOnline: boolean
}
const actionName = {
  create: '创建环境',
  start: '启动环境',
  build: '构建预览',
  stop: '停止环境',
  remove: '移除容器',
  write: '保存源码',
}
const stateName = {
  absent: '尚未创建',
  running: '运行中 · 待构建',
  ready: '预览已就绪',
  stopped: '已停止',
  error: '需要检查',
}
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
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '环境操作失败')
  return data as T
}
export function RuntimePanel({
  projectId,
  mobile,
}: {
  projectId: string
  mobile: boolean
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pane, setPane] = useState<'overview' | 'files' | 'preview'>('overview')
  const [file, setFile] = useState('src/App.jsx')
  const [editor, setEditor] = useState('')
  const [removing, setRemoving] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  const [containerLogs, setContainerLogs] = useState('')
  const base = `/api/projects/${projectId}/runtime`
  const refresh = useCallback(async () => {
    try {
      setDetail(await request<Detail>(base))
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [base])
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const data = await request<Detail>(base)
        if (alive) {
          setDetail(data)
          setLoadError('')
        }
      } catch (e) {
        if (alive) setLoadError((e as Error).message)
      }
    }
    void poll()
    const timer = setInterval(poll, 4000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [base])
  const workspace = detail?.workspace
  const sourceFiles = [...(workspace?.files || [])].sort((a, b) =>
    a.path.localeCompare(b.path),
  )
  const source = workspace?.files.find((f) => f.path === file)?.content || ''
  useEffect(() => setEditor(source), [file, source])
  const job = detail?.jobs[0]
  const active = job?.status === 'queued' || job?.status === 'running'
  const connected = detail?.health.available && detail.workerOnline
  const running = detail?.liveState === 'running'
  const ready = running && workspace?.built && workspace.state === 'ready'
  const disabled = busy || active || !connected
  async function action(action: RuntimeAction | 'cancel', extra = {}) {
    setBusy(true)
    setError('')
    try {
      await request(base, { action, ...extra })
      setDetail(await request<Detail>(base))
      setRemoving(false)
      if (action === 'build') setPane('overview')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function readLogs() {
    try {
      setContainerLogs(
        (await request<{ logs: string }>(base + '?logs=1')).logs ||
          '容器尚无日志',
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="runtime-panel">
      <div className="runtime-heading">
        <div>
          <span className="eyebrow">ISOLATED REACT WORKSPACE</span>
          <h2>
            <Box size={20} />
            Docker 执行环境
          </h2>
        </div>
        <button
          className="icon-button"
          aria-label="刷新环境状态"
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="runtime-description">
        独立构建 React/Vite
        项目，查看源码和构建结果。当前是环境验证模板；聊天生成仍使用单文件模式。
      </p>
      {(error || loadError) && (
        <div role="alert" className="error-banner">
          {error || loadError}
          <button aria-label="关闭环境错误" onClick={() => setError('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {!detail ? (
        <p className="runtime-loading">
          <Loader2 className="spin" size={14} />
          正在检查 Docker…
        </p>
      ) : (
        <>
          <div className="runtime-health">
            <span
              className={`status-dot ${detail.health.available ? 'online' : ''}`}
            />
            <strong>
              {detail.health.available
                ? `Docker ${detail.health.serverVersion || ''}`
                : 'Docker 尚未连接'}
            </strong>
            <span>{workspace ? stateName[workspace.state] : '尚未创建'}</span>
          </div>
          {!detail.health.available || !detail.health.imageReady ? (
            <div className="runtime-setup">
              <strong>{detail.health.reason}</strong>
              <p>安装并启动 Docker Desktop 后，在仓库根目录依次运行：</p>
              <pre>
                pnpm sandbox:doctor{`\n`}pnpm sandbox:prepare{`\n`}pnpm
                sandbox:verify
              </pre>
              <a
                href="https://docs.docker.com/desktop/setup/install/mac-install/"
                target="_blank"
                rel="noreferrer"
              >
                Docker 安装说明 <ExternalLink size={12} />
              </a>
              <p>
                构建镜像时安装固定依赖；项目运行时关闭外网，不传入模型密钥。
              </p>
            </div>
          ) : null}
          {!detail.workerOnline && (
            <p className="runtime-warning">
              Worker 未连接，请使用 pnpm dev 启动 Web 和 Worker。
            </p>
          )}
          <div className="runtime-actions">
            {(!workspace || detail.liveState === 'absent') && (
              <button
                className="runtime-primary"
                disabled={disabled || !detail.health.imageReady}
                onClick={() => void action('create')}
              >
                <PlusIcon />
                创建 React 环境
              </button>
            )}
            {workspace && detail.liveState !== 'absent' && !running && (
              <button disabled={disabled} onClick={() => void action('start')}>
                <Play size={13} />
                启动环境
              </button>
            )}
            <button
              disabled={disabled || !running}
              onClick={() => void action('build')}
            >
              <Play size={13} />
              构建预览
            </button>
            <button
              disabled={disabled || !running}
              onClick={() => void action('stop')}
            >
              <Square size={12} />
              停止
            </button>
            {workspace && detail.liveState !== 'absent' && (
              <button
                disabled={disabled}
                onClick={() => setRemoving(!removing)}
              >
                <Trash2 size={13} />
                移除
              </button>
            )}
            {active && (
              <button disabled={busy} onClick={() => void action('cancel')}>
                <X size={13} />
                取消操作
              </button>
            )}
          </div>
          {removing && (
            <div className="runtime-confirm">
              <span>移除容器并释放资源，已保存的源码仍会保留。</span>
              <button disabled={disabled} onClick={() => void action('remove')}>
                确认移除
              </button>
              <button onClick={() => setRemoving(false)}>取消</button>
            </div>
          )}
          <div className="runtime-tabs">
            <button
              className={pane === 'overview' ? 'active' : ''}
              onClick={() => setPane('overview')}
            >
              <Terminal size={13} />
              操作日志
            </button>
            <button
              className={pane === 'files' ? 'active' : ''}
              onClick={() => setPane('files')}
              disabled={!workspace}
            >
              <Code2 size={14} />
              源码
            </button>
            <button
              className={pane === 'preview' ? 'active' : ''}
              onClick={() => setPane('preview')}
              disabled={!ready}
            >
              <Play size={13} />
              React 预览{ready && <Check size={12} />}
            </button>
          </div>
          {pane === 'overview' && (
            <div className="runtime-operation-log">
              {job ? (
                <>
                  <div className="runtime-job-title">
                    {active ? (
                      <Loader2 className="spin" size={13} />
                    ) : (
                      <Terminal size={13} />
                    )}
                    <strong>{actionName[job.action]}</strong>
                    <span>
                      {job.status === 'completed'
                        ? '已完成'
                        : job.status === 'failed'
                          ? '失败'
                          : job.status === 'cancelled'
                            ? '已取消'
                            : job.status === 'queued'
                              ? '排队中'
                              : '执行中'}
                    </span>
                  </div>
                  {job.events.map((event, i) => (
                    <div className="runtime-log-entry" key={i}>
                      <time>
                        {new Date(event.at).toLocaleTimeString('zh-CN', {
                          hour12: false,
                        })}
                      </time>
                      <pre>{event.message}</pre>
                    </div>
                  ))}
                  {job.error && <p className="task-error">{job.error}</p>}
                  {ready && (
                    <button
                      className="text-button"
                      onClick={() => setPane('preview')}
                    >
                      查看 React 预览 →
                    </button>
                  )}
                </>
              ) : (
                <p className="runtime-muted">
                  创建环境后，生命周期与构建日志会显示在这里。
                </p>
              )}
              <button
                className="text-button"
                disabled={
                  !connected || !workspace || detail.liveState === 'absent'
                }
                onClick={() => void readLogs()}
              >
                读取容器服务日志
              </button>
              {containerLogs && (
                <pre className="runtime-service-logs">{containerLogs}</pre>
              )}
            </div>
          )}
          {pane === 'files' && workspace && (
            <div className="runtime-files">
              <div className="runtime-file-toolbar">
                <FileCode2 size={14} />
                <select
                  aria-label="选择源码文件"
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                >
                  {sourceFiles.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path}
                    </option>
                  ))}
                </select>
                <button
                  disabled={disabled || !running || editor === source}
                  onClick={() =>
                    void action('write', { path: file, content: editor })
                  }
                >
                  保存源码
                </button>
              </div>
              <textarea
                aria-label="React 源码编辑器"
                value={editor}
                onChange={(e) => setEditor(e.target.value)}
                spellCheck={false}
                maxLength={131072}
                disabled={busy || active}
              />
              <p className="runtime-muted">
                修改保存后，请重新构建预览。依赖和构建配置由固定模板管理。
              </p>
            </div>
          )}
          {pane === 'preview' && ready && workspace && (
            <div className="runtime-preview">
              <div className="runtime-preview-caption">
                <span>React/Vite · 构建产物 · 隔离预览</span>
                <button
                  className="icon-button"
                  aria-label="刷新 React 预览"
                  onClick={() => setPreviewKey((k) => k + 1)}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
              <iframe
                className={mobile ? 'phone-frame' : ''}
                key={`${workspace.updatedAt}-${previewKey}`}
                title="Docker React 应用预览"
                src={`/api/runtime-preview/${workspace.token}/`}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          <p className="runtime-footnote">
            1 CPU · 512 MiB 内存 · 64 MiB 工作区 · 无外网 ·
            不挂载宿主目录。停止后需重新构建预览。
          </p>
        </>
      )}
    </div>
  )
}
function PlusIcon() {
  return <span aria-hidden="true">+</span>
}
