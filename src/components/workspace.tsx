'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Cloud,
  Hammer,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Folder,
  GitCompareArrows,
  History,
  Loader2,
  Monitor,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Rocket,
  Save,
  Smartphone,
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
  Publication,
} from '@/lib/types'
import { isActive } from '@/lib/types'
import {
  normalizePublicationPrefix,
  publicationPrefixError,
} from '@/lib/publication/prefix'
import { diffFiles } from '@/lib/diff'
import { useWorkspaceDialog } from './workspace-dialog'
import { WorkspaceAccount, useWorkspaceAccount } from './workspace-account'
import { WorkspaceCloud } from './workspace-cloud'
import { TrustedPreview } from './trusted-preview'
import { MarkdownReply } from './markdown-reply'
import { TaskProgress } from './task-progress'
import { useWorkspaceNavigation } from './use-workspace-navigation'
import {
  parseWorkspacePath,
  workspaceHome,
  workspaceTabs,
  type WorkspaceTab,
} from '@/lib/workspace-route'
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
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event('pixloom:unauthorized'))
    throw new Error(data.error || '请求失败')
  }
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
const promptExamples = [
  {
    label: '做一个私房食谱本',
    prompt: `帮我做一个私房食谱本，风格温暖简洁，手机和电脑都能用。

支持注册、登录、退出，重新打开后保持登录。每个人只能看到自己的食谱。

食谱可以新增、编辑、删除，包含名称、分类、食材、做法、烹饪时间和评分，还能标记收藏。支持搜索、分类筛选、排序和分页，首页显示食谱数量和收藏数量。

每份食谱可以保存一份文字备忘文件，并再次打开查看。食谱和文件都要真实保存到云端，刷新后仍然存在。`,
  },
  {
    label: '做一个支持分类筛选的待办应用',
    prompt: `帮我做一个待办应用，风格清爽简洁，手机和电脑都能用。

支持注册、登录、退出，重新打开后保持登录。每个人只能看到自己的任务和分类。

任务可以新增、编辑、删除，包含标题、分类、优先级、截止日期和备注，还能标记完成或恢复未完成。分类可以自定义。支持搜索，按分类、完成状态和优先级筛选，按截止日期、优先级或创建时间排序，并支持分页。首页显示任务总数、未完成数量、已完成数量和逾期数量。

每个任务可以保存一份文字备忘文件，并再次打开查看。任务、分类和文件都要真实保存到云端，刷新后仍然存在。`,
  },
  {
    label: '做一个可以暂停和重置的番茄钟',
    prompt: `帮我做一个番茄钟应用，风格安静简洁，手机和电脑都能用。

支持注册、登录、退出，重新打开后保持登录。每个人只能看到自己的专注记录和设置。

支持专注、短休息和长休息三种模式，可以自定义各阶段时长和长休息间隔。计时可以开始、暂停、继续和重置，结束时显示提醒。切换页面或刷新后，仍能恢复当前计时状态并准确显示剩余时间。

每次专注可以填写任务名称和分类，完成后自动保存专注记录，包含开始时间、实际专注时长和备注。支持查看历史记录、编辑备注、删除记录，按任务名称搜索、按分类和日期筛选，并支持排序和分页。首页显示今日完成的番茄数、今日专注时长和累计专注时长。

专注记录、个人设置和当前计时状态都要真实保存到云端，刷新或重新登录后仍然存在。`,
  },
]
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
        : '正在处理需求'
}
function taskReply(task: TaskSummary) {
  if (!task.agent) return ''
  if (task.status === 'cancelled') return '已停止本次生成。你可以继续描述需求。'
  if (task.status !== 'completed') return ''
  return (
    [...task.events].reverse().find((event) => event.type === 'reply')
      ?.message ||
    [...task.events]
      .reverse()
      .find(
        (event) =>
          event.type === 'model' && !event.message.startsWith('模型第 '),
      )?.message ||
    '修改已完成，预览已更新。'
  )
}
type Backup = { id: string; revision: number; createdAt: string }
type Environment = {
  health: DockerHealth
  liveState: string
  workerOnline: boolean
}

export function Workspace() {
  const account = useWorkspaceAccount()
  return (
    <WorkspaceSession
      key={account.session.user?.id || 'visitor'}
      account={account}
    />
  )
}

function WorkspaceSession({
  account,
}: {
  account: ReturnType<typeof useWorkspaceAccount>
}) {
  const { ask, dialog } = useWorkspaceDialog()
  const { canAccess } = account
  const { route, navigate } = useWorkspaceNavigation(
    async () =>
      !dirty ||
      !!(await ask('当前有未保存的编辑，离开将丢弃这些编辑。是否继续？')),
  )
  const projectId = canAccess ? route.projectId : null
  const tab = route.tab
  const selected = canAccess ? route.versionId : null
  const [projects, setProjects] = useState<Project[]>([])
  const [detail, setDetail] = useState<ProjectDetail | null>(null),
    [status, setStatus] = useState<SystemStatus | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null),
    [files, setFiles] = useState<SourceFile[]>([])
  const [file, setFile] = useState('src/App.jsx')
  const [publication, setPublication] = useState<Publication | null>(null)
  const [prefixEdit, setPrefixEdit] = useState<string | null>(null)
  const [history, setHistory] = useState(false),
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
    [summary, setSummary] = useState('')
  const [prompt, setPrompt] = useState('')
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [projectName, setProjectName] = useState('')
  const conversationRef = useRef<HTMLDivElement>(null)
  const followConversation = useRef(true)
  const provider: Provider = 'gemini'
  const [mobile, setMobile] = useState(false),
    [previewKey, setPreviewKey] = useState(0),
    [menu, setMenu] = useState(false)
  const ref = useRef({ projectId, draft, files })
  ref.current = { projectId, draft, files }
  const dirty = !!draft && !equal(files, draft.files)
  function setTab(tab: WorkspaceTab) {
    void navigate({ ...route, tab })
  }
  function setSelected(versionId: string | null) {
    void navigate({ ...route, versionId })
  }
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
  const ready = canAccess && !!status?.workerOnline
  const aiReady = ready && (account.session.usage?.remainingCredits ?? 1) > 0
  const latestTask = detail?.tasks[0]
  const domainPrefix = prefixEdit ?? publication?.prefix ?? ''
  const normalizedPrefix = normalizePublicationPrefix(domainPrefix)
  const prefixError = publicationPrefixError(normalizedPrefix)
  const prefixChanged = normalizedPrefix !== publication?.prefix

  useEffect(() => {
    setPrefixEdit(null)
  }, [projectId, publication?.prefix])

  useEffect(() => {
    if (!error && !notice) return
    const timer = window.setTimeout(() => {
      setError('')
      setNotice('')
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [error, notice])

  useEffect(() => {
    if (!account.session.user?.id || latestTask?.kind !== 'agent') return
    void account.refresh()
    if (!isActive(latestTask)) return
    const timer = window.setInterval(() => void account.refresh(), 10000)
    return () => window.clearInterval(timer)
  }, [
    account.refresh,
    account.session.user?.id,
    latestTask?.id,
    latestTask?.kind,
    latestTask?.status,
  ])

  useEffect(() => {
    if (!copiedTaskId) return
    const timer = window.setTimeout(() => setCopiedTaskId(null), 2000)
    return () => window.clearTimeout(timer)
  }, [copiedTaskId])

  useEffect(() => {
    if (!canAccess) {
      setProjects([])
      return
    }
    const cloudProject = new URL(window.location.href).searchParams.get(
      'cloudProject',
    )
    const legacyRoute = cloudProject
      ? parseWorkspacePath(`/projects/${cloudProject}/cloud`)
      : null
    if (legacyRoute) void navigate(legacyRoute, true)
  }, [canAccess, navigate])
  useEffect(() => {
    if (!menu) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menu])
  useEffect(() => {
    if (!canAccess) return
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
  }, [canAccess])
  useEffect(() => {
    setDetail(null)
    setDraft(null)
    setFiles([])
    setHistorical(null)
    setCurrent(null)
    setOlder([])
    setBackups([])
    setEnvironment(null)
    setPublication(null)
    setError('')
    setNotice('')
    setFile('src/App.jsx')
    setPrompt('')
    setRenaming(false)
    followConversation.current = true
    if (!projectId || !canAccess) return
    let alive = true
    const refresh = async () => {
      try {
        const [data, releases] = await Promise.all([
          api<ProjectDetail>(`/api/projects/${projectId}`),
          api<Publication>(`/api/projects/${projectId}/releases`),
        ])
        if (alive) {
          setDetail(data)
          setPublication(releases)
        }
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
  }, [projectId, canAccess])
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
    if (!selected || !projectId || !canAccess) return
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
    canAccess,
    projectId,
    selected,
    detail?.versions.find((v) => v.id === selected)?.artifactId,
  ])
  useEffect(() => {
    if (!projectId || !canAccess || tab !== 'runtime') return
    let alive = true
    void api<Environment>(`${base}/runtime?refresh=1`)
      .then((data) => {
        if (alive) setEnvironment(data)
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [base, projectId, canAccess, tab])
  useEffect(() => {
    if (!projectId || !canAccess) return
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
  useEffect(() => {
    const container = conversationRef.current
    if (container && followConversation.current)
      container.scrollTop = container.scrollHeight
  }, [
    projectId,
    detail?.tasks[0]?.id,
    detail?.tasks[0]?.status,
    detail?.tasks[0]?.events.length,
  ])
  const modelConfigured = !!status?.models.find((m) => m.provider === provider)
    ?.configured
  const modelHint = account.loading
    ? ''
    : !canAccess
      ? account.session.user
        ? '兑换邀请码后即可开始创建应用。'
        : '登录后兑换邀请码，即可开始创建应用。'
      : !status
        ? ''
        : !modelConfigured
          ? '请在 .env.local 配置 Gemini 密钥并重启 Web 和 Worker。'
          : account.session.usage?.remainingCredits === 0
            ? '体验额度已用尽，已有项目仍可查看、编辑和导出。'
            : !ready
              ? 'Worker 未连接，请运行 pnpm dev 或 pnpm worker。'
              : ''
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
    if (!(await navigate({ ...workspaceHome, projectId: id }))) return
    setMenu(false)
    setHistory(false)
  }
  async function rename() {
    if (!projectId || !projectName.trim() || busy) return
    await perform(async () => {
      const project = await api<Project>(
        base,
        { name: projectName.trim() },
        'PATCH',
      )
      setProjects((list) =>
        list.map((item) => (item.id === project.id ? project : item)),
      )
      setDetail((value) =>
        value?.project.id === project.id ? { ...value, project } : value,
      )
      setRenaming(false)
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
  async function copyTask(task: TaskSummary) {
    try {
      await navigator.clipboard.writeText(
        [taskReply(task), task.error].filter(Boolean).join('\n\n'),
      )
      setCopiedTaskId(task.id)
    } catch {
      setError('复制失败，请检查浏览器剪贴板权限后重试。')
    }
  }
  async function generate(retryTask?: TaskSummary) {
    if (
      retryTask &&
      (retryTask.kind !== 'agent' ||
        retryTask.status !== 'failed' ||
        !retryTask.agent)
    )
      return
    const requestPrompt = retryTask?.agent?.prompt || prompt.trim()
    if (
      busy ||
      active ||
      viewingHistory ||
      conflict ||
      !requestPrompt ||
      !aiReady ||
      !modelConfigured
    )
      return
    followConversation.current = true
    await perform(async () => {
      if (!projectId) {
        const project = await api<Project>('/api/projects', {
          prompt: requestPrompt,
          provider,
        })
        setProjects((list) => [project, ...list])
        await navigate({ ...workspaceHome, projectId: project.id })
        setPrompt('')
        return
      }
      const value = await saveDraft()
      await api(`${base}/tasks`, {
        prompt: requestPrompt,
        provider,
        expectedRevision: value.revision,
        expectedVersionId: detail?.project.currentVersionId || null,
      })
      if (!retryTask) setPrompt('')
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
  async function downloadVersion() {
    if (!shown || !projectId || busy) return
    const version = shown
    await perform(async () => {
      const response = await fetch(`${base}/versions/${version.id}/export`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '导出失败')
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `pixloom-${projectId}-v${version.number}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setNotice(
        `已导出 v${version.number} 交付包，包含源码和静态产物，不含草稿修改。`,
      )
    })
  }
  async function publish(
    action: 'publish' | 'rollback' | 'unpublish',
    releaseId?: string,
  ) {
    if (!publication || busy || active || !ready) return
    await perform(async () => {
      await api(`${base}/releases`, {
        action,
        expectedReleaseId: publication.live?.id || null,
        ...(action === 'publish'
          ? {
              versionId: shown?.id,
              ...(prefixChanged
                ? {
                    prefix: normalizedPrefix,
                    expectedPrefix: publication.prefix,
                  }
                : {}),
            }
          : action === 'rollback'
            ? { releaseId }
            : {}),
      })
      setPublication(await api<Publication>(`${base}/releases`))
      await refresh()
      setNotice(
        action === 'unpublish'
          ? '下线操作已排队。'
          : '发布操作已排队，可在此查看进度。',
      )
    })
  }
  async function savePublicationPrefix() {
    if (!publication || busy || active || prefixError) return
    await perform(async () => {
      const result = await api<Publication>(
        `${base}/releases`,
        {
          prefix: normalizedPrefix,
          expectedPrefix: publication.prefix,
          expectedReleaseId: publication.live?.id || null,
        },
        'PATCH',
      )
      setPublication(result)
      setPrefixEdit(null)
      setNotice(
        result.live
          ? '域名前缀已更新，新地址已生效。'
          : '域名前缀已保存，发布时将使用此地址。',
      )
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
    <div
      className={`app-shell ${projectId ? 'has-project' : ''} ${menu ? 'navigation-open' : ''}`}
    >
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        id="project-navigation"
        aria-label="项目导航"
        className={`sidebar ${menu ? 'open' : ''}`}
      >
        <button
          className="icon-button sidebar-close"
          aria-label="收起侧边栏"
          onClick={() => setMenu(false)}
        >
          <PanelLeftClose size={18} />
        </button>
        <button className="brand-button" onClick={() => switchProject(null)}>
          <span className="brand">pixloom</span>
        </button>
        <button
          className="new-project"
          onClick={() => switchProject(null)}
          disabled={busy}
        >
          <Plus size={17} />
          新对话
        </button>
        <div className="nav-section-label">最近的对话</div>
        <div className="project-list">
          {projects.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              className={`project-link ${p.id === projectId ? 'active' : ''}`}
              onClick={() => switchProject(p.id)}
            >
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <WorkspaceAccount
            account={account}
            beforeNavigate={async () => {
              if (busy) return false
              return (
                !dirty ||
                !!(await ask(
                  '当前有未保存的编辑，登录或退出将离开此页面。是否继续？',
                ))
              )
            }}
          />
        </div>
      </aside>
      <main className="main">
        {projectId && (
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                onClick={() => setMenu((open) => !open)}
                aria-label={menu ? '收起侧边栏' : '展开侧边栏'}
                title={menu ? '收起侧边栏' : '展开侧边栏'}
                aria-expanded={menu}
                aria-controls="project-navigation"
              >
                {menu ? (
                  <PanelLeftClose size={18} />
                ) : (
                  <PanelLeftOpen size={18} />
                )}
              </button>
              {renaming ? (
                <form
                  className="rename-project"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void rename()
                  }}
                >
                  <input
                    autoFocus
                    aria-label="项目名称"
                    value={projectName}
                    maxLength={80}
                    disabled={busy}
                    onChange={(e) => setProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setRenaming(false)
                    }}
                  />
                  <button
                    type="submit"
                    disabled={busy || !projectName.trim()}
                    aria-label="保存名称"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="取消重命名"
                    onClick={() => setRenaming(false)}
                  >
                    <X size={15} />
                  </button>
                </form>
              ) : (
                <>
                  <strong>
                    {projectId
                      ? detail?.project.name ||
                        projects.find((p) => p.id === projectId)?.name ||
                        '正在载入…'
                      : '新对话'}
                  </strong>
                  {projectId && detail && (
                    <button
                      className="icon-button"
                      aria-label="重命名项目"
                      disabled={busy}
                      onClick={() => {
                        setProjectName(detail.project.name)
                        setRenaming(true)
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          </header>
        )}
        {!projectId ? (
          <div className="landing">
            <button
              className="icon-button mobile-menu landing-menu"
              onClick={() => setMenu((open) => !open)}
              aria-label={menu ? '收起侧边栏' : '展开侧边栏'}
              title={menu ? '收起侧边栏' : '展开侧边栏'}
              aria-expanded={menu}
              aria-controls="project-navigation"
            >
              {menu ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </button>
            <div className="welcome">
              <h1>你想做一个什么应用？</h1>
              <p className="welcome-copy">从一句想法开始，我们把它一起实现</p>
              <form
                className="composer landing-composer"
                onSubmit={(e) => {
                  e.preventDefault()
                  void generate()
                }}
              >
                <textarea
                  autoFocus
                  aria-label="应用需求"
                  placeholder="例如：做一个待办应用，支持分类、完成标记和筛选…"
                  value={prompt}
                  maxLength={8000}
                  disabled={busy}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <div className="composer-bottom">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      busy || !prompt.trim() || !aiReady || !modelConfigured
                    }
                  >
                    {busy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    {busy ? '正在开始…' : '开始对话'}
                  </button>
                </div>
              </form>
              {modelHint && (
                <p className="workspace-hint" role="status">
                  {modelHint}
                </p>
              )}
              <div className="prompt-examples" aria-label="试试这些想法">
                {promptExamples.map((example) => (
                  <button
                    key={example.label}
                    disabled={busy}
                    onClick={() => setPrompt(example.prompt)}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="workbench">
            <section className="chat-panel">
              <div
                className="conversation"
                ref={conversationRef}
                onScroll={(e) => {
                  const el = e.currentTarget
                  followConversation.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 100
                }}
              >
                {!detail && <p className="workspace-hint">正在载入项目…</p>}
                {detail &&
                  !detail.tasks.some((task) => task.kind === 'agent') && (
                    <div className="workspace-guide">
                      <Box size={22} />
                      <h2>从你的想法开始。</h2>
                      <p>
                        描述你想创建的应用，或要求修改现有功能。Agent
                        会读取源码、编辑并完成构建后保存新版本。自动测试失败会保留提示，你仍可查看预览。
                      </p>
                      <small>也可以在源码页手动编辑并构建。</small>
                    </div>
                  )}
                {detail?.tasks
                  .slice()
                  .reverse()
                  .map((task) => (
                    <Fragment key={task.id}>
                      {task.agent && (
                        <div className="user-message">{task.agent.prompt}</div>
                      )}
                      <article className="agent-message activity-card">
                        <div className="agent-message-header">
                          <strong>
                            {task.agent ? 'Pixloom' : task.summary}
                          </strong>
                          <time>{time(task.createdAt)}</time>
                        </div>
                        <div className="task-status-row">
                          <TaskProgress task={task} label={taskLabel(task)} />
                        </div>
                        {task.agent && task.status === 'completed' && (
                          <MarkdownReply>{taskReply(task)}</MarkdownReply>
                        )}
                        {task.agent && task.status === 'cancelled' && (
                          <p className="summary-text">{taskReply(task)}</p>
                        )}
                        {task.error && (
                          <p className="task-error">{task.error}</p>
                        )}
                        {(task.agent || isActive(task)) && (
                          <footer className="task-actions">
                            {task.agent && !isActive(task) && (
                              <>
                                {task.status === 'failed' && (
                                  <button
                                    className="task-action"
                                    type="button"
                                    disabled={
                                      locked ||
                                      !aiReady ||
                                      !draft ||
                                      !modelConfigured
                                    }
                                    title="使用原需求通过 Gemini 重新生成"
                                    onClick={() => void generate(task)}
                                  >
                                    <RefreshCw size={13} aria-hidden="true" />
                                    重试
                                  </button>
                                )}
                                {(taskReply(task) || task.error) && (
                                  <button
                                    className="task-action"
                                    type="button"
                                    title="复制回复"
                                    onClick={() => void copyTask(task)}
                                  >
                                    {copiedTaskId === task.id ? (
                                      <Check size={13} aria-hidden="true" />
                                    ) : (
                                      <Copy size={13} aria-hidden="true" />
                                    )}
                                    <span role="status">
                                      {copiedTaskId === task.id
                                        ? '已复制'
                                        : '复制'}
                                    </span>
                                  </button>
                                )}
                              </>
                            )}
                            {isActive(task) && (
                              <button
                                className="task-action task-cancel"
                                type="button"
                                onClick={() =>
                                  void perform(async () => {
                                    await api(
                                      `/api/tasks/${task.id}/cancel`,
                                      {},
                                    )
                                    await refresh()
                                  })
                                }
                              >
                                <X size={13} aria-hidden="true" />
                                取消
                              </button>
                            )}
                          </footer>
                        )}
                      </article>
                    </Fragment>
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
                    placeholder="描述你想调整的地方，或继续补充需求…"
                    value={prompt}
                    maxLength={8000}
                    disabled={locked || !draft}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="composer-bottom">
                    <button
                      className="build-button"
                      type="submit"
                      disabled={
                        locked ||
                        !aiReady ||
                        !draft ||
                        !prompt.trim() ||
                        !modelConfigured
                      }
                    >
                      <Sparkles size={14} />
                      发送
                    </button>
                  </div>
                </form>
                {modelHint && (
                  <p className="workspace-hint" role="status">
                    {modelHint}
                  </p>
                )}
                {viewingHistory && (
                  <p className="workspace-hint">
                    正在查看历史版本，返回草稿后可继续对话。
                  </p>
                )}
              </div>
            </section>
            <section className="preview-panel">
              <div className="preview-toolbar">
                <div className="tabs">
                  {workspaceTabs.map((key, i) => {
                    if (key === 'runtime' || key === 'cloud') return null
                    return (
                      <button
                        key={key}
                        className={tab === key ? 'active' : ''}
                        onClick={() => setTab(key)}
                      >
                        {
                          [
                            <Monitor size={14} key="p" />,
                            <Code2 size={14} key="c" />,
                            <GitCompareArrows size={14} key="d" />,
                            <Box size={14} key="r" />,
                            <Cloud size={14} key="cloud" />,
                            <Rocket size={14} key="s" />,
                          ][i]
                        }
                        {['预览', '源码', '差异', '环境', '云后端', '发布'][i]}
                      </button>
                    )
                  })}
                </div>
                <div className="preview-actions">
                  <button
                    className="icon-button"
                    aria-label={
                      shown ? `导出 v${shown.number} 交付包` : '导出交付包'
                    }
                    title={
                      shown
                        ? `导出 v${shown.number} 交付包（不含草稿）`
                        : '首次构建成功后可导出'
                    }
                    disabled={busy || !shown}
                    onClick={() => void downloadVersion()}
                  >
                    <Download size={16} />
                  </button>
                  <button
                    className={`icon-button ${history ? 'pressed' : ''}`}
                    aria-label="版本历史"
                    onClick={() => setHistory(!history)}
                  >
                    <History size={16} />
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
              ) : tab === 'code' || tab === 'diff' ? (
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
              ) : null}
              {conflict && (
                <div className="error-banner">
                  草稿已在其他页面或任务中更新。未保存编辑保留在本页。
                  <button onClick={() => void reload()}>重新载入</button>
                </div>
              )}
              {tab === 'preview' && (
                <>
                  <div className="preview-location">
                    <div className="preview-location-label">
                      <span>{shown ? '应用预览' : '等待首次构建'}</span>
                      {shown && (
                        <span className="preview-version">v{shown.number}</span>
                      )}
                    </div>
                    <div className="preview-location-actions">
                      <button
                        className="preview-rebuild"
                        title="重新构建此版本的预览"
                        disabled={
                          busy || !!active || !shown || !ready || conflict
                        }
                        onClick={() => void rebuildPreview()}
                      >
                        <Hammer size={13} />
                        重新构建
                      </button>
                      <span className="toolbar-divider" aria-hidden="true" />
                      <button
                        className={`icon-button ${mobile ? 'pressed' : ''}`}
                        aria-label={mobile ? '切换 Web 预览' : '切换移动端预览'}
                        title={mobile ? '切换 Web 预览' : '切换移动端预览'}
                        aria-pressed={mobile}
                        onClick={() => setMobile(!mobile)}
                      >
                        {mobile ? (
                          <Smartphone size={14} />
                        ) : (
                          <Monitor size={14} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        aria-label="刷新预览"
                        title="刷新预览"
                        disabled={!shown}
                        onClick={() => setPreviewKey((k) => k + 1)}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="在新标签页打开预览"
                        title="在新标签页打开预览"
                        disabled={!shown}
                        onClick={() => {
                          if (shown)
                            window.open(
                              `/preview/${shown.artifactId}`,
                              '_blank',
                              'noopener,noreferrer',
                            )
                        }}
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="preview-canvas">
                    {shown ? (
                      <TrustedPreview
                        key={`${shown.artifactId}-${previewKey}`}
                        title={`应用预览 v${shown.number}`}
                        className={mobile ? 'phone-frame' : ''}
                        projectId={projectId}
                        artifactId={shown.artifactId}
                      />
                    ) : (
                      <div className="preview-empty">
                        <Box size={34} />
                        <h2>
                          {active ? taskLabel(active) : '预览会出现在这里'}
                        </h2>
                        <p>
                          {active
                            ? '你可以在对话中查看进度，完成后会在这里显示应用。'
                            : '在左侧描述你的想法，或打开源码开始编辑。'}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="preview-status">
                    <span>
                      {shown?.files.some(
                        (file) => file.path === 'src/pixloom-cloud.js',
                      )
                        ? '隔离预览 · 仅连接绑定的开发后端'
                        : '隔离预览 · 无外部网络'}
                    </span>
                    <span>
                      {shown?.files.some(
                        (file) => file.path === 'src/pixloom-cloud.js',
                      )
                        ? '源码预览固定 · 开发数据由各版本共享'
                        : '草稿修改不影响当前预览'}
                    </span>
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
              {tab === 'cloud' && projectId && (
                <WorkspaceCloud
                  key={projectId}
                  projectId={projectId}
                  locked={busy || !!active}
                  workerOnline={ready}
                  onQueued={refresh}
                />
              )}
              {tab === 'publish' && (
                <div className="publication-panel">
                  <h2>应用发布</h2>
                  <p>
                    选择已保存版本上线。草稿修改和版本恢复不会自动改变线上应用。
                  </p>
                  {publication?.live ? (
                    <div className="publication-live">
                      <strong>
                        线上版本 v{publication.live.versionNumber}
                      </strong>
                      <a
                        href={publication.live.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {publication.live.url}
                        <ExternalLink size={14} />
                      </a>
                      <button
                        disabled={busy || !!active || !ready}
                        onClick={async () => {
                          if (
                            await ask(
                              '下线后该项目的所有发布地址将停止提供内容，是否继续？',
                            )
                          )
                            void publish('unpublish')
                        }}
                      >
                        下线应用
                      </button>
                    </div>
                  ) : (
                    <p className="workspace-hint">尚未发布</p>
                  )}
                  {publication && !publication.enabled && (
                    <p className="workspace-hint">{publication.reason}</p>
                  )}
                  {publication?.prefix && publication.domainSuffix && (
                    <form
                      className="publication-domain"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void savePublicationPrefix()
                      }}
                    >
                      <label htmlFor="publication-prefix">域名前缀</label>
                      <div className="publication-domain-controls">
                        <div className="publication-domain-input">
                          <input
                            id="publication-prefix"
                            value={domainPrefix}
                            onChange={(event) =>
                              setPrefixEdit(event.target.value)
                            }
                            disabled={busy || !!active || !publication.enabled}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            maxLength={63}
                            aria-invalid={!!prefixError}
                            aria-describedby="publication-prefix-hint"
                          />
                          <span>.{publication.domainSuffix}</span>
                        </div>
                        <button
                          type="submit"
                          disabled={
                            busy ||
                            !!active ||
                            !publication.enabled ||
                            !prefixChanged ||
                            !!prefixError
                          }
                        >
                          保存前缀
                        </button>
                      </div>
                      <p
                        id="publication-prefix-hint"
                        className={
                          prefixError ? 'publication-domain-error' : ''
                        }
                      >
                        {prefixError ||
                          (publication.live
                            ? '修改后立即使用新地址，原地址停止访问。前缀不能与其他项目重复。'
                            : '默认随机生成，可直接修改后发布。支持字母、数字和连字符，前缀不可重复。')}
                      </p>
                    </form>
                  )}
                  <div className="publication-controls">
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        !!active ||
                        !ready ||
                        !shown ||
                        !publication?.enabled ||
                        !!prefixError ||
                        (publication.live?.versionId === shown.id &&
                          publication.live?.artifactId === shown.artifactId)
                      }
                      onClick={() => void publish('publish')}
                    >
                      <Rocket size={15} />
                      {shown ? `发布 v${shown.number}` : '首次构建成功后可发布'}
                    </button>
                    {shown && <span>仅发布版本快照，不包含草稿修改</span>}
                  </div>
                  <h3>发布记录</h3>
                  {!publication?.releases.length && (
                    <p className="workspace-hint">
                      发布和回滚记录会显示在这里。
                    </p>
                  )}
                  {publication?.releases.map((release) => (
                    <div className="release-item" key={release.id}>
                      <div>
                        <strong>
                          v{release.versionNumber} ·{' '}
                          {release.action === 'rollback'
                            ? '回滚'
                            : release.action === 'unpublish'
                              ? '下线'
                              : '发布'}
                        </strong>
                        <span>
                          {
                            {
                              queued: '排队中',
                              staging: '正在暂存',
                              verifying: '正在验证',
                              published: '发布就绪',
                              unpublished: '已下线',
                              failed: '失败',
                              cancelled: '已取消',
                            }[release.status]
                          }
                          {publication.live?.id === release.id && ' · 当前线上'}
                        </span>
                      </div>
                      <time>{time(release.createdAt)}</time>
                      {release.error && <p role="alert">{release.error}</p>}
                      {release.status === 'published' &&
                        !(
                          publication.live?.versionId === release.versionId &&
                          publication.live?.artifactId === release.artifactId
                        ) && (
                          <button
                            disabled={
                              busy || !!active || !ready || !publication.enabled
                            }
                            onClick={() => void publish('rollback', release.id)}
                          >
                            回滚到此次发布
                          </button>
                        )}
                    </div>
                  ))}
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
                                setHistory(false)
                                await navigate({
                                  ...route,
                                  versionId: null,
                                  tab: 'code',
                                })
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
