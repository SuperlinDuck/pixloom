import { StoreError } from '../store'
import { workspaceOrigin } from '../workspace-origin'
import { sharedConfigured } from './shared-config'

export function encryptionKey() {
  const value = process.env.PIXLOOM_CLOUD_ENCRYPTION_KEY || ''
  if (!/^[a-fA-F0-9]{64}$/.test(value))
    throw new StoreError(
      '请配置 64 位十六进制 PIXLOOM_CLOUD_ENCRYPTION_KEY',
      503,
    )
  return Buffer.from(value, 'hex')
}
export function managedConfig() {
  const token = process.env.PIXLOOM_SUPABASE_ACCESS_TOKEN?.trim()
  const organization = process.env.PIXLOOM_SUPABASE_ORGANIZATION?.trim()
  const region = process.env.PIXLOOM_SUPABASE_REGION || 'apac'
  const maxProjects = Number(process.env.PIXLOOM_CLOUD_MAX_PROJECTS || 6)
  encryptionKey()
  if (
    !token ||
    !organization ||
    !/^[a-zA-Z0-9_-]+$/.test(organization) ||
    !['americas', 'emea', 'apac'].includes(region) ||
    !Number.isSafeInteger(maxProjects) ||
    maxProjects < 2 ||
    maxProjects > 1000
  )
    throw new StoreError(
      'Pixloom Cloud 尚未配置，请检查平台管理凭证、组织、地区和资源上限',
      503,
    )
  return { token, organization, region, maxProjects }
}
export function oauthConfig() {
  encryptionKey()
  const clientId = process.env.PIXLOOM_SUPABASE_CLIENT_ID?.trim()
  const clientSecret = process.env.PIXLOOM_SUPABASE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret)
    throw new StoreError('Supabase OAuth 尚未配置', 503)
  return {
    clientId,
    clientSecret,
    redirectUri: `${workspaceOrigin()}/api/cloud/supabase/callback`,
  }
}
export function configured(kind: 'managed' | 'oauth') {
  try {
    if (
      kind === 'managed' &&
      process.env.PIXLOOM_CLOUD_LEGACY_PROVISIONING !== '1'
    )
      return sharedConfigured()
    kind === 'managed' ? managedConfig() : oauthConfig()
    return true
  } catch {
    return false
  }
}
export const SUPABASE_API = 'https://api.supabase.com'
export function projectRef(value: string) {
  if (!/^[a-z]{20}$/.test(value)) throw new StoreError('Supabase 项目标识无效')
  return value
}
export function projectOrigin(ref: string) {
  return `https://${projectRef(ref)}.supabase.co`
}
