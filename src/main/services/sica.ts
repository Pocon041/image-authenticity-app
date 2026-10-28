import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import sharp from 'sharp'
import schema from '../../../schemas/report-bundle.schema.json'
import type { AnalysisReport } from '../../shared/contracts'
import { AppError } from '../errors'
import type { ImportedImage } from '../image-import'
import type { AnalysisContext, AnalysisService } from './analysis'
import { runPythonWorker } from './python-worker'

interface SicaConfig {
  pythonPath: string
  upstreamPath: string
  clipSourcePath: string
  checkpointPath: string
  checkpointSha256: string | null
  checkpointVariant: 'train' | 'full' | 'unknown'
  device: 'auto' | 'cpu' | 'cuda'
  threshold: number
  timeoutMs: number
}
interface SicaBundle {
  image: { imageId: string }
  reports: {
    mode: string
    moduleId: string
    taskId: string
    elapsedMs: number
    result: {
      score: { value: number }
      classification: { predictedClass: 'fake' | 'real'; threshold: number }
    }
    extensions: { strictStateDict: boolean; checkpointVariant: string }
    limitations: string[]
  }[]
}
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export class SicaAnalysisService implements AnalysisService {
  async analyze(input: ImportedImage, context: AnalysisContext): Promise<AnalysisReport> {
    if (app.isPackaged)
      throw new AppError('MODEL_NOT_READY', 'SICA 暂在源码开发模式接入，发布包环境尚未配置。')
    const root = app.getAppPath()
    const file = resolve(root, process.env.SRDP_SICA_CONFIG ?? 'config/sica.local.json')
    let config: SicaConfig
    try {
      config = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
    } catch {
      throw new AppError(
        'MODEL_NOT_READY',
        '请复制 config/sica.example.json 为 config/sica.local.json 并配置 Python 和权重。'
      )
    }
    for (const key of ['pythonPath', 'upstreamPath', 'clipSourcePath', 'checkpointPath'] as const)
      if (typeof config[key] !== 'string' || !config[key])
        throw new AppError('INVALID_REQUEST', `SICA 配置缺少 ${key}。`)
    if (
      !Number.isFinite(config.threshold) ||
      config.threshold < 0 ||
      config.threshold > 1 ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs < 1000 ||
      config.timeoutMs > 600000 ||
      !['auto', 'cpu', 'cuda'].includes(config.device) ||
      !['train', 'full', 'unknown'].includes(config.checkpointVariant)
    )
      throw new AppError('INVALID_REQUEST', 'SICA 阈值、设备、权重类型或超时配置无效。')
    if (config.checkpointSha256 !== null && !/^[a-f0-9]{64}$/.test(config.checkpointSha256))
      throw new AppError('INVALID_REQUEST', 'SICA 权重哈希应为完整小写 SHA256 或 null。')
    config = {
      ...config,
      upstreamPath: resolve(root, config.upstreamPath),
      clipSourcePath: resolve(root, config.clipSourcePath),
      checkpointPath: resolve(root, config.checkpointPath),
      pythonPath:
        config.pythonPath.includes('/') || config.pythonPath.includes('\\')
          ? resolve(root, config.pythonPath)
          : config.pythonPath
    }
    try {
      await access(config.checkpointPath)
    } catch {
      throw new AppError('MODEL_NOT_READY', `缺少 SICA 权重：${config.checkpointPath}`)
    }
    try {
      await access(config.upstreamPath)
      await access(join(config.clipSourcePath, 'srdp-source-manifest.json'))
    } catch {
      throw new AppError(
        'MODEL_NOT_READY',
        '缺少固定版本 SICA/CLIP 源码，请运行 npm.cmd run sica:setup。'
      )
    }
    context.signal.throwIfAborted()
    const output = join(root, 'work/sica-runs', context.taskId)
    await mkdir(join(root, 'work/sica-runs'), { recursive: true })
    try {
      await mkdir(output)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new AppError('INVALID_REQUEST', '任务 ID 已使用，请新建任务。')
      throw error
    }
    await mkdir(join(output, 'images'))
    const hash = digest(input.originalBytes)
    if (input.asset.id !== `sha256:${hash}`)
      throw new AppError('INVALID_IMAGE', '图片身份不一致，请重新导入。')
    const ext =
      input.asset.mimeType === 'image/jpeg'
        ? 'jpg'
        : input.asset.mimeType === 'image/webp'
          ? 'webp'
          : 'png'
    const originalUri = `images/original.${ext}`
    const originalPath = join(output, originalUri),
      displayPath = join(output, 'images/display.png')
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
        uri: originalUri,
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
        image,
        imageArtifacts,
        taskId: context.taskId
      })
    )
    await runPythonWorker({
      pythonPath: config.pythonPath,
      workerPath: join(root, 'backend/sica/worker.py'),
      requestPath,
      cwd: root,
      timeoutMs: config.timeoutMs,
      name: 'SICA',
      imageId: input.asset.id,
      context
    })
    context.signal.throwIfAborted()
    const bundlePath = join(output, 'bundle.json')
    const raw: unknown = JSON.parse(await readFile(bundlePath, 'utf8'))
    if (!validate(raw)) throw new AppError('INFERENCE_FAILED', 'SICA 输出报告未通过协议校验。')
    const bundle = raw as unknown as SicaBundle
    const report = bundle.reports[0]
    if (
      bundle.image.imageId !== input.asset.id ||
      bundle.reports.length !== 1 ||
      report.taskId !== context.taskId ||
      report.mode !== 'local' ||
      report.moduleId !== 'manipulation' ||
      report.extensions.strictStateDict !== true
    )
      throw new AppError('INFERENCE_FAILED', 'SICA 输出身份或完整加载记录不一致。')
    const { score, classification } = report.result
    return {
      id: context.taskId,
      imageId: input.asset.id,
      backend: 'sica',
      mode: 'local',
      createdAt: new Date().toISOString(),
      elapsedMs: report.elapsedMs,
      title: 'SICA 二分类已完成',
      summary: `已处理「${basename(input.sourcePath)}」，SICA 判为${classification.predictedClass === 'fake' ? '疑似伪造' : '倾向真实'}。此为图像级判断，未确定生成或篡改类型，也未运行像素定位。`,
      sections: [
        {
          title: '分类结果',
          description: `伪造分数 ${score.value.toFixed(4)}，阈值 ${classification.threshold}；分数未经校准。`
        },
        {
          title: '执行范围',
          description: '只运行 SICA 二分类；未运行 RITA、AI 生成专用检测、来源分析或 VLM。'
        },
        {
          title: '预处理',
          description: '按官方 CLIP 接口缩放短边后中心裁剪至 224×224，边缘区域可能被裁去。'
        }
      ],
      disclaimer: report.limitations.join(' '),
      classification: {
        decision: classification.predictedClass,
        score: score.value,
        threshold: classification.threshold,
        checkpointVariant: report.extensions.checkpointVariant,
        bundlePath,
        bundle: raw as Record<string, unknown>
      }
    }
  }
}
