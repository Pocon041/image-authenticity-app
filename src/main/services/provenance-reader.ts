import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Json = Record<string, any>

export async function inspectProvenanceSource(args: {
  root: string
  imagePath: string
  readC2pa: boolean
  signal: AbortSignal
}): Promise<Json> {
  const python =
    process.platform === 'win32'
      ? join(args.root, '.tools/provenance-venv/Scripts/python.exe')
      : join(args.root, '.tools/provenance-venv/bin/python')
  const worker = join(args.root, 'backend/provenance/read_c2pa.py')
  if (!existsSync(python))
    return {
      status: 'not_run',
      reason: '来源解析器未安装；运行 run.cmd run provenance:setup 后可读取详细元数据和C2PA清单。'
    }

  return new Promise((resolve) => {
    const workerArgs = [worker, args.imagePath]
    if (args.readC2pa) workerArgs.push('--read-c2pa')
    const child = spawn(python, workerArgs, {
      cwd: args.root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    let stdout = '',
      stderr = '',
      timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 30000)
    const abort = () => child.kill()
    args.signal.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-1_000_000)
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_000)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      args.signal.removeEventListener('abort', abort)
      resolve({ status: 'failed', reason: error.message })
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      args.signal.removeEventListener('abort', abort)
      if (args.signal.aborted) {
        resolve({ status: 'not_run', reason: '分析已取消。' })
        return
      }
      if (timedOut) {
        resolve({ status: 'failed', reason: '来源元数据与C2PA读取超过30秒。' })
        return
      }
      try {
        const response = JSON.parse(stdout.trim())
        resolve(
          response.ok
            ? {
                status: 'completed',
                pythonVersion: response.pythonVersion,
                pillowVersion: response.pillowVersion,
                metadata: response.metadata,
                c2pa: response.c2pa,
                stderr: stderr.trim() || null
              }
            : {
                status: 'failed',
                errorType: response.errorType,
                reason: response.error,
                stderr: stderr.trim() || null,
                exitCode: code
              }
        )
      } catch {
        resolve({
          status: 'failed',
          reason: `来源读取器返回无效结果（退出码 ${code ?? 'unknown'}）。`,
          stderr: stderr.trim() || null
        })
      }
    })
  })
}
