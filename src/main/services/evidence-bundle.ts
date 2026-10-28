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
import { scanC2paManifestPresence } from './c2pa-presence'
import { inspectProvenanceSource } from './provenance-reader'
import { provenanceMetadataSummary } from './provenance-metadata'
import { inspectWatermarks } from './provenance-watermark'

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
type Json = Record<string, any>

export async function prepareWorkflowInput(
  input: ImportedImage,
  output: string,
  root: string,
  signal: AbortSignal
) {
  const started = performance.now()
  await mkdir(join(output, 'images'), { recursive: true })
  const hash = digest(input.originalBytes)
  if (input.asset.id !== `sha256:${hash}`) throw new AppError('INVALID_IMAGE', '原文件身份不一致。')
  const metadata = await sharp(input.originalBytes).metadata()
  const display = await sharp(input.originalBytes)
    .rotate()
    .toColourspace('srgb')
    .png()
    .toBuffer()
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
  const reportId = `report-${randomUUID()}`
  const credentials: Json = scanC2paManifestPresence(input.originalBytes, metadata.format)
  const sourceInspection = await inspectProvenanceSource({
    root,
    imagePath: join(output, originalUri),
    readC2pa: credentials.details.outcome === 'manifest_container_found',
    signal
  })
  signal.throwIfAborted()
  if (credentials.details.outcome === 'manifest_container_found') {
    credentials.details.reader = sourceInspection.c2pa ?? {
      status: sourceInspection.status,
      reason: sourceInspection.reason ?? null
    }
    credentials.details.signatureValidation =
      credentials.details.reader.status === 'completed'
        ? credentials.details.reader.validationState
        : 'not_run'
  }
  const watermark = await inspectWatermarks({
    root,
    originalPath: join(output, originalUri),
    displayPath: join(output, 'images/display.png'),
    exif: metadata.exif,
    xmp: metadata.xmp,
    iptc: metadata.iptc,
    signal
  })
  signal.throwIfAborted()
  const metadataSummary = provenanceMetadataSummary(metadata, sourceInspection.metadata ?? null, {
    status: sourceInspection.status,
    pythonVersion: sourceInspection.pythonVersion ?? null,
    pillowVersion: sourceInspection.pillowVersion ?? null,
    reason: sourceInspection.reason ?? null
  })
  const provenanceReport: Json = {
    schemaVersion: '1.0',
    reportId,
    moduleId: 'provenance',
    imageId: image.imageId,
    taskId: '',
    mode: 'local',
    status: 'completed',
    producer: { name: 'provenance-preprocessing', version: '0.1.0' },
    createdAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
    inputReportIds: [],
    result: {
      preprocessing: {
        originalPreserved: true,
        displayTransform: image.displayTransform,
        details: {
          originalSha256: image.sha256,
          encodedDimensions: [image.encodedWidth, image.encodedHeight],
          displayDimensions: [image.width, image.height],
          outputFormat: 'png',
          colourspace: 'srgb'
        }
      },
      metadata: {
        status: 'completed',
        details: metadataSummary
      },
      credentials,
      watermark
    },
    evidence: [
      {
        evidenceId: `${reportId}:preprocessing`,
        kind: 'image_preprocessing',
        origin: 'measured',
        description: '已按EXIF方向生成未缩放的sRGB PNG显示副本，原文件字节保持不变。',
        regionId: null,
        artifactIds: [image.originalArtifactId, image.displayArtifactId],
        data: {
          sha256: image.sha256,
          encodedDimensions: [image.encodedWidth, image.encodedHeight],
          displayDimensions: [image.width, image.height],
          exifOrientation: image.exifOrientation
        },
        limitation: '哈希和像素尺寸只证明输入/副本身份与处理记录，不证明内容来源真实。'
      },
      {
        evidenceId: `${reportId}:metadata`,
        kind: 'image_metadata_inventory',
        origin: 'measured',
        description: '记录解码器可读取的基础元数据区段与文件属性。',
        regionId: null,
        artifactIds: [image.originalArtifactId],
        data: metadataSummary,
        limitation: '元数据可被修改或剥离；字段缺失不证明图像经过伪造。'
      },
      {
        evidenceId: `${reportId}:credentials`,
        kind: 'c2pa_manifest_presence',
        origin: 'measured',
        description: (() => {
          switch (credentials.details.outcome) {
            case 'manifest_container_found':
              return '图片容器中发现C2PA清单存放标记；清单内容和签名状态见结构化结果。'
            case 'no_manifest_container_found':
              return '已扫描支持的嵌入位置，未发现C2PA清单存放标记。'
            case 'unsupported_format':
              return '当前容器格式不在C2PA存在性扫描支持范围内。'
            default:
              return 'C2PA容器结构无法完整扫描；不能据此判断清单是否存在。'
          }
        })(),
        regionId: null,
        artifactIds: [image.originalArtifactId],
        data: credentials.details,
        limitation: '清单标记存在不等于签名有效或签发者可信；未发现嵌入清单不排除外部凭证。'
      },
      {
        evidenceId: `${reportId}:watermark`,
        kind: 'watermark_detection',
        origin: 'measured',
        description: (() => {
          const visibleCount = watermark.details.detectors.visible.candidates?.length ?? 0
          const visibleStatus = watermark.details.detectors.visible.status
          const sdxlStatus =
            watermark.details.detectors.invisible.outcome ??
            watermark.details.detectors.invisible.status
          const sdxlMatched = sdxlStatus === 'candidate_signature_match'
          const metadataCount = watermark.details.candidateMarkers.length
          if (visibleCount || sdxlMatched || metadataCount)
            return `水印检查得到候选线索：可见文字 ${visibleCount} 项（${visibleStatus}）、SDXL载荷检查状态 ${sdxlStatus}、元数据标记 ${metadataCount} 项。`
          if (watermark.details.combinedOutcome === 'some_pixel_checks_unavailable')
            return '部分水印检查未能运行；请查看每个子检查的状态，不能将其视为未发现。'
          return '已执行当前支持的水印子检查，未匹配已知线索；这不代表没有其他水印。'
        })(),
        regionId: null,
        artifactIds: [image.originalArtifactId, image.displayArtifactId],
        data: watermark.details,
        limitation:
          'OCR文字匹配不等于确认水印；隐形载荷只覆盖公开的SDXL固定配置。未检出不代表没有其他可见、隐形或外部水印。'
      }
    ],
    artifacts: [],
    limitations: [
      '基础元数据字段只用于记录文件属性，不代表来源真实性。',
      'C2PA读取器缺失或容器不含内嵌清单时，签名与信任链未验证。水印检查只覆盖已列明的OCR关键词和SDXL固定载荷，不覆盖SynthID或所有隐形水印。'
    ],
    extensions: {
      mediaInput: { kind: 'image', frame: null }
    },
    error: null
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
  return { image, artifacts, provenanceReport }
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
  common.provenanceReport.taskId = args.taskId
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
      '篡改检测报告不运行通用OCR、来源凭证、专用AIGC检测或VLM；来源与水印检查见独立provenance报告。'
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
    reports: [report, common.provenanceReport],
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
  await mkdir(join(output, 'reports'), { recursive: true })
  await writeFile(
    join(output, 'reports/provenance.json'),
    JSON.stringify(common.provenanceReport, null, 2)
  )
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
