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

interface RiseConfig {
  pythonPath: string
  sourcePath: string
  dependencyPath: string
  checkpointPath: string
  checkpointSha256: string
  device: string
  tileStride: number
  maxTiles: number
  timeoutMs: number
}
interface RiseBundle {
  image: { imageId: string }
  reports: {
    mode: string
    moduleId: string
    taskId: string
    elapsedMs: number
    producer: { name: string }
    result: {
      decision: string
      score: { value: number } | null
      regions: unknown[]
      localization: { regionCount: number; manipulatedAreaFraction: number; status: string }
    }
    extensions: { strictStateDict: boolean; variant: string }
    limitations: string[]
  }[]
}
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export class RiseAnalysisService implements AnalysisService {
  async analyze(input: ImportedImage, context: AnalysisContext): Promise<AnalysisReport> {
    if (app.isPackaged)
      throw new AppError('MODEL_NOT_READY', 'RiSE 暂在源码开发模式接入，发布包环境尚未配置。')
    const root = app.getAppPath()
    const file = resolve(root, process.env.SRDP_RISE_CONFIG ?? 'config/rise.local.json')
    let config: RiseConfig
    try {
      config = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
    } catch {
      throw new AppError(
        'MODEL_NOT_READY',
        '请复制 config/rise.example.json 为 config/rise.local.json，并配置 Python 与 RiSE-9 RGB 权重路径。'
      )
    }
    for (const key of [
      'pythonPath',
      'sourcePath',
      'dependencyPath',
      'checkpointPath',
      'checkpointSha256'
    ] as const)
      if (typeof config[key] !== 'string' || !config[key])
        throw new AppError('INVALID_REQUEST', `RiSE 配置缺少 ${key}。`)
    if (
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs < 1000 ||
      config.timeoutMs > 600000 ||
      !['cuda:0', 'cpu'].includes(config.device) ||
      !Number.isInteger(config.tileStride) ||
      config.tileStride < 128 ||
      config.tileStride > 512 ||
      !Number.isInteger(config.maxTiles) ||
      config.maxTiles < 1 ||
      config.maxTiles > 512 ||
      !/^[a-f0-9]{64}$/.test(config.checkpointSha256)
    )
      throw new AppError(
        'INVALID_REQUEST',
        'RiSE 配置无效：检查设备、分块步长128–512、分块上限1–512、SHA256及超时1000–600000毫秒。'
      )
    config = {
      ...config,
      sourcePath: resolve(root, config.sourcePath),
      dependencyPath: resolve(root, config.dependencyPath),
      checkpointPath: resolve(root, config.checkpointPath),
      pythonPath:
        config.pythonPath.includes('/') || config.pythonPath.includes('\\')
          ? resolve(root, config.pythonPath)
          : config.pythonPath
    }
    for (const [key, label] of [['checkpointPath', 'RiSE-9 RGB 权重']] as const)
      try {
        await access(config[key])
      } catch {
        throw new AppError('MODEL_NOT_READY', `缺少 RiSE 定位权重（${label}）：${config[key]}`)
      }
    try {
      await access(config.sourcePath)
      await access(config.dependencyPath)
    } catch {
      throw new AppError(
        'MODEL_NOT_READY',
        '缺少官方 RiSE 源码或依赖目录，请检查 .tools/rise-official 与 .tools/rise-deps-v5。'
      )
    }
    context.signal.throwIfAborted()
    const output = join(root, 'work/rise-runs', context.taskId)
    await mkdir(join(root, 'work/rise-runs'), { recursive: true })
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
      workerPath: join(root, 'backend/rise/worker.py'),
      requestPath,
      cwd: root,
      timeoutMs: config.timeoutMs,
      name: 'RiSE',
      imageId: input.asset.id,
      context
    })
    context.signal.throwIfAborted()
    const bundlePath = join(output, 'bundle.json')
    const raw: unknown = JSON.parse(await readFile(bundlePath, 'utf8'))
    if (!validate(raw)) throw new AppError('INFERENCE_FAILED', 'RiSE 输出报告未通过协议校验。')
    const bundle = raw as unknown as RiseBundle
    const report = bundle.reports[0]
    if (
      bundle.image.imageId !== input.asset.id ||
      bundle.reports.length !== 1 ||
      report.taskId !== context.taskId ||
      report.mode !== 'local' ||
      report.moduleId !== 'manipulation' ||
      report.producer.name !== 'RiSE-9-RGB' ||
      report.extensions.strictStateDict !== true
    )
      throw new AppError('INFERENCE_FAILED', 'RiSE 输出身份或完整加载记录不一致。')
    const overlay = await sharp(await readFile(join(output, 'artifacts/overlay.png')))
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    const { regionCount, manipulatedAreaFraction } = report.result.localization
    return {
      id: context.taskId,
      imageId: input.asset.id,
      backend: 'rise',
      mode: 'local',
      createdAt: new Date().toISOString(),
      elapsedMs: report.elapsedMs,
      title: 'RiSE 文档定位已完成',
      summary: `已处理「${basename(input.sourcePath)}」，${regionCount > 0 ? `模型标记了 ${regionCount} 个可疑区域` : '模型本次未标记可疑区域'}。整图判断未输出结论：尚未配置经验证的阈值，这不否定上面的定位输出。`,
      sections: [
        {
          title: '像素定位',
          description: `RiSE-9 RGB 标记面积占比 ${(manipulatedAreaFraction * 100).toFixed(2)}%，掩码阈值 0.5。区域已映射到原尺寸规范显示图。`
        },
        {
          title: '执行范围',
          description: '本次只运行 RiSE-9 RGB 视觉定位；未运行 SICA、OCR 或 VLM。'
        },
        {
          title: '预处理',
          description:
            '保留显示图分辨率，以512像素重叠分块覆盖全图；九专家顺序推理，重叠像素响应取均值，再按0.5生成掩码。'
        }
      ],
      disclaimer: report.limitations.join(' '),
      localization: {
        decision: report.result.decision,
        score: report.result.score?.value ?? null,
        regionCount,
        manipulatedAreaFraction,
        overlayDataUrl: `data:image/png;base64,${overlay.toString('base64')}`,
        bundlePath,
        bundle: raw as Record<string, unknown>
      }
    }
  }
}
