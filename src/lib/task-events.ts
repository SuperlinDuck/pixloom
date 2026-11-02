// Older tasks persisted request diagnostics alongside model messages.
export function isInternalModelMessage(message: string) {
  const text = message.trim()
  return (
    /^模型第\s*\d+\s*\/\s*\d+\s*步(?:\s|·|$)/.test(text) ||
    /^本轮模型请求已等待\s*\d+(?:\.\d+)?\s*秒，\s*当前[^；\n]+；\s*本轮最多等待\s*\d+(?:\.\d+)?\s*秒。?$/.test(
      text,
    )
  )
}
