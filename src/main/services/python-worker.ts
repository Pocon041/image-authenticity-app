import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ErrorCode } from '../../shared/contracts'
import { AppError } from '../errors'
import type { AnalysisContext } from './analysis'

interface WorkerOptions {
  pythonPath: string
  workerPath: string
  requestPath: string
  cwd: string
  timeoutMs: number
  name: string
  imageId: string
  context: AnalysisContext
}

export function runPythonWorker(options: WorkerOptions): Promise<void> {
  const { context } = options
  const codes = new Set<ErrorCode>([
    'MODEL_NOT_READY',
    'INVALID_MODEL',
    'INVALID_IMAGE',
    'INVALID_REQUEST',
    'INFERENCE_FAILED'
  ])
  return new Promise((complete, reject) => {
    const startedAt = new Date().toISOString()
    const child = spawn(
      options.pythonPath,
      ['-u', options.workerPath, '--request', options.requestPath],
      {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          HF_HOME: join(options.cwd, '.cache/huggingface'),
          TORCH_HOME: join(options.cwd, '.cache/torch'),
          XDG_CACHE_HOME: join(options.cwd, '.cache')
        }
      }
    )
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let buffer = '',
      stderr = '',
      resultReceived = false,
      timedOut = false,
      workerError: AppError | undefined
    let stdoutTail = ''
    const cancel = () => child.kill()
    context.signal.addEventListener('abort', cancel, { once: true })
    if (context.signal.aborted) cancel()
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
    const cleanup = () => {
      clearTimeout(timeout)
      context.signal.removeEventListener('abort', cancel)
    }
    child.stdout.on('data', (chunk: string) => {
      stdoutTail = (stdoutTail + chunk).slice(-16000)
      buffer += chunk
      if (buffer.length > 1024 * 1024) {
        workerError = new AppError('INFERENCE_FAILED', '推理进程返回过多数据。')
        child.kill()
        return
      }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const event = JSON.parse(line)
          if (
            event.type === 'progress' &&
            Number.isFinite(event.percent) &&
            typeof event.label === 'string'
          )
            context.onProgress({
              taskId: context.taskId,
              imageId: options.imageId,
              stage: 'analyzing',
              percent: Math.max(0, Math.min(100, event.percent)),
              label: event.label
            })
          if (event.type === 'error')
            workerError = new AppError(
              codes.has(event.code) ? event.code : 'INFERENCE_FAILED',
              String(event.message)
            )
          if (event.type === 'result') resultReceived = true
        } catch {
          /* Exit code and a valid final bundle remain mandatory. */
        }
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000)
    })
    child.once('error', () => {
      workerError = new AppError('MODEL_NOT_READY', `无法启动 ${options.name} 配置中的 Python。`)
    })
    child.once('close', async (code, signal) => {
      cleanup()
      const status = context.signal.aborted
        ? 'cancelled'
        : timedOut
          ? 'timeout'
          : workerError || code !== 0 || !resultReceived
            ? 'failed'
            : 'completed'
      try {
        await writeFile(
          join(dirname(options.requestPath), 'worker.json'),
          JSON.stringify(
            {
              name: options.name,
              startedAt,
              finishedAt: new Date().toISOString(),
              status,
              exitCode: code,
              signal,
              resultReceived,
              error: workerError ? { code: workerError.code, message: workerError.message } : null,
              stderr,
              stdoutTail
            },
            null,
            2
          )
        )
      } catch (error) {
        console.error(`[${options.name}] Could not save worker diagnostics`, error)
      }
      if (context.signal.aborted) return reject(new AppError('CANCELLED', '分析任务已取消。'))
      if (timedOut) return reject(new AppError('TIMEOUT', `${options.name} 推理超时，进程已停止。`))
      if (workerError) return reject(workerError)
      if (code !== 0 || !resultReceived) {
        console.error(`[${options.name}]`, stderr)
        return reject(
          new AppError('INFERENCE_FAILED', `${options.name} 未完成，请检查配置与终端日志。`)
        )
      }
      complete()
    })
  })
}
