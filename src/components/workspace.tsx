'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  FileCode2,
  Folder,
  History,
  Loader2,
  Menu,
  Monitor,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import type {
  Project,
  ProjectDetail,
  Provider,
  SystemStatus,
  Task,
  Version,
} from '@/lib/types'
import { isActive } from '@/lib/types'
import { previewDocument } from '@/lib/preview'

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data as T
}
const starters = [
  {
    icon: '◷',
    tag: '专注工作',
    name: '给专注留一点空间',
    text: '创建一个番茄钟应用，支持开始、暂停、重置和切换专注/休息模式。使用温暖的米白色和橙色，界面简洁，适配手机。',
    color: 'peach',
  },
  {
    icon: '▦',
    tag: '管理灵感',
    name: '一个轻盈的任务看板',
    text: '创建一个任务看板，包含待开始、进行中、已完成三列，支持添加、编辑、删除和移动任务。使用简洁的卡片设计和柔和绿色。',
    color: 'sage',
  },
  {
    icon: '↗',
    tag: '展示自己',
    name: '让你的作品被看见',
    text: '创建一个独立设计师的个人作品集，包含介绍、作品网格、分类筛选和联系信息，采用大字号、黑白配色和明亮黄色点缀。',
    color: 'butter',
  },
]
const stateLabels = {
  queued: '等待执行',
  running: '正在构建',
  completed: '已完成',
  failed: '生成失败',
  cancelled: '已取消',
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        pixloom<span className="brand-period">.</span>
      </span>
    </span>
  )
}
function relativeTime(time: string) {
  return new Date(time).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Workspace() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [provider, setProvider] = useState<Provider>('gemini')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [mobile, setMobile] = useState(false)
  const [history, setHistory] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [settings, setSettings] = useState(false)
  const [menu, setMenu] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pollingFailed, setPollingFailed] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const activeRef = useRef(activeId)
  activeRef.current = activeId

  useEffect(() => {
    const remembered = localStorage.getItem('pixloom-project')
    if (remembered) setActiveId(remembered)
    let alive = true
    const refresh = async () => {
      try {
        const [list, system] = await Promise.all([
          api<Project[]>('/api/projects'),
          api<SystemStatus>('/api/status'),
        ])
        if (alive) {
          setProjects(list)
          setStatus(system)
          setPollingFailed(false)
        }
      } catch (e) {
        if (alive) {
          setPollingFailed(true)
        }
      }
    }
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    setDetail(null)
    setDetailError('')
    setSelectedVersion(null)
    setHistory(false)
    setError('')
    setPrompt('')
    setMenu(false)
    if (!activeId) {
      localStorage.removeItem('pixloom-project')
      setLoading(false)
      return
    }
    localStorage.setItem('pixloom-project', activeId)
    setLoading(true)
    let alive = true
    const refresh = async () => {
      try {
        const data = await api<ProjectDetail>(`/api/projects/${activeId}`)
        if (alive) {
          setDetail(data)
          setDetailError('')
          setLoading(false)
        }
      } catch (e) {
        if (alive) {
          setDetailError((e as Error).message)
          setLoading(false)
        }
      }
    }
    void refresh()
    const timer = setInterval(refresh, 1500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [activeId])

  useEffect(() => {
    conversation.current?.scrollTo({
      top: conversation.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [detail?.tasks.length, detail?.tasks.at(-1)?.events.length])
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettings(false)
        setMenu(false)
        setHistory(false)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (!busy) {
          setActiveId(null)
          textarea.current?.focus()
        }
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [busy])

  const displayError =
    error ||
    detailError ||
    (pollingFailed ? '与本地服务的连接已中断，正在重试…' : '')
  const activeTask = detail?.tasks.find(isActive)
  const model = status?.models.find((m) => m.provider === provider)
  const currentVersion = detail?.versions.find(
    (v) => v.id === detail.project.currentVersionId,
  )
  const version =
    detail?.versions.find((v) => v.id === selectedVersion) || currentVersion
  const viewingHistory = Boolean(
    version && currentVersion && version.id !== currentVersion.id,
  )

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!prompt.trim() || busy || activeTask) return
    if (!model?.configured) {
      setError('先配置模型 API Key，即可开始构建。')
      setSettings(true)
      return
    }
    if (!status?.workerOnline) {
      setError('Worker 未连接，请运行 pnpm dev 启动 Web 和 Worker。')
      return
    }
    setBusy(true)
    setError('')
    const text = prompt.trim()
    let id = activeId
    try {
      if (!id) {
        const project = await api<Project>('/api/projects', {
          name: text.replace(/\s+/g, ' ').slice(0, 28),
        })
        id = project.id
        setActiveId(id)
        setProjects((list) => [project, ...list])
      }
      await api(`/api/projects/${id}/tasks`, { prompt: text, provider })
      if (activeRef.current === id || !activeRef.current) {
        setDetail(await api<ProjectDetail>(`/api/projects/${id}`))
        setPrompt('')
        setSelectedVersion(null)
        setTab('preview')
      }
    } catch (e) {
      setError((e as Error).message)
      setPrompt(text)
    } finally {
      setBusy(false)
    }
  }
  async function cancel(task: Task) {
    try {
      await api(`/api/tasks/${task.id}`, {})
      if (activeId === task.projectId)
        setDetail(await api<ProjectDetail>(`/api/projects/${task.projectId}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function restore(v: Version) {
    if (!activeId) return
    setBusy(true)
    try {
      await api(`/api/projects/${activeId}/versions/${v.id}`, {})
      setDetail(await api<ProjectDetail>(`/api/projects/${activeId}`))
      setSelectedVersion(null)
      setHistory(false)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function openExample() {
    setBusy(true)
    setError('')
    try {
      const project = await api<Project>('/api/projects', {
        name: '一刻 · 专注计时示例',
        example: true,
      })
      setProjects((list) => [project, ...list])
      setActiveId(project.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function download() {
    if (!version) return
    const url = URL.createObjectURL(
      new Blob([version.html], { type: 'text/html;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `pixloom-v${version.number}.html`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const composer = (landing: boolean) => (
    <form
      className={`composer ${landing ? 'landing-composer' : ''}`}
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={landing ? 'idea' : 'followup'}>
        {landing ? '描述你的应用' : '继续描述修改需求'}
      </label>
      <textarea
        id={landing ? 'idea' : 'followup'}
        ref={textarea}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        maxLength={12000}
        disabled={busy}
        placeholder={
          landing
            ? '描述你的想法，剩下的交给 Pixloom…'
            : '继续描述你想修改的地方…'
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="composer-bottom">
        <div className="model-select">
          <Sparkles size={14} />
          <select
            aria-label="选择生成模型"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            disabled={busy || Boolean(activeTask)}
          >
            <option value="gemini">
              Gemini{status?.models[0]?.configured ? '' : ' · 未配置'}
            </option>
            <option value="openai">
              GPT{status?.models[1]?.configured ? '' : ' · 未配置'}
            </option>
          </select>
          <ChevronDown size={12} />
        </div>
        <div className="send-group">
          <span className="key-hint">⌘ ↵</span>
          <button
            className="send-button"
            type="submit"
            aria-label="发送需求"
            disabled={!prompt.trim() || busy || Boolean(activeTask) || loading}
          >
            {busy ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <ArrowUp size={18} />
            )}
          </button>
        </div>
      </div>
    </form>
  )

  return (
    <div className={`app-shell ${activeId ? 'has-project' : ''}`}>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <button
          className="brand-button"
          aria-label="Pixloom 首页"
          onClick={() => {
            if (!busy) setActiveId(null)
          }}
        >
          <Brand />
        </button>
        <button
          className="new-project"
          onClick={() => {
            setActiveId(null)
            setMenu(false)
            setTimeout(() => textarea.current?.focus(), 0)
          }}
          disabled={busy}
        >
          <Plus size={17} />
          新建项目<span>⌘ K</span>
        </button>
        <div className="nav-section-label">工作空间</div>
        <button
          className={`nav-item ${!activeId ? 'selected' : ''}`}
          onClick={() => setActiveId(null)}
          disabled={busy}
        >
          <Folder size={17} />
          我的项目<span className="count">{projects.length}</span>
        </button>
        <div className="projects-heading">
          <span>最近项目</span>
          <span className="tiny-dot" />
        </div>
        <div className="project-list">
          {projects.length === 0 ? (
            <p className="no-projects">
              你的下一个作品
              <br />
              会从这里开始。
            </p>
          ) : (
            projects.map((p) => (
              <button
                disabled={busy}
                key={p.id}
                className={`project-link ${activeId === p.id ? 'active' : ''}`}
                onClick={() => setActiveId(p.id)}
              >
                <span className="project-glyph">{p.name.charAt(0)}</span>
                <span>{p.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <div className="local-card-title">
              <span
                className={`status-dot ${status?.workerOnline && !pollingFailed ? 'online' : ''}`}
              />
              {pollingFailed
                ? '服务连接中断'
                : status?.workerOnline
                  ? '本地工作空间'
                  : '等待 Worker 连接'}
            </div>
            <p>想法、代码和版本，保存在本机。</p>
            <button onClick={() => setSettings(true)}>
              查看运行配置
              <ArrowRight size={13} />
            </button>
          </div>
          <button className="settings-button" onClick={() => setSettings(true)}>
            <span className="avatar">P</span>
            <span>
              Pixloom Studio<small>本地预览版 · v0.2</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMenu(true)}
            >
              <Menu size={18} />
            </button>
            <span>工作空间</span>
            <span className="slash">/</span>
            <strong>
              {detail?.project.name || (activeId ? '项目' : '新建项目')}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="prototype-tag">EARLY PREVIEW</span>
            <button
              className="icon-button"
              aria-label="运行配置"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </header>
        {!activeId ? (
          <div className="landing">
            <div className="welcome">
              <div className="eyebrow">
                <span className="asterisk">✳</span> AN IDEA IS ALL IT TAKES
              </div>
              <h1>
                把想法，变成
                <br />
                <span>下一件作品。</span>
              </h1>
              <p className="welcome-copy">
                从一句描述开始，构建属于你的应用。
                <br className="mobile-break" />
                生成、预览、修改，在同一个空间里。
              </p>
              {composer(true)}
              <div className="composer-caption">
                <ShieldCheck size={13} />
                <span>代码在隔离预览中运行</span>
                <span className="caption-divider">·</span>
                <span>HTML / CSS / JavaScript</span>
                <button
                  className="try-example"
                  disabled={busy}
                  onClick={() => void openExample()}
                >
                  体验交互示例 <ArrowRight size={11} />
                </button>
              </div>
              {displayError && (
                <div role="alert" className="error-banner">
                  {displayError}
                  <button aria-label="关闭错误" onClick={() => setError('')}>
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
            <section className="inspiration">
              <div className="section-heading">
                <h2>从一点灵感开始</h2>
                <span>
                  小想法，也值得被实现 <span>↗</span>
                </span>
              </div>
              <div className="starter-grid">
                {starters.map((item) => (
                  <button
                    key={item.tag}
                    className={`starter-card ${item.color}`}
                    onClick={() => {
                      setPrompt(item.text)
                      textarea.current?.focus()
                    }}
                  >
                    <div className="starter-art">
                      <span className="art-circle" />
                      <span className="art-symbol">{item.icon}</span>
                      <span className="art-grid" />
                    </div>
                    <div className="starter-info">
                      <span className="starter-tag">{item.tag}</span>
                      <strong>{item.name}</strong>
                      <ArrowRight size={16} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <footer className="landing-footer">
              <Brand small />
              <span>A little idea. A whole new possibility.</span>
              <span>为创造而生</span>
            </footer>
          </div>
        ) : (
          <div className="workbench">
            <section className="chat-panel">
              <div className="panel-title">
                <span>
                  <span className="agent-symbol">
                    <Sparkles size={14} />
                  </span>
                  构建助手
                </span>
                <span className="agent-label">CODING AGENT</span>
              </div>
              <div className="conversation" ref={conversation}>
                {loading ? (
                  <div className="loading-message">
                    <Loader2 className="spin" size={17} />
                    正在加载项目…
                  </div>
                ) : !detail?.tasks.length ? (
                  <div className="chat-intro">
                    <Wand2 size={24} />
                    <h2>
                      {currentVersion
                        ? '内置交互示例已就绪'
                        : '开始构建你的应用'}
                    </h2>
                    <p>
                      {currentVersion
                        ? '这是手写示例，供你体验预览与导出。'
                        : '描述页面、功能和你喜欢的风格。'}
                      <br />
                      {currentVersion
                        ? '配置模型后，可以通过对话继续修改。'
                        : '我会生成代码，供你预览和继续修改。'}
                    </p>
                  </div>
                ) : (
                  detail.tasks.map((task) => (
                    <div className="turn" key={task.id}>
                      <div className="user-message">{task.prompt}</div>
                      <div className="agent-message">
                        <div className="agent-message-header">
                          <Sparkles size={15} />
                          <strong>Pixloom</strong>
                          <span>{task.model}</span>
                        </div>
                        <div className={`task-state ${task.status}`}>
                          {isActive(task) ? (
                            <Loader2 size={13} className="spin" />
                          ) : task.status === 'completed' ? (
                            <Check size={13} />
                          ) : (
                            <Square size={11} />
                          )}
                          {stateLabels[task.status]}
                          {isActive(task) && (
                            <button onClick={() => void cancel(task)}>
                              停止
                            </button>
                          )}
                        </div>
                        <details className="process" open={isActive(task)}>
                          <summary>
                            执行过程 · {task.events.length} 条记录
                          </summary>
                          <ol>
                            {task.events.map((event, i) => (
                              <li key={i}>
                                <span>{event.message}</span>
                                <time>
                                  {new Date(event.at).toLocaleTimeString(
                                    'zh-CN',
                                    { hour12: false },
                                  )}
                                </time>
                              </li>
                            ))}
                          </ol>
                        </details>
                        {task.error && (
                          <p className="task-error">{task.error}</p>
                        )}
                        {task.status === 'completed' && (
                          <p className="summary-text">
                            {
                              detail.versions.find((v) => v.taskId === task.id)
                                ?.summary
                            }
                          </p>
                        )}
                        {task.usage && (
                          <div className="usage">
                            {(
                              task.usage.inputTokens + task.usage.outputTokens
                            ).toLocaleString()}{' '}
                            tokens
                          </div>
                        )}
                        {task.status === 'failed' && (
                          <button
                            disabled={Boolean(activeTask)}
                            className="text-button"
                            onClick={() => {
                              setPrompt(task.prompt)
                              textarea.current?.focus()
                            }}
                          >
                            <RefreshCw size={12} />
                            重新编辑需求
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="chat-bottom">
                {displayError && (
                  <div role="alert" className="error-banner">
                    {displayError}
                    <button aria-label="关闭错误" onClick={() => setError('')}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                {viewingHistory && (
                  <div className="history-notice">
                    正在查看历史版本；新任务将基于当前 v{currentVersion?.number}
                    。
                  </div>
                )}
                {composer(false)}
                <div className="chat-footnote">
                  版本自动保存 ·{' '}
                  {activeTask
                    ? '任务在后台运行，可以离开此页'
                    : '⌘ / Ctrl + Enter 发送'}
                </div>
              </div>
            </section>
            <section className="preview-panel">
              <div className="preview-toolbar">
                <div className="tabs">
                  <button
                    className={tab === 'preview' ? 'active' : ''}
                    onClick={() => setTab('preview')}
                  >
                    <Monitor size={14} />
                    预览
                  </button>
                  <button
                    className={tab === 'code' ? 'active' : ''}
                    onClick={() => setTab('code')}
                  >
                    <Code2 size={15} />
                    代码
                  </button>
                </div>
                <div className="preview-actions">
                  <button
                    className={`icon-button ${history ? 'pressed' : ''}`}
                    aria-label="版本历史"
                    onClick={() => setHistory(!history)}
                    disabled={!detail?.versions.length}
                  >
                    <History size={16} />
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className={`icon-button ${!mobile ? 'pressed' : ''}`}
                    aria-label="桌面预览"
                    onClick={() => setMobile(false)}
                  >
                    <Monitor size={16} />
                  </button>
                  <button
                    className={`icon-button ${mobile ? 'pressed' : ''}`}
                    aria-label="手机预览"
                    onClick={() => setMobile(true)}
                  >
                    <Smartphone size={15} />
                  </button>
                  <button
                    className="export-button"
                    onClick={download}
                    disabled={!version}
                  >
                    <ArrowDownToLine size={14} />
                    <span>导出</span>
                  </button>
                </div>
              </div>
              <div className="preview-location">
                <span className="location-dot" />
                <span>
                  {version
                    ? `pixloom / ${detail?.project.name} / v${version.number}`
                    : '你的应用将在这里呈现'}
                </span>
                {version && (
                  <button
                    className="icon-button"
                    aria-label="刷新预览"
                    onClick={() => setPreviewKey((k) => k + 1)}
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
              </div>
              {viewingHistory && (
                <div className="version-banner">
                  <span>正在预览历史版本 v{version?.number}</span>
                  <button
                    disabled={busy || Boolean(activeTask)}
                    onClick={() => version && void restore(version)}
                  >
                    恢复为当前版本
                  </button>
                  <button onClick={() => setSelectedVersion(null)}>
                    返回当前
                  </button>
                </div>
              )}
              <div
                className={`preview-canvas ${tab === 'code' ? 'code-canvas' : ''}`}
              >
                {version ? (
                  tab === 'code' ? (
                    <div className="code-view">
                      <div className="file-tab">
                        <FileCode2 size={14} />
                        index.html<span>只读</span>
                      </div>
                      <pre>
                        <code>{version.html}</code>
                      </pre>
                    </div>
                  ) : (
                    <iframe
                      key={`${version.id}-${previewKey}`}
                      title={`应用预览 v${version.number}`}
                      className={mobile ? 'phone-frame' : ''}
                      srcDoc={previewDocument(version.html)}
                      sandbox="allow-scripts"
                      referrerPolicy="no-referrer"
                    />
                  )
                ) : (
                  <div className="preview-empty">
                    <div
                      className={`preview-illustration ${activeTask ? 'building' : ''}`}
                    >
                      <div className="illustration-window">
                        <span />
                        <span />
                        <span />
                        <div className="illustration-lines">
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="illustration-block" />
                      </div>
                      <span className="illustration-spark">✳</span>
                    </div>
                    <h2>
                      {activeTask ? '你的想法，正在成形' : '给想法一个落脚点'}
                    </h2>
                    <p>
                      {activeTask
                        ? '代码生成并通过检查后，应用会出现在这里。'
                        : '发送第一条需求，开始构建你的应用。'}
                    </p>
                    <span className="preview-empty-label">
                      BUILD SOMETHING THAT MATTERS
                    </span>
                  </div>
                )}
              </div>
              <div className="preview-status">
                <span>
                  <ShieldCheck size={12} />
                  隔离预览 · 无外部网络
                </span>
                <span>
                  {version
                    ? `v${version.number}${viewingHistory ? ' · 历史版本' : ' · 当前版本'}`
                    : '等待首次生成'}
                </span>
              </div>
              {history && (
                <div className="history-panel">
                  <div className="panel-title">
                    <span>
                      <History size={15} />
                      版本历史
                    </span>
                    <button
                      aria-label="关闭版本历史"
                      className="icon-button"
                      onClick={() => setHistory(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p>每次成功生成都会保存一个版本。</p>
                  {detail?.versions.map((v) => (
                    <button
                      className={`version-item ${version?.id === v.id ? 'selected' : ''}`}
                      key={v.id}
                      onClick={() => setSelectedVersion(v.id)}
                    >
                      <div>
                        <strong>v{v.number}</strong>
                        {v.id === currentVersion?.id && (
                          <span className="current-label">当前</span>
                        )}
                        <time>{relativeTime(v.createdAt)}</time>
                      </div>
                      <p>{v.summary}</p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">YOUR LOCAL STUDIO</span>
                <h2 id="settings-title">准备好，就开始创造。</h2>
              </div>
              <button
                autoFocus
                aria-label="关闭配置"
                className="icon-button"
                onClick={() => setSettings(false)}
              >
                <X size={19} />
              </button>
            </div>
            <p className="settings-description">
              在仓库根目录的 <code>.env.local</code> 中配置模型，保存后重启 Web
              和 Worker。密钥只在服务端使用。
            </p>
            <div className="config-list">
              {status?.models.map((m) => (
                <div key={m.provider}>
                  <span className="model-logo">
                    {m.provider === 'gemini' ? '✦' : '◎'}
                  </span>
                  <span>
                    <strong>{m.label}</strong>
                    <small>{m.model}</small>
                  </span>
                  <span
                    className={`config-status ${m.configured ? 'ready' : ''}`}
                  >
                    {m.configured ? '已配置' : '未配置'}
                  </span>
                </div>
              ))}
            </div>
            <pre className="env-example">
              {
                '# Gemini：两种 Key 任选其一\nGEMINI_API_KEY=你的_Gemini_Key\n# VERTEX_AI_API_KEY=你现有的_Vertex_Key\nGEMINI_MODEL=gemini-2.5-flash\n\n# 后续切换 GPT\n# OPENAI_API_KEY=你的_OpenAI_Key\n# OPENAI_MODEL=gpt-4.1-mini'
              }
            </pre>
            <div className="worker-status">
              <span
                className={`status-dot ${status?.workerOnline ? 'online' : ''}`}
              />
              <span>
                {status?.workerOnline ? 'Worker 已连接' : 'Worker 未连接'}
              </span>
              <code>pnpm dev</code>
            </div>
            <p className="settings-note">
              本地单用户原型 · SQLite 持久化 · 暂不支持后端、外部 API 或 npm
              依赖。
            </p>
            <button
              className="primary-button"
              onClick={() => setSettings(false)}
            >
              返回工作空间
              <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
