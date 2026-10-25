import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { statfsSync } from 'node:fs'
import { db, StoreError, transaction } from './store'
import { limit } from './platform-config'
import type { TaskKind } from './types'

export type PlatformUser = {
  id: string
  subject: string
  name: string
  email: string
  picture: string | null
  role: 'admin' | 'user'
  status: 'pending' | 'active' | 'disabled'
  creditLimit: number
  accessExpiresAt: number | null
  createdAt: number
}
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export function userById(id: string) {
  const row = db().prepare('SELECT * FROM users WHERE id=?').get(id) as
    PlatformUser | undefined
  if (!row) throw new StoreError('用户不存在', 404)
  return row
}
export function assertActive(user: PlatformUser) {
  if (user.status === 'disabled')
    throw new StoreError('账号已停用，请联系管理员', 403)
  if (user.status !== 'active') throw new StoreError('请先兑换邀请码', 403)
  if (user.accessExpiresAt !== null && user.accessExpiresAt <= Date.now())
    throw new StoreError('体验已到期，请联系管理员', 403)
}
export function ownerOf(projectId: string): string | undefined {
  const row = db()
    .prepare('SELECT ownerId FROM projects WHERE id=?')
    .get(projectId) as { ownerId: string | null } | undefined
  return row?.ownerId || undefined
}
// Caller owns a transaction. Fixed windows are persisted across restarts.
export function takeRate(key: string, maximum: number, windowMs = 60000) {
  const window = Math.floor(Date.now() / windowMs)
  db()
    .prepare('DELETE FROM platform_rates WHERE window<? AND key LIKE ?')
    .run(window - 2, `${key.split(':')[0]}:%`)
  const row = db()
    .prepare('SELECT count,window FROM platform_rates WHERE key=?')
    .get(key) as { count: number; window: number } | undefined
  if (row?.window === window && row.count >= maximum)
    throw new StoreError('请求过于频繁，请稍后重试', 429)
  db()
    .prepare(
      `INSERT INTO platform_rates VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN platform_rates.window=excluded.window THEN platform_rates.count+1 ELSE 1 END`,
    )
    .run(key, window)
}
export function assertProjectCapacity(ownerId?: string) {
  if (!ownerId) return
  assertActive(userById(ownerId))
  const total = (
    db().prepare('SELECT count(*) AS n FROM projects').get() as { n: number }
  ).n
  if (total >= limit('PIXLOOM_MAX_PROJECTS', 300))
    throw new StoreError('平台项目数量已达上限', 429)
  const count = (
    db()
      .prepare('SELECT count(*) AS n FROM projects WHERE ownerId=?')
      .get(ownerId) as { n: number }
  ).n
  if (count >= limit('PIXLOOM_MAX_PROJECTS_PER_USER', 10))
    throw new StoreError('项目数量已达上限，请联系管理员', 429)
}
export function assertTaskCapacity(projectId: string, kind: TaskKind) {
  if (['stop', 'remove', 'unpublish'].includes(kind)) return
  const ownerId = ownerOf(projectId)
  if (!ownerId) return
  assertActive(userById(ownerId))
  if (kind === 'agent') assertAiAvailable(ownerId)
  const active = (
    db()
      .prepare(
        `SELECT count(*) AS n FROM tasks JOIN projects ON projects.id=tasks.projectId WHERE projects.ownerId=? AND tasks.status IN ('queued','running')`,
      )
      .get(ownerId) as { n: number }
  ).n
  if (active >= limit('PIXLOOM_MAX_ACTIVE_TASKS_PER_USER', 2))
    throw new StoreError('请先等待已有任务完成', 429)
  const queued = (
    db()
      .prepare(
        "SELECT count(*) AS n FROM tasks WHERE status IN ('queued','running')",
      )
      .get() as { n: number }
  ).n
  if (queued >= limit('PIXLOOM_MAX_QUEUED_TASKS', 30))
    throw new StoreError('服务繁忙，任务队列已满，请稍后重试', 429)
  takeRate(`task:${ownerId}`, limit('PIXLOOM_TASKS_PER_HOUR', 30), 3600000)
}
export function assertUserStorage(projectId: string) {
  const total = (
    db()
      .prepare(
        `SELECT
    COALESCE((SELECT sum(octet_length(files)) FROM workspace_drafts),0)+
    COALESCE((SELECT sum(octet_length(files)) FROM versions),0)+
    COALESCE((SELECT sum(octet_length(files)) FROM draft_backups),0)+
    COALESCE((SELECT sum(octet_length(candidateFiles)+octet_length(events)) FROM tasks),0)+
    COALESCE((SELECT sum(bytes)*2 FROM preview_artifacts),0) AS n`,
      )
      .get() as { n: number }
  ).n
  if (total > limit('PIXLOOM_TOTAL_STORAGE_BYTES', 10 * 1024 ** 3))
    throw new StoreError('平台存储已达上限，请联系管理员', 413)
  const disk = statfsSync(process.env.PIXLOOM_DATA_DIR || '.pixloom')
  if (
    disk.bavail * disk.bsize <
    limit('PIXLOOM_MIN_FREE_DISK_BYTES', 512 * 1024 ** 2)
  )
    throw new StoreError('磁盘可用空间不足，请联系管理员', 503)
  const ownerId = ownerOf(projectId)
  if (!ownerId) return
  const used = (
    db()
      .prepare(
        `SELECT
    COALESCE((SELECT sum(octet_length(files)) FROM workspace_drafts d JOIN projects p ON p.id=d.projectId WHERE p.ownerId=?),0)+
    COALESCE((SELECT sum(octet_length(files)) FROM versions v JOIN projects p ON p.id=v.projectId WHERE p.ownerId=?),0)+
    COALESCE((SELECT sum(octet_length(files)) FROM draft_backups b JOIN projects p ON p.id=b.projectId WHERE p.ownerId=?),0)+
    COALESCE((SELECT sum(octet_length(candidateFiles)+octet_length(events)) FROM tasks t JOIN projects p ON p.id=t.projectId WHERE p.ownerId=?),0)+
    COALESCE((SELECT sum(bytes) FROM preview_artifacts a JOIN projects p ON p.id=a.projectId WHERE p.ownerId=?),0) AS n`,
      )
      .get(ownerId, ownerId, ownerId, ownerId, ownerId) as { n: number }
  ).n
  if (used > limit('PIXLOOM_USER_STORAGE_BYTES', 512 * 1024 * 1024))
    throw new StoreError('账号存储已达上限，请联系管理员', 413)
}
export function usageSummary(userId: string) {
  const row = db()
    .prepare(
      `SELECT COALESCE(sum(COALESCE(credits,creditsReserved)),0) AS usedCredits,
    COALESCE(sum(inputTokens),0) AS inputTokens, COALESCE(sum(outputTokens),0) AS outputTokens,
    COALESCE(sum(CASE WHEN status='reserved' THEN creditsReserved ELSE 0 END),0) AS reservedCredits
    FROM usage_ledger WHERE userId=?`,
    )
    .get(userId) as {
    usedCredits: number
    inputTokens: number
    outputTokens: number
    reservedCredits: number
  }
  const user = userById(userId)
  return {
    ...row,
    creditLimit: user.creditLimit,
    remainingCredits: Math.max(0, user.creditLimit - row.usedCredits),
    accessExpiresAt: user.accessExpiresAt,
  }
}
export function dailyUsage() {
  const day = new Date().toISOString().slice(0, 10)
  const used = (
    db()
      .prepare(
        'SELECT COALESCE(sum(COALESCE(credits,creditsReserved)),0) AS n FROM usage_ledger WHERE day=?',
      )
      .get(day) as { n: number }
  ).n
  return { day, used, limit: limit('PIXLOOM_DAILY_CREDITS', 20_000_000) }
}
export function assertAiAvailable(userId?: string) {
  if (
    process.env.PIXLOOM_AI_ENABLED === '0' ||
    (
      db()
        .prepare("SELECT value FROM platform_settings WHERE key='ai_enabled'")
        .get() as { value: string } | undefined
    )?.value === '0'
  )
    throw new StoreError('AI 服务已暂停，请稍后重试', 503)
  if (userId) {
    assertActive(userById(userId))
    if (!usageSummary(userId).remainingCredits)
      throw new StoreError('体验额度已用尽，已有项目仍可查看和导出', 429)
  }
  const daily = dailyUsage()
  if (daily.used >= daily.limit)
    throw new StoreError('平台今日 AI 额度已用尽，请稍后重试', 429)
}
export function createInvitation(
  options: {
    label?: string
    credits?: number
    days?: number
    uses?: number
    expiresDays?: number
  } = {},
) {
  const values = {
    credits: options.credits ?? 2_000_000,
    days: options.days ?? 30,
    uses: options.uses ?? 1,
    expiresDays: options.expiresDays ?? 7,
  }
  for (const [key, value] of Object.entries(values))
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > (key === 'credits' ? 1e12 : key === 'uses' ? 10000 : 3650)
    )
      throw new StoreError('邀请码参数无效')
  const code = randomBytes(24).toString('base64url')
  const id = randomUUID()
  db()
    .prepare(
      'INSERT INTO invitations (id,codeHash,label,creditLimit,accessDays,maxUses,expiresAt,createdAt) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      digest(code),
      (options.label || '').slice(0, 100),
      values.credits,
      values.days,
      values.uses,
      Date.now() + values.expiresDays * 86400000,
      Date.now(),
    )
  return { id, code, ...values }
}
export function redeemInvitation(userId: string, code: string) {
  // Failed attempts are counted outside the redemption transaction (rollback must not reset the rate).
  transaction(() => takeRate(`invite:${userId}`, 5))
  if (!/^[A-Za-z0-9_-]{32}$/.test(code))
    throw new StoreError('邀请码无效或已失效', 400)
  return transaction(() => {
    const user = userById(userId)
    if (user.status === 'disabled') throw new StoreError('账号已停用', 403)
    if (
      user.status !== 'pending' ||
      db()
        .prepare('SELECT 1 FROM invitation_redemptions WHERE userId=?')
        .get(userId)
    )
      throw new StoreError('此账号已激活，无需重复兑换', 409)
    const invite = db()
      .prepare(
        'SELECT * FROM invitations WHERE codeHash=? AND disabled=0 AND expiresAt>? AND uses<maxUses',
      )
      .get(digest(code), Date.now()) as
      { id: string; creditLimit: number; accessDays: number } | undefined
    if (!invite) throw new StoreError('邀请码无效或已失效', 400)
    db().prepare('UPDATE invitations SET uses=uses+1 WHERE id=?').run(invite.id)
    db()
      .prepare('INSERT INTO invitation_redemptions VALUES (?,?,?)')
      .run(userId, invite.id, Date.now())
    db()
      .prepare(
        "UPDATE users SET status='active',creditLimit=?,accessExpiresAt=? WHERE id=?",
      )
      .run(
        invite.creditLimit,
        Date.now() + invite.accessDays * 86400000,
        userId,
      )
    return usageSummary(userId)
  })
}
