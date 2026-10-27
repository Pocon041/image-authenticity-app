import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import sharp from 'sharp'
import reportSchema from '../../../schemas/report-bundle.schema.json'
import type { AnalysisReport, ErrorCode } from '../../shared/contracts'
import { AppError } from '../errors'
import type { ImportedImage } from '../image-import'
import { MockAnalysisService, type AnalysisContext, type AnalysisService } from './analysis'
import { SicaAnalysisService } from './sica'

interface RitaConfig {
  pythonPath: string
  upstreamPath: string
  checkpointPath: string
  checkpointSha256: string | null
  device: 'auto' | 'cpu' | 'cuda'
  maxSteps: number
  decisionThreshold: number | null
  timeoutMs: number
}

interface RitaBundle {
  image: { imageId: string }
  reports: {
    mode: 'local'
    taskId: string
    elapsedMs: number
    result: {
      decision: string
      score: { value: number } | null
      regionCount: number
      manipulatedAreaFraction: number
    }
    limitations: string[]
  }[]
}

const validator = new Ajv({ allErrors: true, strict: false })
addFormats(validator)
const validateBundle = validator.compile(reportSchema)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const knownErrors = new Set<ErrorCode>([
  'MODEL_NOT_READY',
  'INVALID_MODEL',
  'INFERENCE_FAILED',
  'INVALID_IMAGE',
  'INVALID_REQUEST'
])

async function configFor(root: string): Promise<RitaConfig> {
  const file = process.env.SRDP_RITA_CONFIG
    ? resolve(root, process.env.SRDP_RITA_CONFIG)
    : join(root, 'config/rita.local.json')
  let config: RitaConfig
  try {
    config = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
  } catch {
    throw new AppError(
      'MODEL_NOT_READY',
      '请复制 config/rita.example.json 为 config/rita.local.json，并配置 Python 与官方权重路径。'
    )
  }
  for (const key of ['pythonPath', 'upstreamPath', 'checkpointPath'] as const) {
    if (typeof config[key] !== 'string' || !config[key])
      throw new AppError('INVALID_REQUEST', `RITA 配置缺少 ${key}。`)
  }
  if (
    !Number.isInteger(config.maxSteps) ||
    config.maxSteps < 1 ||
    config.maxSteps > 20 ||
    !Number.isFinite(config.timeoutMs) ||
    config.timeoutMs < 1000 ||
    config.timeoutMs > 600000 ||
    !['auto', 'cpu', 'cuda'].includes(config.device)
  ) {
    throw new AppError('INVALID_REQUEST', 'RITA 的步数、设备或超时配置无效。')
  }
  if (config.checkpointSha256 !== null && !/^[a-f0-9]{64}$/.test(config.checkpointSha256))
    throw new AppError('INVALID_REQUEST', '权重 SHA256 应为小写完整哈希或 null。')
  if (
    config.decisionThreshold !== null &&
    (typeof config.decisionThreshold !== 'number' ||
      !Number.isFinite(config.decisionThreshold) ||
      config.decisionThreshold < 0 ||
      config.decisionThreshold > 1)
  )
    throw new AppError('INVALID_REQUEST', '整图阈值应为 0 到 1 的数值或 null。')
  const checkpoint = resolve(root, config.checkpointPath)
  try {
    await access(checkpoint)
  } catch {
    throw new AppError('MODEL_NOT_READY', `缺少官方 RITA 权重，请放到 ${checkpoint}`)
  }
  try {
    await access(resolve(root, config.upstreamPath))
  } catch {
    throw new AppError('MODEL_NOT_READY', '缺少官方 RITA 源码，请先执行 npm.cmd run rita:setup。')
  }
  return {
    ...config,
    upstreamPath: resolve(root, config.upstreamPath),
    checkpointPath: checkpoint,
    pythonPath:
      config.pythonPath.includes('/') || config.pythonPath.includes('\\')
        ? resolve(root, config.pythonPath)
        : config.pythonPath
  }
}

export class RoutedAnalysisService implements AnalysisService {
  private readonly mock = new MockAnalysisService()
  private readonly sica = new SicaAnalysisService()

  async analyze(input: ImportedImage, context: AnalysisContext): Promise<AnalysisReport> {
    if (context.backend === 'sica') return this.sica.analyze(input, context)
    if (context.backend !== 'rita') return this.mock.analyze(input, context)
    if (app.isPackaged)
      throw new AppError('MODEL_NOT_READY', 'RITA 当前在源码开发模式接入，发布包环境尚未配置。')
    const root = app.getAppPath()
    const config = await configFor(root)
    context.signal.throwIfAborted()
    const output = join(root, 'work/rita-runs', context.taskId)
    await mkdir(join(root, 'work/rita-runs'), { recursive: true })
    try {
      await mkdir(output)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new AppError('INVALID_REQUEST', '任务 ID 已使用，请新建分析任务。')
      throw error
    }
    await mkdir(join(output, 'images'))
    const originalName = basename(input.sourcePath)
    const extension =
      input.asset.mimeType === 'image/jpeg'
        ? '.jpg'
        : input.asset.mimeType === 'image/webp'
          ? '.webp'
          : '.png'
    const originalPath = join(output, `images/original${extension}`)
    const displayPath = join(output, 'images/display.png')
    const hash = digest(input.originalBytes)
    if (input.asset.id !== `sha256:${hash}`)
      throw new AppError('INVALID_IMAGE', '当前图片身份不一致，请重新导入。')
    await writeFile(originalPath, input.originalBytes)
    const metadata = await sharp(input.originalBytes).metadata()
    const display = await sharp(input.originalBytes).rotate().toColourspace('srgb').png().toBuffer()
    await writeFile(displayPath, display)
    const image = {
      imageId: input.asset.id,
      sha256: hash,
      originalArtifactId: `${hash}:original`,
      displayArtifactId: `${hash}:display`,
      encodedWidth: metadata.width,
      encodedHeight: metadata.height,
      width: input.asset.width,
      height: input.asset.height,
      exifOrientation: metadata.orientation ?? 1,
      coordinateSpace: 'display_image_pixels',
      displayTransform: 'exif_auto_orient_no_resize'
    }
    const imageArtifacts = [
      {
        artifactId: image.originalArtifactId,
        type: 'original',
        uri: `images/original${extension}`,
        mediaType: input.asset.mimeType,
        sha256: hash,
        width: metadata.width,
        height: metadata.height,
        coordinateSpace: 'encoded_file_pixels',
        bboxXYWH: null,
        sourceArtifactId: null,
        origin: 'original'
      },
      {
        artifactId: image.displayArtifactId,
        type: 'display',
        uri: 'images/display.png',
        mediaType: 'image/png',
        sha256: digest(display),
        width: image.width,
        height: image.height,
        coordinateSpace: 'display_image_pixels',
        bboxXYWH: null,
        sourceArtifactId: image.originalArtifactId,
        origin: 'derived'
      }
    ]
    const requestPath = join(output, 'request.local.json')
    await writeFile(
      requestPath,
      JSON.stringify({
        ...config,
        originalPath,
        displayPath,
        outputDirectory: output,
        taskId: context.taskId,
        image,
        imageArtifacts
      })
    )
    await this.runPython(root, config, requestPath, context, input.asset.id)
    context.signal.throwIfAborted()
    const bundlePath = join(output, 'bundle.json')
    const rawBundle: unknown = JSON.parse(await readFile(bundlePath, 'utf8'))
    if (!validateBundle(rawBundle))
      throw new AppError('INFERENCE_FAILED', 'RITA 输出报告未通过协议校验。')
    const bundle = rawBundle as unknown as RitaBundle
    const result = bundle.reports[0]
    if (
      bundle.image.imageId !== input.asset.id ||
      bundle.reports.length !== 1 ||
      result.mode !== 'local' ||
      result.taskId !== context.taskId
    )
      throw new AppError('INFERENCE_FAILED', 'RITA 输出图片或任务身份不一致。')
    const overlay = await sharp(await readFile(join(output, 'artifacts/overlay.png')))
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return {
      id: context.taskId,
      imageId: input.asset.id,
      mode: 'local',
      createdAt: new Date().toISOString(),
      elapsedMs: result.elapsedMs,
      title: 'RITA 定位已完成',
      summary: `已处理「${originalName}」，${result.result.regionCount > 0 ? `模型标记了 ${result.result.regionCount} 个可疑区域` : '模型本次未标记可疑区域'}。${config.decisionThreshold === null ? '图像级分类未启用：尚未验证整图判断阈值。这不否定上面的定位输出。' : '图像级分类使用本机配置阈值，该阈值仍需质量验证。'}`,
      sections: [
        {
          title: '像素定位',
          description: `模型标记面积占比 ${(result.result.manipulatedAreaFraction * 100).toFixed(2)}%。区域掩码已映射到原尺寸规范显示图。`
        },
        {
          title: '运行范围',
          description: '本次只执行 RITA 篡改定位；未执行 AI 生成检测、来源凭证分析或 VLM。'
        }
      ],
      disclaimer: result.limitations.join(' '),
      localization: {
        decision: result.result.decision,
        score: result.result.score?.value ?? null,
        regionCount: result.result.regionCount,
        manipulatedAreaFraction: result.result.manipulatedAreaFraction,
        overlayDataUrl: `data:image/png;base64,${overlay.toString('base64')}`,
        bundlePath,
        bundle: rawBundle as Record<string, unknown>
      }
    }
  }

  private runPython(
    root: string,
    config: RitaConfig,
    request: string,
    context: AnalysisContext,
    imageId: string
  ): Promise<void> {
    return new Promise((resolveRun, reject) => {
      const child = spawn(
        config.pythonPath,
        ['-u', join(root, 'backend/rita/worker.py'), '--request', request],
        {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        }
      )
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      let stdout = '',
        stderr = '',
        workerError: AppError | undefined,
        timedOut = false,
        receivedResult = false
      const cancel = () => child.kill()
      context.signal.addEventListener('abort', cancel, { once: true })
      if (context.signal.aborted) cancel()
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, config.timeoutMs)
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > 1024 * 1024) {
          workerError = new AppError('INFERENCE_FAILED', '推理进程返回了过多数据。')
          child.kill()
          return
        }
        let index: number
        while ((index = stdout.indexOf('\n')) >= 0) {
          const line = stdout.slice(0, index)
          stdout = stdout.slice(index + 1)
          try {
            const event = JSON.parse(line)
            if (
              event.type === 'progress' &&
              Number.isFinite(event.percent) &&
              typeof event.label === 'string'
            )
              context.onProgress({
                taskId: context.taskId,
                imageId,
                stage: 'analyzing',
                percent: Math.max(0, Math.min(100, event.percent)),
                label: event.label
              })
            if (event.type === 'error')
              workerError = new AppError(
                knownErrors.has(event.code) ? event.code : 'INFERENCE_FAILED',
                String(event.message)
              )
            if (event.type === 'result') receivedResult = true
          } catch {
            /* Non-protocol stdout is ignored; final JSON and exit code remain mandatory. */
          }
        }
      })
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-8000)
      })
      child.once('error', () => {
        clearTimeout(timer)
        context.signal.removeEventListener('abort', cancel)
        reject(
          new AppError('MODEL_NOT_READY', '无法启动配置的 Python，请检查 config/rita.local.json。')
        )
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        context.signal.removeEventListener('abort', cancel)
        if (context.signal.aborted) return reject(new AppError('CANCELLED', '分析已取消。'))
        if (timedOut) return reject(new AppError('TIMEOUT', 'RITA 推理超时，进程已停止。'))
        if (workerError) return reject(workerError)
        if (code !== 0 || !receivedResult) {
          console.error('[RITA]', stderr)
          return reject(
            new AppError('INFERENCE_FAILED', 'RITA 推理未完成，请检查 Python 依赖和终端日志。')
          )
        }
        resolveRun()
      })
    })
  }
}
