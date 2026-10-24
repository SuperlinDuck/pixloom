export type AccountUser = {
  name: string
  email: string
  picture: string | null
}

export type AccountSession = {
  configured: boolean
  required: boolean
  user: AccountUser | null
}
