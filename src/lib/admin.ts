import { z } from 'zod'
import { db, StoreError } from './store'
import { dailyUsage } from './tenancy'
import type {
  AdminConversation,
  AdminConversationDetail,
  AdminInvitation,
  AdminOverview,
  AdminPage,
  AdminTurn,
  AdminUser,
} from './admin-types'

const pageSchema = z.coerce.number().int().min(1).max(1_000_000).default(1)
export const adminQuerySchema = z
  .object({
    page: pageSchema,
    search: z.string().trim().max(100).default(''),
    userId: z.string().uuid().optional(),
  })
  .strict()
export const invitationSchema = z
  .object({
    label: z.string().trim().max(100).default(''),
    credits: z.number().int().min(1).max(1e12).default(2_000_000),
    days: z.number().int().min(1).max(3650).default(30),
    uses: z.number().int().min(1).max(10000).default(1),
    expiresDays: z.number().int().min(1).max(3650).default(7),
  })
  .strict()
export function adminQuery(request: Request) {
  return adminQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
}
type Query = z.infer<typeof adminQuerySchema>
const pageSize = 25
const usageFields = `COALESCE(sum(CASE WHEN status='settled' THEN credits ELSE 0 END),0) AS spentCredits,
  COALESCE(sum(CASE WHEN status='reserved' THEN creditsReserved ELSE 0 END),0) AS reservedCredits,
  COALESCE(sum(inputTokens),0) AS inputTokens, COALESCE(sum(outputTokens),0) AS outputTokens`
const userUsage = `WITH usage AS (SELECT userId,${usageFields} FROM usage_ledger GROUP BY userId)`
const conversationFrom = `FROM projects p LEFT JOIN users u ON u.id=p.ownerId`
const ownerFields = `p.id,p.name,p.ownerId,u.name AS ownerName,u.email AS ownerEmail`

export function adminOverview(): AdminOverview {
  return {
    ...(db()
      .prepare(
        `SELECT ${usageFields},
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM users WHERE status='pending') AS pendingUsers,
      (SELECT count(*) FROM projects) AS projects,
      (SELECT count(*) FROM tasks WHERE kind='agent') AS turns
      FROM usage_ledger`,
      )
      .get() as Omit<AdminOverview, 'daily'>),
    daily: dailyUsage(),
  }
}
export function adminUsers({ page, search }: Query): AdminPage<AdminUser> {
  const where = `WHERE instr(lower(u.name || ' ' || u.email),lower(?))>0`
  const total = (
    db().prepare(`SELECT count(*) AS n FROM users u ${where}`).get(search) as {
      n: number
    }
  ).n
  const items = db()
    .prepare(
      `${userUsage}
    SELECT u.id,u.name,u.email,u.role,u.status,u.creditLimit,u.accessExpiresAt,u.createdAt,
      COALESCE(g.spentCredits,0) AS spentCredits,COALESCE(g.reservedCredits,0) AS reservedCredits,
      COALESCE(g.inputTokens,0) AS inputTokens,COALESCE(g.outputTokens,0) AS outputTokens,
      MAX(0,u.creditLimit-COALESCE(g.spentCredits,0)-COALESCE(g.reservedCredits,0)) AS remainingCredits,
      (SELECT count(*) FROM projects WHERE ownerId=u.id) AS projects,
      (SELECT count(*) FROM tasks t JOIN projects p ON t.projectId=p.id WHERE p.ownerId=u.id AND t.kind='agent') AS turns
    FROM users u LEFT JOIN usage g ON g.userId=u.id ${where}
    ORDER BY spentCredits+reservedCredits DESC,u.createdAt DESC,u.id LIMIT ? OFFSET ?`,
    )
    .all(search, pageSize, (page - 1) * pageSize) as AdminUser[]
  return { items, total, page, pageSize }
}
export function adminInvitations({ page }: Query): AdminPage<AdminInvitation> {
  const total = (
    db().prepare('SELECT count(*) AS n FROM invitations').get() as { n: number }
  ).n
  const items = db()
    .prepare(
      `SELECT id,label,creditLimit,accessDays,maxUses,uses,expiresAt,disabled,createdAt
    FROM invitations ORDER BY createdAt DESC,rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(pageSize, (page - 1) * pageSize) as AdminInvitation[]
  return { items, total, page, pageSize }
}
export function disableAdminInvitation(id: string) {
  z.string().uuid().parse(id)
  if (
    !db().prepare('UPDATE invitations SET disabled=1 WHERE id=?').run(id)
      .changes
  )
    throw new StoreError('邀请码不存在', 404)
  return { ok: true }
}
export function adminConversations({
  page,
  search,
  userId,
}: Query): AdminPage<AdminConversation> {
  const where = `WHERE EXISTS (SELECT 1 FROM tasks WHERE projectId=p.id AND kind='agent')
    AND (? IS NULL OR p.ownerId=?) AND instr(lower(p.name || ' ' || COALESCE(u.name,'') || ' ' || COALESCE(u.email,'')),lower(?))>0`
  const args = [userId || null, userId || null, search]
  const total = (
    db()
      .prepare(`SELECT count(*) AS n ${conversationFrom} ${where}`)
      .get(...args) as { n: number }
  ).n
  const items = db()
    .prepare(
      `SELECT ${ownerFields},
    (SELECT count(*) FROM tasks WHERE projectId=p.id AND kind='agent') AS turns,
    (SELECT max(createdAt) FROM tasks WHERE projectId=p.id AND kind='agent') AS lastMessageAt
    ${conversationFrom} ${where} ORDER BY lastMessageAt DESC,p.id LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize) as AdminConversation[]
  return { items, total, page, pageSize }
}
export function adminConversation(
  id: string,
  { page }: Query,
): AdminConversationDetail {
  z.string().uuid().parse(id)
  const project = db()
    .prepare(`SELECT ${ownerFields} ${conversationFrom} WHERE p.id=?`)
    .get(id) as AdminConversationDetail['project'] | undefined
  if (!project) throw new StoreError('项目不存在', 404)
  const total = (
    db()
      .prepare(
        "SELECT count(*) AS n FROM tasks WHERE projectId=? AND kind='agent'",
      )
      .get(id) as { n: number }
  ).n
  // Fetch conversational fields only; source snapshots, credentials and tool logs stay out of this response.
  const rows = db()
    .prepare(
      `WITH usage AS (SELECT taskId,${usageFields} FROM usage_ledger GROUP BY taskId)
    SELECT t.id,t.status,t.summary,t.error,t.createdAt,
      json_extract(t.agent,'$.prompt') AS prompt,json_extract(t.agent,'$.provider') AS provider,json_extract(t.agent,'$.model') AS model,
      (SELECT json_group_array(json_object('at',json_extract(value,'$.at'),'message',json_extract(value,'$.message')))
       FROM json_each(t.events) WHERE json_extract(value,'$.type')='reply') AS replies,
      COALESCE(g.spentCredits,0) AS spentCredits,COALESCE(g.reservedCredits,0) AS reservedCredits,
      COALESCE(g.inputTokens,0) AS inputTokens,COALESCE(g.outputTokens,0) AS outputTokens
    FROM tasks t LEFT JOIN usage g ON g.taskId=t.id WHERE t.projectId=? AND t.kind='agent'
    ORDER BY t.rowid LIMIT ? OFFSET ?`,
    )
    .all(id, pageSize, (page - 1) * pageSize) as (Omit<AdminTurn, 'replies'> & {
    replies: string
  })[]
  return {
    project,
    items: rows.map((row) => ({ ...row, replies: JSON.parse(row.replies) })),
    total,
    page,
    pageSize,
  }
}
