'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  Folder,
  GitCompareArrows,
  History,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  Save,
  Smartphone,
  Square,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type {
  Provider,
  Draft,
  FileOperation,
  Project,
  ProjectDetail,
  SourceFile,
  SystemStatus,
  VersionDetail,
  TaskSummary,
} from '@/lib/types'
import { isActive } from '@/lib/types'
import { diffFiles } from '@/lib/diff'
import { useWorkspaceDialog } from './workspace-dialog'
import type { DockerHealth } from '@/lib/runtime/types'

async function api<T>(
  url: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}
const equal = (a: SourceFile[], b: SourceFile[]) =>
  JSON.stringify([...a].sort((x, y) => x.path.localeCompare(y.path))) ===
  JSON.stringify([...b].sort((x, y) => x.path.localeCompare(y.path)))
const time = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
const labels = {
  queued: '等待执行',
  running: '正在执行',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
function taskLabel(task: TaskSummary) {
  if (task.status !== 'running' || task.kind !== 'agent')
    return labels[task.status]
  const phase = [...task.events]
    .reverse()
    .find((event) =>
      ['model', 'tool', 'build', 'validation', 'ready'].includes(
        event.type || '',
      ),
    )?.type
  return phase === 'validation'
    ? '正在验证预览'
    : phase === 'build'
      ? '正在构建'
      : phase === 'ready'
        ? '正在保存版本'
        : '正在生成源码'
}
type Backup = { id: string; revision: number; createdAt: string }
type Environment = {
  health: DockerHealth
  liveState: string
  workerOnline: boolean
}

export function Workspace() {
  const { ask, dialog } = useWorkspaceDialog()
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null),
    [status, setStatus] = useState<SystemStatus | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null),
    [files, setFiles] = useState<SourceFile[]>([])
  const [file, setFile] = useState('src/App.jsx'),
    [tab, setTab] = useState<'preview' | 'code' | 'diff' | 'runtime'>('preview')
  const [history, setHistory] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [historical, setHistorical] = useState<VersionDetail | null>(null)
  const [current, setCurrent] = useState<VersionDetail | null>(null),
    [parent, setParent] = useState<VersionDetail | null>(null)
  const [compare, setCompare] = useState<'parent' | 'current'>('parent')
  const [older, setOlder] = useState<ProjectDetail['versions']>([]),
    [backups, setBackups] = useState<Backup[]>([])
  const [environment, setEnvironment] = useState<Environment | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [name, setName] = useState(''),
    [summary, setSummary] = useState('')
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState<Provider>('gemini')
  const [mobile, setMobile] = useState(false),
    [previewKey, setPreviewKey] = useState(0),
    [menu, setMenu] = useState(false)
  const ref = useRef({ projectId, draft, files })
  ref.current = { projectId, draft, files }
  const dirty = !!draft && !equal(files, draft.files)
  const active = detail?.tasks.find(isActive)
  const viewingHistory = !!selected
  const shown = viewingHistory ? historical : current
  const shownFiles = viewingHistory ? historical?.files || [] : files
  const content = shownFiles.find((f) => f.path === file)?.content || ''
  const base = projectId ? `/api/projects/${projectId}` : ''
  const currentSummary = detail?.versions.find(
    (v) => v.id === detail.project.currentVersionId,
  )
  const hasChanges = dirty || (!!draft && draft.hash !== currentSummary?.hash)
  const conflict =
    !!detail && !!draft && detail.draft.revision !== draft.revision
  const locked = busy || !!active || viewingHistory || conflict
  const ready = !!status?.workerOnline

  useEffect(() => {
    const remembered = localStorage.getItem('pixloom-v3-project')
    if (remembered) setProjectId(remembered)
  }, [])
  useEffect(() => {
    if (projectId) localStorage.setItem('pixloom-v3-project', projectId)
    else localStorage.removeItem('pixloom-v3-project')
  }, [projectId])
  useEffect(() => {
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
        }
      } catch (e) {
        if (alive) setError((e as Error).message)
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
    setDraft(null)
    setFiles([])
    setSelected(null)
    setHistorical(null)
    setCurrent(null)
    setOlder([])
    setBackups([])
    setEnvironment(null)
    setError('')
    setNotice('')
    setFile('src/App.jsx')
    setPrompt('')
    if (!projectId) return
    let alive = true
    const refresh = async () => {
      try {
        const data = await api<ProjectDetail>(`/api/projects/${projectId}`)
        if (alive) setDetail(data)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void refresh()
    const timer = setInterval(refresh, 1400)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [projectId])
  useEffect(() => {
    if (!detail || detail.project.id !== projectId) return
    const state = ref.current
    if (state.draft?.revision === detail.draft.revision) return
    if (state.draft && !equal(state.files, state.draft.files)) return
    let alive = true
    void api<Draft>(`${base}/files`)
      .then((data) => {
        if (!alive || ref.current.projectId !== data.projectId) return
        const state = ref.current
        if (state.draft && !equal(state.files, state.draft.files)) return
        setDraft(data)
        setFiles(data.files)
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [base, projectId, detail?.draft.revision])
  useEffect(() => {
    setCurrent(null)
    if (!detail?.project.currentVersionId) return
    let alive = true
    void api<VersionDetail>(
      `${base}/versions/${detail.project.currentVersionId}`,
    )
      .then((data) => {
        if (alive) setCurrent(data)
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [
    base,
    detail?.project.currentVersionId,
    detail?.versions.find((v) => v.id === detail.project.currentVersionId)
      ?.artifactId,
  ])
  useEffect(() => {
    setHistorical(null)
    setParent(null)
    if (!selected) return
    let alive = true
    void api<VersionDetail>(`${base}/versions/${selected}`)
      .then(async (data) => {
        if (!alive) return
        setHistorical(data)
        if (data.parentVersionId) {
          const p = await api<VersionDetail>(
            `${base}/versions/${data.parentVersionId}`,
          )
          if (alive) setParent(p)
        }
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [
    base,
    selected,
    detail?.versions.find((v) => v.id === selected)?.artifactId,
  ])
  useEffect(() => {
    if (!projectId) return
    let alive = true
    void api<Backup[]>(`${base}/draft-backups`)
      .then((data) => {
        if (alive) setBackups(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [base, projectId, detail?.draft.revision])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])
  useEffect(() => {
    if (!shownFiles.some((f) => f.path === file) && shownFiles.length)
      setFile(shownFiles[0].path)
  }, [shownFiles, file])
  const refresh = useCallback(async () => {
    if (projectId) {
      const data = await api<ProjectDetail>(base)
      if (ref.current.projectId === projectId) setDetail(data)
    }
  }, [base, projectId])
  async function perform(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function switchProject(id: string | null) {
    if (busy) return
    if (
      dirty &&
      !(await ask('当前有未保存的编辑，离开将丢弃这些编辑。是否继续？'))
    )
      return
    setProjectId(id)
    setMenu(false)
    setHistory(false)
  }
  async function create() {
    if (!name.trim()) return
    await perform(async () => {
      const project = await api<Project>('/api/projects', { name: name.trim() })
      setProjects((list) => [project, ...list])
      setProjectId(project.id)
      setName('')
      setTab('code')
    })
  }
  async function saveDraft() {
    if (!draft) throw new Error('草稿尚未载入')
    const map = new Map(files.map((f) => [f.path, f.content]))
    const operations: FileOperation[] = [
      ...draft.files
        .filter((f) => !map.has(f.path))
        .map((f) => ({ type: 'delete' as const, path: f.path })),
      ...files
        .filter(
          (f) =>
            draft.files.find((x) => x.path === f.path)?.content !== f.content,
        )
        .map((f) => ({ type: 'write' as const, ...f })),
    ]
    if (!operations.length) return draft
    const id = projectId
    const value = await api<Draft>(
      `${base}/files`,
      { expectedRevision: draft.revision, operations },
      'PATCH',
    )
    if (ref.current.projectId === id) {
      setDraft(value)
      setFiles(value.files)
    }
    return value
  }
  async function save() {
    await perform(async () => {
      await saveDraft()
      setNotice('草稿已保存，构建通过后才会创建版本')
      await refresh()
    })
  }
  async function build() {
    await perform(async () => {
      const value = await saveDraft()
      await api(`${base}/commits`, {
        expectedRevision: value.revision,
        expectedVersionId: detail?.project.currentVersionId || null,
        summary: summary.trim() || undefined,
      })
      setSummary('')
      await refresh()
      setTab('preview')
    })
  }
  async function generate() {
    if (!prompt.trim()) return
    await perform(async () => {
      const value = await saveDraft()
      await api(`${base}/tasks`, {
        prompt: prompt.trim(),
        provider,
        expectedRevision: value.revision,
        expectedVersionId: detail?.project.currentVersionId || null,
      })
      setPrompt('')
      await refresh()
      setTab('preview')
    })
  }
  async function restore() {
    if (!historical || !detail || !draft) return
    if (
      !(await ask(
        `将 v${historical.number} 恢复为一个新版本。当前已保存草稿会备份${dirty ? '；未保存编辑将丢弃' : ''}。后续版本仍保留，是否继续？`,
      ))
    )
      return
    await perform(async () => {
      await api(`${base}/restores`, {
        versionId: historical.id,
        expectedRevision: draft.revision,
        expectedVersionId: detail.project.currentVersionId,
      })
      setFiles(draft.files)
      setSelected(null)
      await refresh()
    })
  }
  async function reload() {
    if (dirty && !(await ask('丢弃未保存编辑并重新载入草稿？'))) return
    await perform(async () => {
      const value = await api<Draft>(`${base}/files`)
      setDraft(value)
      setFiles(value.files)
      await refresh()
    })
  }
  async function addFile() {
    const path = await ask('新文件路径，例如 src/components/Card.jsx', '')
    if (!path) return
    if (files.some((f) => f.path === path)) {
      setError('文件已经存在')
      return
    }
    setFiles((list) => [...list, { path, content: '' }])
    setFile(path)
    setTab('code')
  }
  async function renameFile() {
    const to = await ask('新文件路径', file)
    if (!to || to === file) return
    if (files.some((f) => f.path === to)) {
      setError('目标文件已经存在')
      return
    }
    setFiles((list) =>
      list.map((f) => (f.path === file ? { ...f, path: to } : f)),
    )
    setFile(to)
  }
  async function loadEnvironment() {
    await perform(async () => {
      setEnvironment(await api<Environment>(`${base}/runtime?refresh=1`))
    })
  }
  async function lifecycle(action: string) {
    await perform(async () => {
      await api(`${base}/runtime`, {
        action,
        expectedRevision: draft?.revision,
        expectedVersionId: detail?.project.currentVersionId || null,
      })
      await refresh()
    })
  }
  async function rebuildPreview() {
    if (!shown || !draft || !detail) return
    await perform(async () => {
      await api(`${base}/previews`, {
        versionId: shown.id,
        expectedRevision: draft.revision,
        expectedVersionId: detail.project.currentVersionId,
      })
      await refresh()
    })
  }
  const diffs = diffFiles(
    viewingHistory
      ? compare === 'current'
        ? current?.files || []
        : parent?.files || []
      : current?.files || [],
    shownFiles,
  )
  const folderRows: string[] = []
  const tree = shownFiles
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .flatMap((f) => {
      const parts = f.path.split('/'),
        rows: React.ReactNode[] = []
      for (let i = 1; i < parts.length; i++) {
        const folder = parts.slice(0, i).join('/')
        if (!folderRows.includes(folder)) {
          folderRows.push(folder)
          rows.push(
            <div
              className="tree-folder"
              key={`dir:${folder}`}
              style={{ paddingLeft: 12 + (i - 1) * 14 }}
            >
              <Folder size={13} />
              {parts[i - 1]}
            </div>,
          )
        }
      }
      rows.push(
        <button
          className={`tree-file ${file === f.path ? 'selected' : ''}`}
          key={f.path}
          style={{ paddingLeft: 12 + (parts.length - 1) * 14 }}
          onClick={() => setFile(f.path)}
        >
          <FileCode2 size={13} />
          {parts.at(-1)}
        </button>,
      )
      return rows
    })
  return (
    <div className={`app-shell ${projectId ? 'has-project' : ''}`}>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <button className="brand-button" onClick={() => switchProject(null)}>
          <span className="brand">
            pixloom<span className="brand-period">.</span>
          </span>
        </button>
        <button
          className="new-project"
          onClick={() => switchProject(null)}
          disabled={busy}
        >
          <Plus size={17} />
          新建项目
        </button>
        <div className="nav-section-label">REACT WORKSPACE</div>
        <div className="project-list">
          {projects.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              className={`project-link ${p.id === projectId ? 'active' : ''}`}
              onClick={() => switchProject(p.id)}
            >
              <span className="project-glyph">{p.name[0]}</span>
              <span>{p.name}</span>
            </button>
          ))}
          {!projects.length && (
            <p className="no-projects">从一个 React 项目开始。</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <div className="local-card-title">
              <span className={`status-dot ${ready ? 'online' : ''}`} />
              {ready ? 'Worker 已连接' : '等待 Worker 连接'}
            </div>
            <p>源码、版本和预览保存在本机。</p>
            <small>v0.3 · React / Vite</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="项目导航"
            >
              <Folder size={17} />
            </button>
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{detail?.project.name || '新建项目'}</strong>
          </div>
          <span className="prototype-tag">本地工作空间</span>
        </header>
        {!projectId ? (
          <div className="landing">
            <div className="welcome">
              <div className="eyebrow">
                <Sparkles size={15} />
                让想法有一个工作空间
              </div>
              <h1>从这里，开始构建。</h1>
              <p className="welcome-copy">
                创建 React 项目，编辑源码，预览并保留每一次成功的修改。
              </p>
              <form
                className="create-workspace"
                onSubmit={(e) => {
                  e.preventDefault()
                  void create()
                }}
              >
                <label htmlFor="project-name">项目名称</label>
                <input
                  id="project-name"
                  maxLength={80}
                  placeholder="我的新应用"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button
                  className="primary-button"
                  disabled={busy || !name.trim()}
                >
                  {busy ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Plus size={16} />
                  )}
                  创建 React 项目
                </button>
              </form>
              <p className="workspace-hint">
                固定 React / Vite 模板 · AI 修改源码 ·
                构建与行为验证通过后保存版本
              </p>
            </div>
          </div>
        ) : (
          <div className="workbench">
            <section className="chat-panel">
              <div className="panel-title">
                <span>
                  <Sparkles size={15} />
                  Coding Agent
                </span>
                <span className="agent-label">
                  {active ? labels[active.status] : '准备就绪'}
                </span>
              </div>
              <div className="conversation">
                {!detail && <p className="workspace-hint">正在载入项目…</p>}
                <div className="workspace-guide">
                  <Box size={22} />
                  <h2>一个项目，一份源码。</h2>
                  <p>
                    描述你想创建的应用，或要求修改现有功能。Agent
                    会读取源码、编辑并修复构建或浏览器错误，验证通过后保存新版本。
                  </p>
                  <small>也可以在源码页手动编辑并构建。</small>
                </div>
                {detail?.tasks
                  .slice()
                  .reverse()
                  .map((task) => (
                    <article
                      className="agent-message activity-card"
                      key={task.id}
                    >
                      <div className="agent-message-header">
                        <strong>{task.summary}</strong>
                        <time>{time(task.createdAt)}</time>
                      </div>
                      <div className={`task-state ${task.status}`}>
                        {isActive(task) ? (
                          <Loader2 className="spin" size={13} />
                        ) : task.status === 'completed' ? (
                          <Check size={13} />
                        ) : (
                          <Square size={12} />
                        )}{' '}
                        {taskLabel(task)}
                        {isActive(task) && (
                          <button
                            onClick={() =>
                              void perform(async () => {
                                await api(`/api/tasks/${task.id}/cancel`, {})
                                await refresh()
                              })
                            }
                          >
                            取消
                          </button>
                        )}
                      </div>
                      {task.agent && (
                        <p className="workspace-hint">
                          {task.agent.provider === 'gemini' ? 'Gemini' : 'GPT'}{' '}
                          · {task.agent.model} · {task.agent.steps} 步 · 输出{' '}
                          {task.agent.usage.outputTokens} tokens
                        </p>
                      )}
                      <details className="process" open={isActive(task)}>
                        <summary>执行日志 · {task.events.length}</summary>
                        <ol>
                          {task.events.map((event, i) => (
                            <li key={i}>
                              <pre className="task-log">{event.message}</pre>
                            </li>
                          ))}
                        </ol>
                      </details>
                      {task.error && <p className="task-error">{task.error}</p>}
                      {task.kind === 'agent' &&
                        ['failed', 'cancelled'].includes(task.status) && (
                          <button
                            className="text-button"
                            disabled={locked || !draft}
                            onClick={async () => {
                              if (
                                dirty &&
                                !(await ask(
                                  '载入候选源码将覆盖本页未保存编辑，是否继续？',
                                ))
                              )
                                return
                              void perform(async () => {
                                const value = await api<{
                                  files: SourceFile[]
                                }>(`/api/tasks/${task.id}?candidate=1`)
                                setFiles(value.files)
                                setSelected(null)
                                setTab('code')
                                setNotice(
                                  '候选源码已载入编辑器，保存草稿后可手动构建或继续 AI 修改',
                                )
                              })
                            }}
                          >
                            载入候选源码
                          </button>
                        )}
                    </article>
                  ))}
              </div>
              <div className="chat-bottom">
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void generate()
                  }}
                >
                  <textarea
                    aria-label="应用需求"
                    placeholder="创建待办应用，或增加分类筛选…"
                    value={prompt}
                    maxLength={8000}
                    disabled={locked || !draft}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="composer-bottom">
                    <label className="model-select">
                      <select
                        aria-label="生成模型"
                        value={provider}
                        disabled={locked}
                        onChange={(e) =>
                          setProvider(e.target.value as Provider)
                        }
                      >
                        {(status?.models || []).map((model) => (
                          <option key={model.provider} value={model.provider}>
                            {model.label} ·{' '}
                            {model.configured ? model.model : '未配置密钥'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="build-button"
                      type="submit"
                      disabled={
                        locked ||
                        !ready ||
                        !draft ||
                        !prompt.trim() ||
                        !status?.models.find((m) => m.provider === provider)
                          ?.configured
                      }
                    >
                      <Sparkles size={14} />
                      开始生成
                    </button>
                  </div>
                </form>
                {!status?.models.find((m) => m.provider === provider)
                  ?.configured && (
                  <p className="workspace-hint">
                    请在 .env.local 配置所选模型密钥并重启 Web 和 Worker。
                  </p>
                )}
                <p className="workspace-hint">
                  草稿可随时保存；版本仅在构建验证通过后创建。手工构建仅检查编译；AI
                  任务另有浏览器加载与指定行为测试。
                </p>
              </div>
            </section>
            <section className="preview-panel">
              <div className="preview-toolbar">
                <div className="tabs">
                  {(['preview', 'code', 'diff', 'runtime'] as const).map(
                    (key, i) => (
                      <button
                        key={key}
                        className={tab === key ? 'active' : ''}
                        onClick={async () => {
                          setTab(key)
                          if (key === 'runtime') void loadEnvironment()
                        }}
                      >
                        {
                          [
                            <Monitor size={14} key="p" />,
                            <Code2 size={14} key="c" />,
                            <GitCompareArrows size={14} key="d" />,
                            <Box size={14} key="r" />,
                          ][i]
                        }
                        {['预览', '源码', '差异', '环境'][i]}
                      </button>
                    ),
                  )}
                </div>
                <div className="preview-actions">
                  <button
                    className={`icon-button ${history ? 'pressed' : ''}`}
                    aria-label="版本历史"
                    onClick={() => setHistory(!history)}
                  >
                    <History size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="切换手机预览"
                    onClick={() => setMobile(!mobile)}
                  >
                    {mobile ? <Smartphone size={16} /> : <Monitor size={16} />}
                  </button>
                </div>
              </div>
              {viewingHistory ? (
                <div className="version-banner">
                  <span>
                    正在查看历史 {historical ? `v${historical.number}` : '…'} ·
                    只读
                  </span>
                  <button
                    disabled={
                      busy ||
                      !!active ||
                      !historical ||
                      historical.id === detail?.project.currentVersionId ||
                      !ready
                    }
                    onClick={() => void restore()}
                  >
                    恢复为新版本
                  </button>
                  <button onClick={() => setSelected(null)}>返回草稿</button>
                </div>
              ) : (
                <div className="draft-toolbar">
                  <span className={`draft-label ${dirty ? 'unsaved' : ''}`}>
                    {dirty
                      ? '有未保存编辑'
                      : hasChanges
                        ? '草稿已保存 · 尚未构建'
                        : '已与当前版本一致'}
                    {currentSummary && ` · 当前 v${currentSummary.number}`}
                  </span>
                  <div>
                    <button
                      disabled={locked || !dirty}
                      onClick={() => void save()}
                    >
                      <Save size={14} />
                      保存草稿
                    </button>
                    <button
                      className="build-button"
                      disabled={locked || !ready || !draft || !hasChanges}
                      onClick={() => void build()}
                    >
                      {active ? (
                        <Loader2 className="spin" size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                      构建并保存版本
                    </button>
                  </div>
                </div>
              )}
              {conflict && (
                <div className="error-banner">
                  草稿已在其他页面或任务中更新。未保存编辑保留在本页。
                  <button onClick={() => void reload()}>重新载入</button>
                </div>
              )}
              {tab === 'preview' && (
                <>
                  <div className="preview-location">
                    <span className="location-dot" />
                    <span>
                      {shown
                        ? `构建产物预览 / v${shown.number}`
                        : '等待首次构建'}
                    </span>
                    <button
                      className="text-button"
                      disabled={
                        busy || !!active || !shown || !ready || conflict
                      }
                      onClick={() => void rebuildPreview()}
                    >
                      重建此版本预览
                    </button>
                    <button
                      className="icon-button"
                      aria-label="刷新预览"
                      onClick={() => setPreviewKey((k) => k + 1)}
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>
                  <div className="preview-canvas">
                    {shown ? (
                      <iframe
                        key={`${shown.artifactId}-${previewKey}`}
                        title={`应用预览 v${shown.number}`}
                        className={mobile ? 'phone-frame' : ''}
                        src={`/api/previews/${shown.artifactId}/index.html`}
                        sandbox="allow-scripts"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="preview-empty">
                        <Box size={34} />
                        <h2>
                          {active ? '正在构建你的项目' : '还没有可用版本'}
                        </h2>
                        <p>输入应用需求开始生成，或在源码页编辑并构建。</p>
                      </div>
                    )}
                  </div>
                  <div className="preview-status">
                    <span>隔离预览 · 无外部网络</span>
                    <span>草稿修改不影响当前预览</span>
                  </div>
                </>
              )}
              {tab === 'code' && (
                <div className="source-layout">
                  <aside className="file-tree">
                    <div className="file-tree-heading">
                      <strong>项目文件</strong>
                      <button
                        disabled={locked || !draft}
                        onClick={addFile}
                        aria-label="新建文件"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    {tree}
                  </aside>
                  <div className="source-editor">
                    <div className="file-tab">
                      <FileCode2 size={14} />
                      {file}
                      <span>{viewingHistory ? '历史快照 · 只读' : '草稿'}</span>
                      {!viewingHistory && (
                        <>
                          <button
                            disabled={
                              locked ||
                              ['index.html', 'src/main.jsx'].includes(file)
                            }
                            onClick={renameFile}
                          >
                            重命名
                          </button>
                          <button
                            disabled={
                              locked ||
                              ['index.html', 'src/main.jsx'].includes(file)
                            }
                            aria-label="删除文件"
                            onClick={async () => {
                              if (await ask(`删除 ${file}？保存草稿后生效。`))
                                setFiles((list) =>
                                  list.filter((f) => f.path !== file),
                                )
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                    <textarea
                      className="source-textarea"
                      aria-label={`源码 ${file}`}
                      value={content}
                      spellCheck={false}
                      readOnly={locked || !draft}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                          e.preventDefault()
                          if (!locked) void save()
                        }
                      }}
                      onChange={(e) =>
                        setFiles((list) =>
                          list.map((f) =>
                            f.path === file
                              ? { ...f, content: e.target.value }
                              : f,
                          ),
                        )
                      }
                    />
                    {!viewingHistory && (
                      <div className="commit-summary">
                        <input
                          aria-label="版本摘要"
                          placeholder="版本摘要（可选）"
                          value={summary}
                          maxLength={500}
                          disabled={locked}
                          onChange={(e) => setSummary(e.target.value)}
                        />
                        <span>{shownFiles.length} 个文件</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {tab === 'diff' && (
                <div className="diff-panel">
                  <div className="diff-heading">
                    <strong>
                      {viewingHistory ? '历史版本差异' : '草稿与当前版本的差异'}
                    </strong>
                    {viewingHistory && (
                      <select
                        aria-label="对比基线"
                        value={compare}
                        onChange={(e) =>
                          setCompare(e.target.value as 'parent' | 'current')
                        }
                      >
                        <option value="parent">与父版本对比</option>
                        <option value="current">与当前版本对比</option>
                      </select>
                    )}
                  </div>
                  {!diffs.length ? (
                    <p className="workspace-hint">没有文件差异。</p>
                  ) : (
                    diffs.map((diff) => (
                      <article className="file-diff" key={diff.path}>
                        <h3>
                          <span>
                            {diff.type === 'added'
                              ? '新增'
                              : diff.type === 'deleted'
                                ? '删除'
                                : '修改'}
                          </span>
                          {diff.path}
                        </h3>
                        <pre>
                          {diff.lines.map((line, i) => (
                            <div key={i} className={`diff-line ${line.type}`}>
                              {line.type === 'added'
                                ? '+'
                                : line.type === 'removed'
                                  ? '-'
                                  : ' '}{' '}
                              {line.text}
                            </div>
                          ))}
                        </pre>
                        {diff.truncated && (
                          <p>
                            内容较长，仅展示前 2000 行。请在源码页查看完整文件。
                          </p>
                        )}
                      </article>
                    ))
                  )}
                </div>
              )}
              {tab === 'runtime' && (
                <div className="environment-view">
                  <h2>
                    <Box size={22} />
                    执行环境
                  </h2>
                  <p>
                    容器只用于构建。停止或移除容器不会删除草稿、版本和已保存预览。
                  </p>
                  <dl>
                    <dt>Docker</dt>
                    <dd>
                      {environment?.health.available
                        ? '已连接'
                        : environment?.health.reason || '正在检查'}
                    </dd>
                    <dt>模板镜像</dt>
                    <dd>
                      {environment?.health.imageReady
                        ? '已就绪'
                        : '请运行 pnpm sandbox:prepare'}
                    </dd>
                    <dt>容器</dt>
                    <dd>{environment?.liveState || '未知'}</dd>
                  </dl>
                  <div className="environment-actions">
                    <button
                      disabled={busy}
                      onClick={() => void loadEnvironment()}
                    >
                      <RefreshCw size={14} />
                      刷新
                    </button>
                    {(['start', 'stop', 'remove'] as const).map((action) => (
                      <button
                        key={action}
                        disabled={busy || !!active || !ready || !draft}
                        onClick={async () => {
                          if (
                            action !== 'remove' ||
                            (await ask(
                              '仅移除本项目容器，源码和历史预览保留。是否继续？',
                            ))
                          )
                            void lifecycle(action)
                        }}
                      >
                        {
                          {
                            start: '启动 / 重建环境',
                            stop: '停止环境',
                            remove: '移除容器',
                          }[action]
                        }
                      </button>
                    ))}
                  </div>
                  <p className="workspace-hint">
                    固定依赖 · 无网络 · 非 root · 512 MiB 内存 · 1 CPU
                  </p>
                </div>
              )}
              {history && (
                <div className="history-panel">
                  <div className="panel-title">
                    <span>
                      <History size={15} />
                      版本历史
                    </span>
                    <button
                      className="icon-button"
                      aria-label="关闭版本历史"
                      onClick={() => setHistory(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p>每次成功构建形成快照，恢复也会新增版本。</p>
                  {[
                    ...(detail?.versions || []),
                    ...older.filter(
                      (v) => !detail?.versions.some((x) => x.id === v.id),
                    ),
                  ].map((v) => (
                    <button
                      key={v.id}
                      className={`version-item ${selected === v.id ? 'selected' : ''}`}
                      onClick={async () => {
                        setSelected(v.id)
                        setCompare('parent')
                        setHistory(false)
                      }}
                    >
                      <div>
                        <strong>v{v.number}</strong>
                        {v.id === detail?.project.currentVersionId && (
                          <span className="current-label">当前</span>
                        )}
                        <time>{time(v.createdAt)}</time>
                      </div>
                      <p>{v.summary}</p>
                      <small>
                        {v.source === 'restore'
                          ? '恢复快照'
                          : v.source === 'template'
                            ? 'React 模板'
                            : v.source === 'agent'
                              ? 'AI 生成'
                              : '手工修改'}
                      </small>
                    </button>
                  ))}
                  {(older.at(-1) || detail?.versions.at(-1))?.number! > 1 && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void perform(async () => {
                          const before = (older.at(-1) ||
                            detail?.versions.at(-1))!.number
                          const rows = await api<ProjectDetail['versions']>(
                            `${base}/versions?before=${before}`,
                          )
                          setOlder((list) => [...list, ...rows])
                        })
                      }
                    >
                      加载更早版本
                    </button>
                  )}
                  {backups.length > 0 && (
                    <div className="draft-backups">
                      <h3>恢复前的草稿备份</h3>
                      {backups.map((b) => (
                        <button
                          key={b.id}
                          disabled={busy || !!active || !draft}
                          onClick={async () => {
                            if (
                              await ask(
                                '将备份内容载入草稿，现有草稿会另行备份；未保存编辑将丢弃。是否继续？',
                              )
                            )
                              void perform(async () => {
                                const value = await api<Draft>(
                                  `${base}/draft-backups`,
                                  {
                                    backupId: b.id,
                                    expectedRevision: draft?.revision,
                                  },
                                )
                                setDraft(value)
                                setFiles(value.files)
                                setSelected(null)
                                setHistory(false)
                                setTab('code')
                                await refresh()
                              })
                          }}
                        >
                          草稿 #{b.revision} · {time(b.createdAt)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
        {(error || notice) && (
          <div
            role={error ? 'alert' : 'status'}
            className={`workspace-toast ${error ? 'error' : ''}`}
          >
            <span>{error || notice}</span>
            <button
              aria-label="关闭提示"
              onClick={async () => {
                setError('')
                setNotice('')
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </main>
      {dialog}
    </div>
  )
}
