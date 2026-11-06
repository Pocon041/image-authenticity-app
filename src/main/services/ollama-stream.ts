/** Read genuine Ollama NDJSON, preserving the complete model reply for audit. */
export async function readOllamaChat(
  response: Response,
  onContent?: (content: string) => void
): Promise<{ message: { content: string }; [key: string]: unknown }> {
  // Some existing remote endpoints return one JSON response even when stream=true.
  if (response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json()
    if (data.error) throw new Error(String(data.error))
    onContent?.(data.message?.content ?? '')
    return data
  }
  if (!response.body) throw new Error('Ollama 返回为空')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = '',
    content = '',
    done = false
  let last: Record<string, unknown> = {}
  const consume = (line: string) => {
    if (!line.trim()) return
    const data = JSON.parse(line)
    if (data.error) throw new Error(String(data.error))
    last = data
    content += data.message?.content ?? ''
    if (data.done) done = true
    onContent?.(content)
  }
  try {
    for (;;) {
      const next = await reader.read()
      pending += decoder.decode(next.value, { stream: !next.done })
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, index))
        pending = pending.slice(index + 1)
      }
      if (next.done) break
    }
    consume(pending)
    if (!done) throw new Error('Ollama 输出中断，未收到完成事件')
    return { ...last, message: { content } }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
