/** Release only the app's configured local Ollama model; remote/cloud services are untouched. */
export async function releaseLocalModel(host: string, model: string): Promise<void> {
  const url = new URL(host)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return
  try {
    await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000)
    })
  } catch {
    // A stopped/unavailable local service must not discard an existing report.
  }
}
