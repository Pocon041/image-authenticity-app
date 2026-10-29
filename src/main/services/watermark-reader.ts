import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Json = Record<string, any>

export async function inspectPixelWatermarks(args: {
  root: string
  originalPath: string
  displayPath: string
  signal: AbortSignal
}): Promise<Json> {
  const python =
    process.platform === 'win32'
      ? join(args.root, '.venv/Scripts/python.exe')
      : join(args.root, '.venv/bin/python')
  const worker = join(args.root, 'backend/provenance/detect_watermark.py')
  if (!existsSync(python))
    return {
      status: 'not_run',
      reason: '图像水印检测环境未安装；运行 run.cmd run provenance:setup。'
    }

  return new Promise((resolve) => {
    const child = spawn(python, [worker, args.originalPath, args.displayPath], {
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
    }, 60000)
    const abort = () => child.kill()
    args.signal.addEventListener('abort', abort, { once: true })
    if (args.signal.aborted) abort()
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
        resolve({ status: 'failed', reason: '可见与隐形水印检测超过60秒。' })
        return
      }
      try {
        const outputLines = stdout.trim().split(/\r?\n/)
        let response: Json | undefined
        for (const line of outputLines.reverse()) {
          try {
            response = JSON.parse(line)
            break
          } catch {
            // Ignore diagnostic lines printed by an OCR or native inference library.
          }
        }
        if (!response) throw new Error('No JSON result.')
        resolve(
          response.ok
            ? {
                status: 'completed',
                visible: response.visible,
                invisible: response.invisible,
                stderr: stderr.trim() || null
              }
            : {
                status: 'failed',
                reason: response.error,
                errorType: response.errorType,
                stderr: stderr.trim() || null,
                exitCode: code
              }
        )
      } catch {
        resolve({
          status: 'failed',
          reason: `图像水印检测器返回无效结果（退出码 ${code ?? 'unknown'}）。`,
          stderr: stderr.trim() || null
        })
      }
    })
  })
}
