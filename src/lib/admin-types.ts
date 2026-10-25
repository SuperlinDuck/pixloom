import type { TaskStatus } from './types'

export type AdminPage<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export type AdminUsage = {
  spentCredits: number
  reservedCredits: number
  inputTokens: number
  outputTokens: number
}
export type AdminOverview = AdminUsage & {
  users: number
  pendingUsers: number
  projects: number
  turns: number
  daily: { day: string; used: number; limit: number }
}
export type AdminUser = AdminUsage & {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  status: 'pending' | 'active' | 'disabled'
  creditLimit: number
  remainingCredits: number
  accessExpiresAt: number | null
  createdAt: number
  projects: number
  turns: number
}
export type AdminInvitation = {
  id: string
  label: string
  creditLimit: number
  accessDays: number
  maxUses: number
  uses: number
  expiresAt: number
  disabled: number
  createdAt: number
}
export type AdminConversation = {
  id: string
  name: string
  ownerId: string | null
  ownerName: string | null
  ownerEmail: string | null
  turns: number
  lastMessageAt: string
}
export type AdminTurn = AdminUsage & {
  id: string
  prompt: string | null
  provider: string | null
  model: string | null
  status: TaskStatus
  summary: string
  replies: { at: string; message: string }[]
  error: string | null
  createdAt: string
}
export type AdminConversationDetail = AdminPage<AdminTurn> & {
  project: Omit<AdminConversation, 'turns' | 'lastMessageAt'>
}
