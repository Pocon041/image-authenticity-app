import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

let server: ChildProcess | undefined
let serverRoot: string | undefined
let starting: Promise<void> | undefined

export function stopManagedOllama(): void {
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const previous = server
    if (process.platform === 'win32') {
      const stop = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      stop.on('error', () => previous.kill())
    } else server.kill()
  }
  server = undefined
  serverRoot = undefined
  starting = undefined
}

export async function startManagedOllama(root: string): Promise<void> {
  let settings: { directory: string; port: number; model: string }
  try {
    settings = JSON.parse(await readFile(join(root, 'config/managed-runtime.json'), 'utf8'))
    const explanation = JSON.parse(
      (await readFile(join(root, 'config/explanation.local.json'), 'utf8')).replace(/^\uFEFF/, '')
    )
    if (explanation.host !== `http://127.0.0.1:${settings.port}`) return
  } catch {
    return
  }
  if (serverRoot === root && server?.exitCode === null && server.signalCode === null && starting)
    return starting
  stopManagedOllama()
  const privateProfile = join(root, '.runtime/ollama-profile')
  const temporary = join(root, '.runtime/ollama-temp')
  await mkdir(privateProfile, { recursive: true })
  await mkdir(temporary, { recursive: true })
  const child = spawn(join(settings.directory, 'ollama/ollama.exe'), ['serve'], {
    cwd: settings.directory,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      OLLAMA_HOST: `127.0.0.1:${settings.port}`,
      OLLAMA_MODELS: join(settings.directory, 'models/ollama-models'),
      OLLAMA_NO_CLOUD: '1',
      USERPROFILE: privateProfile,
      OLLAMA_TMPDIR: temporary,
      TEMP: temporary,
      TMP: temporary
    }
  })
  let error = ''
  child.stderr?.on('data', (chunk) => {
    error = (error + chunk.toString()).slice(-2000)
  })
  child.on('error', (value) => {
    error = value.message
  })
  server = child
  serverRoot = root
  child.once('exit', () => {
    if (server === child) {
      server = undefined
      serverRoot = undefined
      starting = undefined
    }
  })
  starting = (async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid)
        throw new Error(`本地解释服务启动失败。${error}`)
      try {
        const response = await fetch(`http://127.0.0.1:${settings.port}/api/tags`, {
          signal: AbortSignal.timeout(1000)
        })
        const data = await response.json()
        if (
          response.ok &&
          data.models?.some((item: { name: string }) => item.name === `${settings.model}:latest`)
        ) {
          await delay(100)
          if (child.exitCode !== null) throw new Error(`本地解释服务端口被占用。${error}`)
          return
        }
      } catch {
        // The managed server is starting from the bundled model store.
      }
      await delay(200)
    }
    throw new Error('本地解释服务未在规定时间内就绪，请重试自动配置。')
  })().catch((error) => {
    if (server === child) stopManagedOllama()
    throw error
  })
  return starting
}
