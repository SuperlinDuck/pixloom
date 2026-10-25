export type CloudMode = 'managed' | 'external'
export type CloudEnvironment = 'development' | 'production'
export type CloudPublicConfig = {
  ref: string
  url: string
  publishableKey: string
}
export type LegacyCloudManifest = {
  format: 'pixloom-cloud-v1'
  projectId: string
  mode: CloudMode
  environment: CloudEnvironment
  development: CloudPublicConfig
  production: CloudPublicConfig
  buckets: Record<string, string>
  functions: Record<string, string>
}
export type SharedCloudManifest = {
  format: 'pixloom-cloud-v2'
  authMode?: 'persistent-v1'
  projectId: string
  mode: 'managed'
  environment: CloudEnvironment
  environmentId: string
  generation: string
  endpoint: string
  capabilities: ('auth' | 'database' | 'storage')[]
}
export type CloudManifest = LegacyCloudManifest | SharedCloudManifest
export type CloudResource = {
  projectId: string
  environment: CloudEnvironment
  ref: string | null
  name: string
  status: 'reserved' | 'creating' | 'pending' | 'ready' | 'uncertain'
  publishableKey: string | null
  password: string | null
}
export type CloudBinding = {
  projectId: string
  mode: CloudMode
  status: 'provisioning' | 'ready' | 'error'
  error: string | null
  connectionId: string | null
}
export type CloudStatus = {
  provider?: 'shared' | 'legacy' | 'external'
  productionConfigured?: boolean
  limits?: {
    maxApps: number
    maxRows: number
    maxBytes: number
    maxFileBytes: number
  }
  mode: CloudMode
  status: 'disabled' | CloudBinding['status']
  error: string | null
  managedConfigured: boolean
  oauthConfigured: boolean
  cleanupPending: number
  connected: boolean
  resources: {
    environment: CloudEnvironment
    ref: string | null
    status: string
  }[]
}
export type SupabaseProject = {
  id: string
  name: string
  organization_id: string
  region?: string
  status?: string
}
