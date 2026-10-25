import type { ModelOption, Provider } from '../types'
export function modelOptions(): ModelOption[] {
  return [
    {
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      label: 'Gemini',
      configured: Boolean(
        process.env.GEMINI_API_KEY || process.env.VERTEX_AI_API_KEY,
      ),
    },
    {
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      label: 'GPT',
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
  ]
}
export function modelConfig(provider: Provider) {
  return modelOptions().find((m) => m.provider === provider)!
}

export function requireModel(provider: Provider) {
  const config = modelConfig(provider)
  if (!config.configured)
    throw new Error(
      provider === 'gemini'
        ? '请在 .env.local 配置 GEMINI_API_KEY 或 VERTEX_AI_API_KEY，并重启 Web 和 Worker'
        : '请在 .env.local 配置 OPENAI_API_KEY，并重启 Web 和 Worker',
    )
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(config.model))
    throw new Error('模型名称无效，请检查服务端模型配置')
  if (provider === 'openai' && process.env.OPENAI_BASE_URL) {
    let url: URL
    try {
      url = new URL(process.env.OPENAI_BASE_URL)
    } catch {
      throw new Error('OPENAI_BASE_URL 不是有效 URL')
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'OPENAI_BASE_URL 必须为不含凭证、查询参数和片段的 HTTP(S) API 地址',
      )
  }
  return config
}
