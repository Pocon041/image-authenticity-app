import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  if (!args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`Missing value for ${name}`)
  return args[index + 1]
}
const selectionPath = resolve(project, option('--selection', 'examples/local-selection.json'))
const outputRoot = resolve(project, option('--output', 'examples/local-data'))
const selection = JSON.parse((await readFile(selectionPath, 'utf8')).replace(/^\uFEFF/, ''))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n')
}
const seen = new Set()
const summary = []

for (const item of selection.cases) {
  if (!/^[a-z0-9-]+$/.test(item.caseId) || seen.has(item.caseId))
    throw new Error('Case IDs must be unique safe directory names')
  seen.add(item.caseId)
  if (!['real', 'tampered', 'ai_generated'].includes(item.kind))
    throw new Error(`Unknown fixture kind: ${item.kind}`)
  const sourcePath = isAbsolute(item.sourceImage)
    ? item.sourceImage
    : resolve(dirname(selectionPath), item.sourceImage)
  const original = await readFile(sourcePath)
  const originalHash = sha256(original)
  const metadata = await sharp(original, { limitInputPixels: 60_000_000 }).metadata()
  if (!['jpeg', 'png', 'webp'].includes(metadata.format))
    throw new Error(`Unsupported sample format: ${sourcePath}`)
  const directory = join(outputRoot, item.caseId)
  await mkdir(join(directory, 'images'), { recursive: true })
  await mkdir(join(directory, 'artifacts'), { recursive: true })
  const originalUri = `images/original${extname(sourcePath).toLowerCase()}`
  await writeFile(join(directory, originalUri), original)
  const canonical = await sharp(original).rotate().toColourspace('srgb').png().toBuffer()
  const displayInfo = await sharp(canonical).metadata()
  const width = displayInfo.width,
    height = displayInfo.height
  await writeFile(join(directory, 'images/display.png'), canonical)
  const imageId = `sha256:${originalHash}`
  const makeArtifact = async (id, type, uri, origin, space, bbox = null, parent = null) => {
    const bytes = await readFile(join(directory, uri))
    const info = await sharp(bytes).metadata()
    return {
      artifactId: id,
      type,
      uri,
      mediaType: `image/${info.format === 'jpeg' ? 'jpeg' : info.format}`,
      sha256: sha256(bytes),
      width: info.width,
      height: info.height,
      coordinateSpace: space,
      bboxXYWH: bbox,
      sourceArtifactId: parent,
      origin
    }
  }
  const originalArtifact = await makeArtifact(
    `${item.caseId}-original`,
    'original',
    originalUri,
    'original',
    'encoded_file_pixels'
  )
  const displayArtifact = await makeArtifact(
    `${item.caseId}-display`,
    'display',
    'images/display.png',
    'derived',
    'display_image_pixels',
    null,
    originalArtifact.artifactId
  )
  const artifacts = [originalArtifact, displayArtifact]
  const image = {
    imageId,
    sha256: originalHash,
    originalArtifactId: originalArtifact.artifactId,
    displayArtifactId: displayArtifact.artifactId,
    encodedWidth: metadata.width,
    encodedHeight: metadata.height,
    width,
    height,
    exifOrientation: metadata.orientation ?? 1,
    coordinateSpace: 'display_image_pixels',
    displayTransform: 'exif_auto_orient_no_resize'
  }
  const timestamp = new Date().toISOString()
  const report = (moduleId) => ({
    schemaVersion: '1.0',
    reportId: `report-${randomUUID()}`,
    moduleId,
    imageId,
    taskId: `task-${randomUUID()}`,
    mode: 'mock',
    status: 'completed',
    producer: { name: 'integration-fixture-template', version: '1.0.0' },
    createdAt: timestamp,
    elapsedMs: 0,
    inputReportIds: [],
    result: null,
    evidence: [],
    artifacts: [],
    limitations: ['接口联调样例：未运行检测模型或 VLM，不能用作检测效果或真实性证明。'],
    error: null
  })
  const evidence = (owner, kind, origin, description, regionId, artifactIds, data, limitation) => ({
    evidenceId: `${owner.reportId}:e${owner.evidence.length + 1}`,
    kind,
    origin,
    description,
    regionId,
    artifactIds,
    data,
    limitation
  })

  const provenance = report('provenance')
  provenance.result = {
    preprocessing: { originalPreserved: true, displayTransform: image.displayTransform },
    metadata: {
      status: 'not_run',
      details: { reason: '仅提取了图片身份和解码信息，尚未实现元数据取证模块。' }
    },
    credentials: {
      status: 'not_run',
      details: { reason: '未执行来源凭证验证；不能解释为凭证不存在。' }
    },
    watermark: { status: 'not_run', details: { reason: '未执行水印检测；不能解释为没有水印。' } }
  }
  provenance.evidence.push(
    evidence(
      provenance,
      'file_identity',
      'measured',
      '原始字节已复制保留，SHA256 已计算；显示副本仅校正 EXIF 方向、转换为 sRGB PNG，不缩放。',
      null,
      [originalArtifact.artifactId, displayArtifact.artifactId],
      { originalSha256: originalHash, byteLength: original.length, width, height },
      '文件身份和解码信息不构成图像真实性判断。'
    )
  )

  const manipulation = report('manipulation')
  const suspicious = item.kind === 'tampered'
  const regions = []
  if (suspicious) {
    const x = Math.floor(width * 0.3),
      y = Math.floor(height * 0.25)
    const cropWidth = Math.max(1, Math.floor(width * 0.35)),
      cropHeight = Math.max(1, Math.floor(height * 0.4))
    const bbox = [x, y, cropWidth, cropHeight]
    const pixels = Buffer.alloc(width * height)
    const intensities = Buffer.alloc(width * height)
    for (let row = y; row < y + cropHeight; row++) {
      pixels.fill(255, row * width + x, row * width + x + cropWidth)
      intensities.fill(200, row * width + x, row * width + x + cropWidth)
    }
    await sharp(pixels, { raw: { width, height, channels: 1 } })
      .png()
      .toFile(join(directory, 'artifacts/mock-mask.png'))
    await sharp(intensities, { raw: { width, height, channels: 1 } })
      .png()
      .toFile(join(directory, 'artifacts/mock-heatmap.png'))
    await sharp(canonical)
      .extract({ left: x, top: y, width: cropWidth, height: cropHeight })
      .png()
      .toFile(join(directory, 'artifacts/mock-region-crop.png'))
    const mask = await makeArtifact(
      `${item.caseId}-mock-mask`,
      'mask',
      'artifacts/mock-mask.png',
      'mock',
      'display_image_pixels',
      null,
      displayArtifact.artifactId
    )
    const heatmap = await makeArtifact(
      `${item.caseId}-mock-heatmap`,
      'heatmap',
      'artifacts/mock-heatmap.png',
      'mock',
      'display_image_pixels',
      null,
      displayArtifact.artifactId
    )
    const crop = await makeArtifact(
      `${item.caseId}-mock-crop`,
      'crop',
      'artifacts/mock-region-crop.png',
      'derived',
      'region_local_pixels',
      bbox,
      displayArtifact.artifactId
    )
    artifacts.push(mask, heatmap, crop)
    manipulation.artifacts.push(mask, heatmap, crop)
    regions.push({
      regionId: `${item.caseId}-region-001`,
      bboxXYWH: bbox,
      coordinateSpace: 'display_image_pixels',
      maskArtifactId: mask.artifactId
    })
    manipulation.evidence.push(
      evidence(
        manipulation,
        'mock_region_response',
        'mock',
        '此矩形区域和热图为按固定比例生成的联调占位，不是检测器定位，也不是数据集真值。',
        regions[0].regionId,
        [mask.artifactId, heatmap.artifactId, crop.artifactId],
        {
          heatmapEncoding: 'gray8_intensity',
          range: [0, 255],
          positiveMeans: 'higher_mock_response'
        },
        '区域与分数均为模拟内容，不能据此说明实际篡改位置或编辑手段。'
      )
    )
  } else {
    manipulation.evidence.push(
      evidence(
        manipulation,
        'mock_classification',
        'mock',
        '模拟分支返回未检出局部异常，用于演示无区域结果的报告格式。',
        null,
        [],
        {},
        '未运行篡改检测方法，不能据此认定图片没有被篡改。'
      )
    )
  }
  manipulation.result = {
    decision: suspicious ? 'suspicious' : 'no_anomaly_detected',
    score: {
      name: 'mock_tamper_score',
      value: suspicious ? 0.84 : 0.12,
      positiveClass: 'tampered',
      calibrated: false
    },
    regions,
    operationHints: []
  }
  const aigc = report('aigc')
  aigc.result = {
    decision: item.kind === 'ai_generated' ? 'ai_generated' : 'non_ai',
    score: {
      name: 'mock_ai_score',
      value: item.kind === 'ai_generated' ? 0.91 : 0.18,
      positiveClass: 'ai_generated',
      calibrated: false
    },
    clues: []
  }
  aigc.evidence.push(
    evidence(
      aigc,
      'mock_classification',
      'mock',
      '这是预设分类和分数的格式演示，没有执行 AI 生成检测，也没有生成真实解释线索。',
      null,
      [],
      { scoreName: aigc.result.score.name, value: aigc.result.score.value },
      '模拟分数不是生成概率；分类标签由样例配置选择，不来自模型预测。'
    )
  )
  const explanation = report('explanation')
  explanation.inputReportIds = [provenance.reportId, manipulation.reportId, aigc.reportId]
  explanation.result = {
    finalDecision: 'inconclusive',
    confidence: { value: null, source: 'unavailable', calibrated: false },
    analysis: `此图片的规范显示尺寸为 ${width} × ${height}，原始文件已保留并计算哈希。来源凭证与水印检查尚未执行。分类、区域和热图属于模拟联调数据，未运行任何检测模型或 VLM，因此当前不能作出真实性判断。`,
    claims: [
      {
        text: '已记录原文件身份和规范显示尺寸。',
        evidenceIds: [provenance.evidence[0].evidenceId]
      },
      {
        text: '当前检测输出均为模拟内容，真实性结论保留为证据不足。',
        evidenceIds: [manipulation.evidence[0].evidenceId, aigc.evidence[0].evidenceId]
      }
    ],
    unresolved: ['需要实际来源信息分析、篡改检测、AI 检测及 VLM 调用后，才能形成真实分析报告。']
  }
  const reports = [provenance, manipulation, aigc, explanation]
  const bundle = {
    schemaVersion: '1.0',
    bundleId: `bundle-${randomUUID()}`,
    purpose: 'integration_fixture',
    createdAt: timestamp,
    image,
    reports,
    artifacts
  }
  for (const entry of reports) await json(join(directory, `reports/${entry.moduleId}.json`), entry)
  await json(join(directory, 'bundle.json'), bundle)
  await json(join(directory, 'vlm-input.json'), {
    ...bundle,
    bundleId: `input-${randomUUID()}`,
    reports: reports.slice(0, 3)
  })
  // Dataset labels and annotations are deliberately outside the VLM evidence bundle.
  const truth = {
    usage: 'dataset_annotation_not_detector_output',
    datasetLabel: item.kind,
    mask: null
  }
  if (item.sourceMask) {
    const sourceMask = isAbsolute(item.sourceMask)
      ? item.sourceMask
      : resolve(dirname(selectionPath), item.sourceMask)
    const bytes = await readFile(sourceMask)
    const maskInfo = await sharp(bytes).metadata()
    if (maskInfo.width !== metadata.width || maskInfo.height !== metadata.height)
      throw new Error('Dataset mask does not match encoded image dimensions')
    await mkdir(join(directory, 'annotations'), { recursive: true })
    const uri = `annotations/dataset-mask${extname(sourceMask).toLowerCase()}`
    await writeFile(join(directory, uri), bytes)
    truth.mask = {
      uri,
      sha256: sha256(bytes),
      width: maskInfo.width,
      height: maskInfo.height,
      coordinateSpace: 'encoded_file_pixels',
      encoding: 'dataset_native_unmodified'
    }
  }
  await json(join(directory, 'ground-truth.json'), truth)
  await json(join(directory, 'source-record.json'), {
    usage: 'local_dataset_provenance_not_vlm_input',
    sourceImage: sourcePath,
    sourceMask: item.sourceMask,
    sourceManifest: item.sourceManifest ?? null,
    dataset: item.dataset,
    sourceUrl: item.sourceUrl,
    sourceSha256: originalHash,
    selectionMethod: 'explicit_samples_for_integration_only',
    redistribution:
      'Local fixture package only; no permission to publicly redistribute is asserted.'
  })
  summary.push({
    caseId: item.caseId,
    imageId,
    dataset: item.dataset,
    datasetLabel: item.kind,
    width,
    height,
    bundle: `${item.caseId}/bundle.json`,
    vlmInput: `${item.caseId}/vlm-input.json`
  })
  console.log(`Prepared ${item.caseId}: ${width}x${height}, original hash verified`)
}
await json(join(outputRoot, 'manifest.json'), {
  purpose: 'integration_fixture',
  noModelWasRun: true,
  cases: summary
})
console.log(`Prepared ${summary.length} cases in ${outputRoot}`)
