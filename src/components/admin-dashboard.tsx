'use client'

import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  Gift,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type {
  AdminConversation,
  AdminConversationDetail,
  AdminInvitation,
  AdminOverview,
  AdminPage,
  AdminUser,
} from '@/lib/admin-types'
import { MarkdownReply } from './markdown-reply'
import styles from './admin-dashboard.module.css'

const number = (value: number) =>
  value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const points = (units: number) =>
  units > 0 && units < 10 ? '<0.01' : number(units / 1000)
const date = (value: number | string | null) =>
  value === null
    ? '不限期'
    : new Date(value).toLocaleString('zh-CN', { hour12: false })
const statuses: Record<string, string> = {
  pending: '待激活',
  active: '已激活',
  disabled: '已停用',
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '加载失败，请重试')
  return data
}
function useResource<T>(url: string, revision: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    api<T>(url, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError((error as Error).message)
      })
    return () => controller.abort()
  }, [url, revision, retry])
  return { data, error, reload: () => setRetry((value) => value + 1) }
}
function Loading() {
  return (
    <p className={styles.loading} role="status">
      <Loader2 size={17} className="spin" />
      正在加载…
    </p>
  )
}
function Failure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className={styles.error} role="alert">
      {message}
      <button onClick={retry}>重试</button>
    </div>
  )
}
function Pager({
  data,
  onChange,
}: {
  data: { total: number; page: number; pageSize: number }
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  return (
    <div className={styles.pager}>
      <span>
        共 {number(data.total)} 条 · 第 {data.page} / {pages} 页
      </span>
      <div>
        <button
          disabled={data.page <= 1}
          onClick={() => onChange(data.page - 1)}
        >
          上一页
        </button>
        <button
          disabled={data.page >= pages}
          onClick={() => onChange(data.page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  )
}
function SearchForm({
  onSearch,
  placeholder,
}: {
  onSearch: (value: string) => void
  placeholder: string
}) {
  const [value, setValue] = useState('')
  return (
    <form
      className={styles.search}
      onSubmit={(event) => {
        event.preventDefault()
        onSearch(value.trim())
      }}
    >
      <Search size={17} aria-hidden="true" />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        maxLength={100}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit">搜索</button>
    </form>
  )
}

export function AdminDashboard() {
  const [tab, setTab] = useState<'invitations' | 'users' | 'conversations'>(
    'invitations',
  )
  const [revision, setRevision] = useState(0)
  const [userFilter, setUserFilter] = useState<{
    id: string
    name: string
  } | null>(null)
  const overview = useResource<AdminOverview>('/api/admin', revision)
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <a href="/" className={styles.back}>
            <ArrowLeft size={16} />
            返回工作台
          </a>
          <h1>
            <ShieldCheck size={25} />
            管理后台
          </h1>
          <p>管理内测邀请、查看用户用量与项目对话。</p>
        </div>
        <button
          className={styles.secondary}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={15} />
          刷新数据
        </button>
      </header>
      {overview.error ? (
        <Failure message={overview.error} retry={overview.reload} />
      ) : overview.data ? (
        <>
          <section className={styles.stats} aria-label="平台概况">
            <div>
              <span>注册用户</span>
              <strong>{number(overview.data.users)}</strong>
              <small>{overview.data.pendingUsers} 位待激活</small>
            </div>
            <div>
              <span>项目 / 对话轮数</span>
              <strong>
                {number(overview.data.projects)}{' '}
                <i>/ {number(overview.data.turns)}</i>
              </strong>
              <small>所有用户累计</small>
            </div>
            <div>
              <span>累计消耗积分</span>
              <strong>{points(overview.data.spentCredits)}</strong>
              <small>
                另有 {points(overview.data.reservedCredits)} 积分预留中
              </small>
            </div>
            <div>
              <span>今日额度占用</span>
              <strong>
                {points(overview.data.daily.used)}{' '}
                <i>/ {points(overview.data.daily.limit)}</i>
              </strong>
              <small>含预留 · UTC {overview.data.daily.day}</small>
            </div>
          </section>
          <p className={styles.note}>
            1 积分 = 1,000 额度单位。预留占用余额，尚未结算；Token
            数仅统计已确认用量。积分不代表货币金额。
          </p>
        </>
      ) : (
        <Loading />
      )}
      <nav className={styles.tabs} aria-label="管理功能">
        {(
          [
            { id: 'invitations', label: '邀请码', Icon: Gift },
            { id: 'users', label: '用户用量', Icon: Users },
            { id: 'conversations', label: '对话记录', Icon: MessageSquare },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      {tab === 'invitations' && <Invitations revision={revision} />}
      {tab === 'users' && (
        <UsersPanel
          revision={revision}
          onConversations={(user) => {
            setUserFilter({ id: user.id, name: user.email })
            setTab('conversations')
          }}
        />
      )}
      {tab === 'conversations' && (
        <Conversations
          key={userFilter?.id || 'all'}
          revision={revision}
          userFilter={userFilter}
          clearFilter={() => setUserFilter(null)}
        />
      )}
    </main>
  )
}

function Invitations({ revision }: { revision: number }) {
  const [page, setPage] = useState(1)
  const [generation, setGeneration] = useState(0)
  const resource = useResource<AdminPage<AdminInvitation>>(
    `/api/admin/invitations?page=${page}`,
    revision + generation,
  )
  const [pending, setPending] = useState(false)
  const [disabling, setDisabling] = useState('')
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  async function create(form: HTMLFormElement) {
    const fields = new FormData(form)
    setPending(true)
    setError('')
    setCopied(false)
    try {
      const result = await api<{ code: string }>('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: String(fields.get('label')),
          credits: Math.round(Number(fields.get('points')) * 1000),
          days: Number(fields.get('days')),
          uses: Number(fields.get('uses')),
          expiresDays: Number(fields.get('expiresDays')),
        }),
      })
      setCode(result.code)
      setPage(1)
      setGeneration((value) => value + 1)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setPending(false)
    }
  }
  async function disable(id: string) {
    setDisabling(id)
    setError('')
    try {
      await api(`/api/admin/invitations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      })
      setGeneration((value) => value + 1)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setDisabling('')
    }
  }
  return (
    <section className={styles.panel}>
      <h2>生成邀请码</h2>
      <p className={styles.subtitle}>
        为受邀用户设置积分和体验期限，生成后复制发给对方。
      </p>
      <form
        className={styles.inviteForm}
        onSubmit={(event) => {
          event.preventDefault()
          void create(event.currentTarget)
        }}
      >
        <label>
          备注
          <input name="label" placeholder="例如：首批内测" maxLength={100} />
        </label>
        <label>
          赠送积分
          <input
            name="points"
            type="number"
            min="0.001"
            max="1000000000"
            step="0.001"
            defaultValue="2000"
            required
          />
        </label>
        <label>
          体验天数
          <input
            name="days"
            type="number"
            min="1"
            max="3650"
            defaultValue="30"
            required
          />
        </label>
        <label>
          可兑换人数
          <input
            name="uses"
            type="number"
            min="1"
            max="10000"
            defaultValue="1"
            required
          />
        </label>
        <label>
          兑换有效期（天）
          <input
            name="expiresDays"
            type="number"
            min="1"
            max="3650"
            defaultValue="7"
            required
          />
        </label>
        <button className="primary-button" disabled={pending}>
          {pending ? '正在生成…' : '生成邀请码'}
        </button>
      </form>
      {code && (
        <div className={styles.newCode} role="status">
          <div>
            <strong>邀请码已生成，请立即保存</strong>
            <p>
              明文仅在本次生成后显示，离开页面后无法找回。用户 Google
              登录后在侧边栏兑换。
            </p>
          </div>
          <div className={styles.copyRow}>
            <input
              aria-label="新生成的邀请码"
              value={code}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button
              className={styles.secondary}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code)
                  setCopied(true)
                } catch {
                  setError('复制失败，请选中邀请码手动复制。')
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <h2 className={styles.sectionTitle}>邀请记录</h2>
      {resource.error ? (
        <Failure message={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <Loading />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>备注 / 创建时间</th>
                  <th>赠送积分</th>
                  <th>体验天数</th>
                  <th>兑换人数</th>
                  <th>兑换截止时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((invite) => {
                  const state = invite.disabled
                    ? '已禁用'
                    : invite.uses >= invite.maxUses
                      ? '已用完'
                      : invite.expiresAt <= Date.now()
                        ? '已过期'
                        : '可兑换'
                  return (
                    <tr key={invite.id}>
                      <td>
                        <strong>{invite.label || '未备注'}</strong>
                        <small>{date(invite.createdAt)}</small>
                      </td>
                      <td>{points(invite.creditLimit)}</td>
                      <td>{invite.accessDays} 天</td>
                      <td>
                        {invite.uses} / {invite.maxUses}
                      </td>
                      <td>{date(invite.expiresAt)}</td>
                      <td>
                        <span className={styles.badge}>{state}</span>
                      </td>
                      <td>
                        <button
                          className={styles.textButton}
                          disabled={state !== '可兑换' || !!disabling}
                          onClick={() => void disable(invite.id)}
                        >
                          {disabling === invite.id ? '处理中…' : '禁用'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {!resource.data.items.length && (
                  <tr>
                    <td colSpan={7} className={styles.empty}>
                      还没有邀请码。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager data={resource.data} onChange={setPage} />
        </>
      )}
    </section>
  )
}

function UsersPanel({
  revision,
  onConversations,
}: {
  revision: number
  onConversations: (user: AdminUser) => void
}) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const resource = useResource<AdminPage<AdminUser>>(
    `/api/admin/users?page=${page}&search=${encodeURIComponent(search)}`,
    revision,
  )
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>用户用量</h2>
          <p className={styles.subtitle}>
            按消耗与预留总量排序，包含管理员和待激活用户。
          </p>
        </div>
        <SearchForm
          placeholder="搜索用户姓名或邮箱"
          onSearch={(value) => {
            setSearch(value)
            setPage(1)
          }}
        />
      </div>
      {resource.error ? (
        <Failure message={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <Loading />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>状态 / 到期时间</th>
                  <th>已消耗积分</th>
                  <th>预留积分</th>
                  <th>剩余 / 总积分</th>
                  <th>输入 / 输出 Tokens</th>
                  <th>项目 / 对话轮数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>
                        {user.name}{' '}
                        {user.role === 'admin' && (
                          <span className={styles.badge}>管理员</span>
                        )}
                      </strong>
                      <small>{user.email}</small>
                    </td>
                    <td>
                      <span className={styles.badge}>
                        {user.status === 'active' &&
                        user.accessExpiresAt !== null &&
                        user.accessExpiresAt <= Date.now()
                          ? '已到期'
                          : statuses[user.status]}
                      </span>
                      <small>
                        {user.status === 'pending'
                          ? '等待兑换邀请码'
                          : date(user.accessExpiresAt)}
                      </small>
                    </td>
                    <td>{points(user.spentCredits)}</td>
                    <td>{points(user.reservedCredits)}</td>
                    <td>
                      {points(user.remainingCredits)}
                      <small>总计 {points(user.creditLimit)}</small>
                    </td>
                    <td>
                      {number(user.inputTokens)}
                      <small>输出 {number(user.outputTokens)}</small>
                    </td>
                    <td>
                      {user.projects} / {user.turns}
                    </td>
                    <td>
                      <button
                        className={styles.textButton}
                        onClick={() => onConversations(user)}
                      >
                        查看对话
                      </button>
                    </td>
                  </tr>
                ))}
                {!resource.data.items.length && (
                  <tr>
                    <td colSpan={8} className={styles.empty}>
                      没有匹配的用户。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager data={resource.data} onChange={setPage} />
        </>
      )}
    </section>
  )
}

function Conversations({
  revision,
  userFilter,
  clearFilter,
}: {
  revision: number
  userFilter: { id: string; name: string } | null
  clearFilter: () => void
}) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const resource = useResource<AdminPage<AdminConversation>>(
    `/api/admin/conversations?page=${page}&search=${encodeURIComponent(search)}${userFilter ? `&userId=${userFilter.id}` : ''}`,
    revision,
  )
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>对话记录</h2>
          <p className={styles.subtitle}>
            按项目查看用户需求、助手回复、任务状态和用量。
          </p>
        </div>
        <SearchForm
          placeholder="搜索项目、用户或邮箱"
          onSearch={(value) => {
            setSearch(value)
            setPage(1)
            setSelected(null)
          }}
        />
      </div>
      {userFilter && (
        <p className={styles.filter}>
          当前用户：{userFilter.name}
          <button className={styles.textButton} onClick={clearFilter}>
            查看所有用户
          </button>
        </p>
      )}
      <div className={styles.conversations}>
        <div className={styles.projectList} aria-label="项目对话列表">
          {resource.error ? (
            <Failure message={resource.error} retry={resource.reload} />
          ) : !resource.data ? (
            <Loading />
          ) : (
            <>
              {resource.data.items.map((project) => (
                <button
                  className={styles.project}
                  aria-pressed={selected === project.id}
                  key={project.id}
                  onClick={() => setSelected(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{project.ownerEmail || '本地项目'}</span>
                  <small>
                    {project.turns} 轮对话 · {date(project.lastMessageAt)}
                  </small>
                </button>
              ))}
              {!resource.data.items.length && (
                <p className={styles.empty}>没有匹配的对话记录。</p>
              )}
              <Pager data={resource.data} onChange={setPage} />
            </>
          )}
        </div>
        {selected ? (
          <Conversation key={selected} id={selected} revision={revision} />
        ) : (
          <div className={styles.conversationEmpty}>
            <MessageSquare size={30} />
            <p>选择一个项目查看对话</p>
          </div>
        )}
      </div>
    </section>
  )
}
function Conversation({ id, revision }: { id: string; revision: number }) {
  const [page, setPage] = useState(1)
  const resource = useResource<AdminConversationDetail>(
    `/api/admin/conversations/${id}?page=${page}`,
    revision,
  )
  if (resource.error)
    return <Failure message={resource.error} retry={resource.reload} />
  if (!resource.data) return <Loading />
  const { project, items } = resource.data
  return (
    <div className={styles.transcript}>
      <header>
        <h3>{project.name}</h3>
        <p>
          {project.ownerName || '本地用户'} · {project.ownerEmail || '无邮箱'}
        </p>
      </header>
      <Pager data={resource.data} onChange={setPage} />
      {items.map((turn) => (
        <article key={turn.id} className={styles.turn}>
          <div className={styles.turnMeta}>
            <span>{date(turn.createdAt)}</span>
            <span className={styles.badge}>
              {statuses[turn.status] || turn.status}
            </span>
          </div>
          <div className={styles.prompt}>
            <strong>用户</strong>
            <p>{turn.prompt || turn.summary || '未保存用户输入'}</p>
          </div>
          <div className={styles.reply}>
            <strong>Pixloom</strong>
            {turn.replies.length ? (
              turn.replies.map((reply, index) => (
                <MarkdownReply key={index}>{reply.message}</MarkdownReply>
              ))
            ) : (
              <p className={styles.subtitle}>
                {['queued', 'running'].includes(turn.status)
                  ? '任务尚未结束，暂未生成回复。'
                  : '未保存助手回复。'}
              </p>
            )}
            {turn.error && <p className={styles.error}>{turn.error}</p>}
          </div>
          <footer>
            {turn.provider} / {turn.model || '未知模型'} · 输入{' '}
            {number(turn.inputTokens)} / 输出 {number(turn.outputTokens)} Tokens
            · 消耗 {points(turn.spentCredits)} 积分
            {turn.reservedCredits > 0 &&
              ` · 预留 ${points(turn.reservedCredits)} 积分`}
          </footer>
        </article>
      ))}
      {!items.length && <p className={styles.empty}>该项目没有对话记录。</p>}
      <Pager data={resource.data} onChange={setPage} />
    </div>
  )
}
