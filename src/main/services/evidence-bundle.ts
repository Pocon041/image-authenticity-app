import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import sharp from 'sharp'
import type { ContentType, DetectorResult } from '../../shared/contracts'
import type { ImportedImage } from '../image-import'
import { AppError } from '../errors'
import { manipulationSummary } from './manipulation-summary'

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
type Json = Record<string, any>

export async function prepareWorkflowInput(input: ImportedImage, output: string) {
  await mkdir(join(output, 'images'), { recursive: true })
  const hash = digest(input.originalBytes)
  if (input.asset.id !== `sha256:${hash}`) throw new AppError('INVALID_IMAGE', '原文件身份不一致。')
  const metadata = await sharp(input.originalBytes).metadata()
  const display = await sharp(input.originalBytes).rotate().toColourspace('srgb').png().toBuffer()
  const displayMetadata = await sharp(display).metadata()
  if (displayMetadata.width !== input.asset.width || displayMetadata.height !== input.asset.height)
    throw new AppError('INVALID_IMAGE', '规范显示尺寸不一致。')
  const originalUri = `images/original.${input.asset.mimeType === 'image/jpeg' ? 'jpg' : input.asset.mimeType.split('/')[1]}`
  await writeFile(join(output, originalUri), input.originalBytes)
  await writeFile(join(output, 'images/display.png'), display)
  const image = {
    imageId: input.asset.id,
    sha256: hash,
    originalArtifactId: `${hash}:original`,
    displayArtifactId: `${hash}:display`,
    encodedWidth: metadata.width!,
    encodedHeight: metadata.height!,
    width: input.asset.width,
    height: input.asset.height,
    exifOrientation: metadata.orientation ?? 1,
    coordinateSpace: 'display_image_pixels',
    displayTransform: 'exif_auto_orient_no_resize'
  }
  const artifacts: Json[] = [
    {
      artifactId: image.originalArtifactId,
      type: 'original',
      uri: originalUri,
      mediaType: input.asset.mimeType,
      sha256: hash,
      width: image.encodedWidth,
      height: image.encodedHeight,
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
  return { image, artifacts }
}

// Only read files within a detector's task directory, including when the OS resolves symlinks.
async function sourceBytes(directory: string, uri: string): Promise<Buffer> {
  if (isAbsolute(uri) || uri.includes('\\') || uri.split('/').includes('..'))
    throw new AppError('INFERENCE_FAILED', '模型附件路径无效。')
  const root = await realpath(directory),
    path = await realpath(resolve(root, uri))
  const difference = relative(root, path)
  if (isAbsolute(difference) || difference === '..' || difference.startsWith(`..${sep}`))
    throw new AppError('INFERENCE_FAILED', '模型附件越过任务目录。')
  return readFile(path)
}

export async function aggregateEvidence(args: {
  root: string
  output: string
  taskId: string
  contentType: ContentType
  detectors: DetectorResult[]
  common: Awaited<ReturnType<typeof prepareWorkflowInput>>
  elapsedMs: number
  flags: string[]
  signal: AbortSignal
  previousTaskId?: string
}) {
  const { common, detectors, output, signal } = args
  const assets: Json[] = [...common.artifacts],
    owned: Json[] = [],
    evidence: Json[] = [],
    regions: Json[] = [],
    records: Json[] = []
  const index = new Map(assets.map((a) => [a.artifactId, a]))
  for (const detector of detectors) {
    signal.throwIfAborted()
    if (detector.status !== 'completed') {
      records.push({
        backend: detector.backend,
        status: detector.status,
        error: detector.error ?? null,
        result: null
      })
      continue
    }
    const dto = detector.classification ?? detector.localization
    if (!dto) throw new AppError('INFERENCE_FAILED', '已完成模型缺少报告。')
    const raw = dto.bundle as Json,
      report = structuredClone(raw.reports[0]) as Json
    if (
      raw.image.imageId !== common.image.imageId ||
      raw.image.sha256 !== common.image.sha256 ||
      raw.image.width !== common.image.width ||
      raw.image.height !== common.image.height ||
      report.mode !== 'local'
    )
      throw new AppError('INFERENCE_FAILED', '模型报告图片身份或执行模式不一致。')
    const source = dirname(dto.bundlePath),
      prefix = `detectors/${detector.backend}`
    const modelArtifacts: Json[] = []
    for (const original of raw.artifacts as Json[]) {
      const data = await sourceBytes(source, original.uri)
      if (digest(data) !== original.sha256)
        throw new AppError('INFERENCE_FAILED', '模型附件哈希不一致。')
      if (index.has(original.artifactId)) {
        const shared = index.get(original.artifactId)!
        if (
          shared.sha256 !== original.sha256 ||
          shared.width !== original.width ||
          shared.height !== original.height
        )
          throw new AppError('INFERENCE_FAILED', '相同附件ID对应不同内容。')
        continue
      }
      const uri = `${prefix}/${original.uri}`
      await mkdir(dirname(join(output, uri)), { recursive: true })
      await writeFile(join(output, uri), data)
      const artifact: Json = { ...original, uri }
      assets.push(artifact)
      owned.push(artifact)
      modelArtifacts.push(artifact)
      index.set(artifact.artifactId, artifact)
    }
    report.artifacts = modelArtifacts
    if (report.extensions?.rawResponse) {
      const response = report.extensions.rawResponse
      const data = await sourceBytes(source, response.uri)
      if (digest(data) !== response.sha256)
        throw new AppError('INFERENCE_FAILED', '浮点响应哈希不一致。')
      const uri = `${prefix}/${response.uri}`
      await mkdir(dirname(join(output, uri)), { recursive: true })
      await writeFile(join(output, uri), data)
      response.uri = uri
    }
    const reportUri = `${prefix}/report.json`
    await mkdir(dirname(join(output, reportUri)), { recursive: true })
    await writeFile(join(output, reportUri), JSON.stringify(report, null, 2))
    records.push({
      backend: detector.backend,
      status: 'completed',
      reused: !!detector.reused,
      sourceTaskId: report.taskId,
      producer: report.producer,
      sourceReportUri: reportUri,
      sourceReportSha256: digest(await readFile(join(output, reportUri))),
      checkpointSha256: report.extensions?.checkpointSha256,
      result: {
        score: report.result.score,
        ...(report.result.classification ? { classification: report.result.classification } : {}),
        ...(detector.localization
          ? {
              regionCount: detector.localization.regionCount,
              areaFraction: detector.localization.manipulatedAreaFraction
            }
          : {})
      }
    })
    regions.push(
      ...(report.result.regions ?? []).map((region: Json) => ({
        ...region,
        detector: detector.backend
      }))
    )
    evidence.push(
      ...report.evidence.map((entry: Json) => ({
        ...entry,
        data: {
          ...entry.data,
          detector: detector.backend,
          producer: report.producer,
          sourceReportId: report.reportId
        }
      }))
    )
    if (detector.localization) {
      detector.regionPreviews = []
      for (const region of (report.result.regions ?? []).slice(0, 20)) {
        const crop = index.get(region.cropArtifactId)
        if (!crop) continue
        const png = await sharp(await readFile(join(output, crop.uri)))
          .resize({ width: 320, height: 180, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
        detector.regionPreviews.push({
          regionId: region.regionId,
          bboxXYWH: region.bboxXYWH,
          areaPixels: region.areaPixels ?? null,
          dataUrl: `data:image/png;base64,${png.toString('base64')}`
        })
      }
    }
  }
  const completed = detectors.filter((d) => d.status === 'completed').length
  const status =
    completed === 0
      ? 'failed'
      : detectors.some((d) => d.status === 'failed')
        ? 'partial'
        : 'completed'
  const timestamp = new Date().toISOString()
  const report = {
    schemaVersion: '1.0',
    reportId: `report-${randomUUID()}`,
    moduleId: 'manipulation',
    imageId: common.image.imageId,
    taskId: args.taskId,
    mode: 'local',
    status: completed ? 'completed' : 'failed',
    producer: { name: 'manipulation-workflow', version: '0.2.0' },
    createdAt: timestamp,
    elapsedMs: args.elapsedMs,
    inputReportIds: [],
    result: completed
      ? {
          decision: 'inconclusive',
          score: null,
          regions,
          operationHints: [],
          contentType: args.contentType,
          executionStatus: status,
          detectors: records,
          disagreements: args.flags
        }
      : null,
    evidence,
    artifacts: owned,
    limitations: [
      '整图筛查不证明具体局部篡改；定位响应和专家选择分数未经图像级校准。',
      '各模型掩码与分数独立保留，未进行平均或并集合并。',
      '本阶段未运行OCR、来源凭证、AI生成专用检测或VLM。'
    ],
    error: completed ? null : { code: 'ALL_DETECTORS_FAILED', message: '所有计划的检测均未完成。' },
    extensions: {
      executionStatus: status,
      detectorExecutions: records.map(({ result, ...item }) => item),
      previousTaskId: args.previousTaskId ?? null
    }
  }
  const bundle = {
    schemaVersion: '1.0',
    bundleId: `bundle-${randomUUID()}`,
    purpose: 'analysis',
    createdAt: timestamp,
    image: common.image,
    reports: [report],
    artifacts: assets
  }
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  const validate = ajv.compile(
    JSON.parse(await readFile(join(args.root, 'schemas/report-bundle.schema.json'), 'utf8'))
  )
  if (!validate(bundle))
    throw new AppError(
      'INFERENCE_FAILED',
      `联合证据包协议校验失败：${ajv.errorsText(validate.errors)}`
    )
  signal.throwIfAborted()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  signal.throwIfAborted()
  const summary = manipulationSummary(bundle, detectors)
  const validateSummary = ajv.compile(
    JSON.parse(await readFile(join(args.root, 'schemas/manipulation-summary.schema.json'), 'utf8'))
  )
  if (!validateSummary(summary))
    throw new AppError(
      'INFERENCE_FAILED',
      `简明报告校验失败：${ajv.errorsText(validateSummary.errors)}`
    )
  await writeFile(join(output, 'analysis.json'), JSON.stringify(summary, null, 2))
  signal.throwIfAborted()
  await writeFile(join(output, 'bundle.json'), JSON.stringify(bundle, null, 2))
  signal.throwIfAborted()
  return {
    bundle: bundle as Record<string, unknown>,
    summary: summary as Record<string, unknown>,
    status: status as 'completed' | 'partial' | 'failed'
  }
}
