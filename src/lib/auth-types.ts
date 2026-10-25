export type AccountUser = {
  id: string
  role: 'admin' | 'user'
  status: 'pending' | 'active' | 'disabled'
  accessExpiresAt: number | null
  name: string
  email: string
  picture: string | null
}

export type AccountSession = {
  configured: boolean
  required: boolean
  user: AccountUser | null
  usage?: {
    usedCredits: number
    reservedCredits: number
    creditLimit: number
    remainingCredits: number
    inputTokens: number
    outputTokens: number
    accessExpiresAt: number | null
  }
}
