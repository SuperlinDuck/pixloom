import type { Provider, Usage } from '../types'
import {
  agentInstructions,
  agentTools,
  type AgentInput,
  type ToolCall,
} from './tools'

export type ModelTurn = {
  text: string
  calls: ToolCall[]
  usage: Usage
  responseBytes: number
}
export type ModelSession = {
  next(inputs: AgentInput[], maxOutputTokens: number): Promise<ModelTurn>
}
export type ModelProvider = {
  createSession(request: {
    model: string
    prompt: string
    signal: AbortSignal
  }): ModelSession
}

const MAX_RETRIES = 3

function waitForRetry(delay: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delay)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function retryDelay(response: Response, attempt: number) {
  const fallback = 1000 * 2 ** attempt
  const header = response.headers.get('Retry-After')
  if (!header?.trim()) return fallback
  const seconds = Number(header)
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now()
  // Keep long server cooldowns within Node's timer range; task cancellation still applies.
  return Number.isFinite(delay)
    ? Math.min(2147483647, Math.max(fallback, delay))
    : fallback
}

async function requestError(response: Response) {
  const hints: Record<number, string> = {
    401: 'API Key 无效，请检查服务端配置',
    403: '模型访问被拒绝，请检查权限与地区',
    404: '模型或 API 地址不可用，请检查模型名称',
    429: '请求限流或额度不足，请检查额度后重试',
  }
  let retryable =
    response.status === 408 || response.status === 429 || response.status >= 500
  // Inspect only a bounded error body for quota category; never echo or persist it.
  if (response.status === 429 && response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (bytes < 16000) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes <= 16000) chunks.push(chunk.value)
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const details = JSON.stringify(value.error?.details || [])
      if (value.error?.code === 'insufficient_quota') {
        hints[429] = '模型账户额度不足，请检查余额与计费配置'
        retryable = false
      } else if (/per.?day|daily/i.test(details)) {
        hints[429] = '每日调用额度已用尽，请检查模型服务配额或更换配置'
        retryable = false
      } else if (/per.?minute|per.?second|rate_limit_exceeded/i.test(details))
        hints[429] = '触发短时调用限额，请等待后重试或提高模型服务配额'
    } catch {
      /* Keep the generic quota message for unrecognized error formats. */
    } finally {
      await reader.cancel().catch(() => {})
    }
  } else await response.body?.cancel()
  return {
    retryable,
    error: new Error(
      `模型请求失败（HTTP ${response.status}），${hints[response.status] || (response.status >= 500 ? '模型服务暂时不可用，请稍后重试' : '请检查模型和工具调用配置')}`,
    ),
  }
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
) {
  // Retry the exact serialized request without replaying inputs into session history.
  const payload = JSON.stringify(body)
  let response: Response
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: payload,
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      if (attempt === MAX_RETRIES)
        throw new Error('无法连接模型服务，请检查网络与 API 地址')
      await waitForRetry(1000 * 2 ** attempt, signal)
      continue
    }
    if (response.ok) break
    const failure = await requestError(response)
    if (!failure.retryable || attempt === MAX_RETRIES) throw failure.error
    await waitForRetry(retryDelay(response, attempt), signal)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('模型服务返回空响应')
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > 512 * 1024) {
      await reader.cancel()
      throw new Error('模型单次输出超过 512 KiB 限制')
    }
    chunks.push(chunk.value)
  }
  try {
    return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), bytes }
  } catch {
    throw new Error('模型服务返回了无效的 JSON 响应')
  }
}
const tokens = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.ceil(value)
    : 0

export const geminiProvider: ModelProvider = {
  createSession({ model, prompt, signal }) {
    const contents: unknown[] = [{ role: 'user', parts: [{ text: prompt }] }]
    return {
      async next(inputs, maxOutputTokens) {
        const key = process.env.GEMINI_API_KEY || process.env.VERTEX_AI_API_KEY
        if (!key)
          throw new Error(
            '请在 .env.local 配置 GEMINI_API_KEY 或 VERTEX_AI_API_KEY',
          )
        if (inputs.length)
          contents.push({
            role: 'user',
            parts: inputs.map((input) =>
              input.type === 'user'
                ? { text: input.text }
                : {
                    functionResponse: {
                      ...(input.id ? { id: input.id } : {}),
                      name: input.name,
                      response: { result: input.output },
                    },
                  },
            ),
          })
        const base = process.env.GEMINI_API_KEY
          ? 'https://generativelanguage.googleapis.com/v1beta/models'
          : 'https://aiplatform.googleapis.com/v1/publishers/google/models'
        const { data, bytes } = await post(
          `${base}/${encodeURIComponent(model)}:generateContent`,
          { 'x-goog-api-key': key },
          {
            systemInstruction: { parts: [{ text: agentInstructions }] },
            contents,
            tools: [
              {
                functionDeclarations: agentTools.map(
                  ({ name, description, parameters }) => ({
                    name,
                    description,
                    parametersJsonSchema: parameters,
                  }),
                ),
              },
            ],
            generationConfig: {
              maxOutputTokens,
              ...(/^gemini-3(?:[.-]|$)/.test(model)
                ? { thinkingConfig: { thinkingLevel: 'low' } }
                : {}),
            },
          },
          signal,
        )
        const candidate = data.candidates?.[0]
        if (
          !candidate ||
          candidate.finishReason !== 'STOP' ||
          !Array.isArray(candidate.content?.parts)
        )
          throw new Error(
            `Gemini 未完成输出（${candidate?.finishReason || '无候选结果'}），请缩小需求或检查模型可用性`,
          )
        // Preserve every original part, including thought signatures, in native history.
        contents.push(candidate.content)
        const parts = candidate.content.parts
        return {
          text: parts
            .filter(
              (p: { text?: string; thought?: boolean }) => p.text && !p.thought,
            )
            .map((p: { text: string }) => p.text)
            .join(''),
          calls: parts
            .filter((p: { functionCall?: unknown }) => p.functionCall)
            .map(
              (p: {
                functionCall: { id?: string; name: string; args: unknown }
              }) => ({
                id: p.functionCall.id || '',
                name: p.functionCall.name,
                arguments: p.functionCall.args,
              }),
            ),
          usage: {
            inputTokens: tokens(data.usageMetadata?.promptTokenCount),
            outputTokens:
              tokens(data.usageMetadata?.candidatesTokenCount) +
              tokens(data.usageMetadata?.thoughtsTokenCount),
          },
          responseBytes: bytes,
        }
      },
    }
  },
}
export const openaiProvider: ModelProvider = {
  createSession({ model, prompt, signal }) {
    const history: unknown[] = [{ role: 'user', content: prompt }]
    return {
      async next(inputs, maxOutputTokens) {
        const key = process.env.OPENAI_API_KEY
        if (!key) throw new Error('请在 .env.local 配置 OPENAI_API_KEY')
        history.push(
          ...inputs.map((input) =>
            input.type === 'user'
              ? { role: 'user', content: input.text }
              : {
                  type: 'function_call_output',
                  call_id: input.id,
                  output: input.output,
                },
          ),
        )
        const base = (
          process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
        ).replace(/\/$/, '')
        const { data, bytes } = await post(
          `${base}/responses`,
          { Authorization: `Bearer ${key}` },
          {
            model,
            instructions: agentInstructions,
            input: history,
            store: false,
            include: ['reasoning.encrypted_content'],
            max_output_tokens: maxOutputTokens,
            tools: agentTools.map(({ name, description, parameters }) => ({
              type: 'function',
              name,
              description,
              parameters,
              strict: true,
            })),
          },
          signal,
        )
        if (data.status !== 'completed' || !Array.isArray(data.output))
          throw new Error('GPT 未完成输出，请缩小需求或检查输出预算')
        // Replay reasoning items as well as tool calls; never store server-side conversation state.
        history.push(...data.output)
        const parts = data.output
          .filter((item: { type: string }) => item.type === 'message')
          .flatMap((item: { content: unknown[] }) => item.content)
        if (parts.some((p: { type: string }) => p.type === 'refusal'))
          throw new Error('模型拒绝了本次请求，请调整需求')
        return {
          text: parts
            .filter((p: { type: string }) => p.type === 'output_text')
            .map((p: { text: string }) => p.text)
            .join(''),
          calls: data.output
            .filter((item: { type: string }) => item.type === 'function_call')
            .map(
              (item: { call_id: string; name: string; arguments: string }) => {
                let args: unknown
                try {
                  args = JSON.parse(item.arguments)
                } catch {
                  args = null
                }
                return { id: item.call_id, name: item.name, arguments: args }
              },
            ),
          usage: {
            inputTokens: tokens(data.usage?.input_tokens),
            outputTokens: tokens(data.usage?.output_tokens),
          },
          responseBytes: bytes,
        }
      },
    }
  },
}
export function providerFor(provider: Provider): ModelProvider {
  return provider === 'gemini' ? geminiProvider : openaiProvider
}
