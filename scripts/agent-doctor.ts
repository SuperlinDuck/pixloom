import { loadEnvConfig } from '@next/env'
import { modelOptions, requireModel } from '../src/lib/ai/config'
import { providerFor } from '../src/lib/ai/provider'
import type { Provider } from '../src/lib/types'
loadEnvConfig(process.cwd())
async function main() {
  const probe = process.argv.includes('--probe')
  const requested = process.argv
    .find((value) => value.startsWith('--provider='))
    ?.split('=')[1]
  if (requested && !['gemini', 'openai'].includes(requested))
    throw new Error('provider 必须为 gemini 或 openai')
  for (const model of modelOptions().filter(
    (m) => !requested || m.provider === requested,
  )) {
    try {
      requireModel(model.provider)
      console.log(
        `${model.label} / ${model.model}: 本地配置有效${probe ? '，开始真实调用' : '（未进行网络调用）'}`,
      )
      if (probe) {
        const session = providerFor(model.provider as Provider).createSession({
          model: model.model,
          prompt:
            'This is a connectivity check with no project. Reply briefly with OK. Do not use tools.',
          signal: AbortSignal.timeout(30000),
        })
        const turn = await session.next([], 256)
        if (!turn.text && !turn.calls.length)
          throw new Error('模型没有返回有效响应')
        console.log(
          `PASS ${model.label}: 真实模型响应有效，输入 ${turn.usage.inputTokens} / 输出 ${turn.usage.outputTokens} tokens`,
        )
      }
    } catch (error) {
      console.error(`${model.label}: ${(error as Error).message}`)
      process.exitCode = 1
    }
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
