export function limit(
  name: string,
  fallback: number,
  min = 1,
  max = 1_000_000_000_000,
) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} 必须为 ${min}–${max} 的整数`)
  return value
}
export const adminEmails = () =>
  (process.env.PIXLOOM_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return
  if (
    !process.env.PIXLOOM_GOOGLE_CLIENT_ID?.trim() ||
    !process.env.PIXLOOM_GOOGLE_CLIENT_SECRET?.trim()
  )
    throw new Error('生产环境必须配置 Google 登录')
  const url = new URL(process.env.PIXLOOM_AUTH_URL || '')
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('生产环境 PIXLOOM_AUTH_URL 必须为 HTTPS 来源')
  if (!adminEmails().length)
    throw new Error('生产环境必须配置 PIXLOOM_ADMIN_EMAILS')
  for (const name of ['PIXLOOM_DATA_DIR', 'PIXLOOM_PUBLISH_DIR'])
    if (!process.env[name]?.startsWith('/'))
      throw new Error(`生产环境 ${name} 必须为绝对路径`)
  modelWeights()
  for (const name of [
    'PIXLOOM_MAX_PUBLISHED_PER_USER',
    'PIXLOOM_TASKS_PER_HOUR',
    'PIXLOOM_USER_STORAGE_BYTES',
    'PIXLOOM_TOTAL_STORAGE_BYTES',
    'PIXLOOM_MIN_FREE_DISK_BYTES',
  ])
    if (process.env[name]) limit(name, 1)
  limit('PIXLOOM_MAX_ACTIVE_TASKS_PER_USER', 2)
  limit('PIXLOOM_MAX_QUEUED_TASKS', 30)
  limit('PIXLOOM_RUNTIME_IDLE_SECONDS', 300, 0)
  limit('PIXLOOM_MAX_RUNTIME_CONTAINERS', 3)
  for (const [name, fallback] of [
    ['PIXLOOM_WORKER_CONCURRENCY', 3],
    ['PIXLOOM_BUILD_CONCURRENCY', 1],
    ['PIXLOOM_BROWSER_CONCURRENCY', 1],
    ['PIXLOOM_MODEL_CONCURRENCY', 3],
  ] as const)
    limit(name, fallback, 1, 32)
}

export function modelWeights(): Record<
  string,
  { input: number; output: number }
> {
  let values: unknown
  try {
    values = JSON.parse(process.env.PIXLOOM_MODEL_WEIGHTS || '{}')
  } catch {
    throw new Error('PIXLOOM_MODEL_WEIGHTS 必须是 JSON 对象')
  }
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('PIXLOOM_MODEL_WEIGHTS 必须是 JSON 对象')
  for (const [key, raw] of Object.entries(values)) {
    const weight = raw as { input?: unknown; output?: unknown } | null
    if (
      !/^(gemini|openai):[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(key) ||
      !weight ||
      typeof weight !== 'object' ||
      ![weight.input, weight.output].every(
        (n) =>
          typeof n === 'number' &&
          Number.isSafeInteger(n) &&
          n >= 1 &&
          n <= 10000,
      )
    )
      throw new Error(
        '模型额度权重必须包含 provider:model 与 1–10000 的 input/output 整数',
      )
  }
  return values as Record<string, { input: number; output: number }>
}
