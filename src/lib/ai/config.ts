import type { ModelOption, Provider } from '../types'
export function modelOptions(): ModelOption[] {
  return [
    {
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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
