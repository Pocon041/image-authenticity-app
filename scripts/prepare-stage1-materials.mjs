import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback)
const selectionPath = resolve(project, option('--selection', 'examples/local-selection.json'))
const selection = JSON.parse((await readFile(selectionPath, 'utf8')).replace(/^\uFEFF/, ''))
const output = resolve(project, option('--output', 'examples/stage1-materials'))
const staging = resolve(project, 'work', `stage1-materials-${Date.now()}`)
const exampleId =
  selection.exampleCaseId ??
  selection.cases.find((item) => item.kind === 'tampered')?.caseId ??
  selection.cases[0]?.caseId
if (!selection.cases.some((item) => item.caseId === exampleId))
  throw new Error('Select one valid exampleCaseId')

// Generate intermediate artifacts once, then publish only one VLM JSON and a TSV catalog.
const prepare = spawnSync(
  process.execPath,
  [
    join(project, 'scripts/prepare-report-examples.mjs'),
    '--selection',
    selectionPath,
    '--output',
    staging
  ],
  { stdio: 'inherit' }
)
if (prepare.status !== 0) process.exit(prepare.status ?? 1)
await mkdir(output, { recursive: true })
const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'))
const copy = async (from, to) => {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}
const cells = (value) => String(value ?? '').replace(/[\t\r\n]/g, ' ')
const header = [
  'sampleId',
  'kind',
  'category',
  'typeBasis',
  'dataset',
  'generator',
  'pairId',
  'imageId',
  'originalUri',
  'originalSha256',
  'encodedWidth',
  'encodedHeight',
  'displayUri',
  'displaySha256',
  'width',
  'height',
  'exifOrientation',
  'annotationUri',
  'annotationSha256',
  'annotationCoordinateSpace',
  'annotationEncoding',
  'sourceImage',
  'sourceMask',
  'sourceManifest',
  'sourceUrl'
]
const rows = []
for (const item of selection.cases) {
  const sourceDirectory = join(staging, item.caseId)
  const bundle = await readJSON(join(sourceDirectory, 'bundle.json'))
  const truth = await readJSON(join(sourceDirectory, 'ground-truth.json'))
  const source = await readJSON(join(sourceDirectory, 'source-record.json'))
  const original = bundle.artifacts.find(
    (asset) => asset.artifactId === bundle.image.originalArtifactId
  )
  const display = bundle.artifacts.find(
    (asset) => asset.artifactId === bundle.image.displayArtifactId
  )
  for (const asset of [original, display])
    await copy(join(sourceDirectory, asset.uri), join(output, item.caseId, asset.uri))
  if (truth.mask)
    await copy(join(sourceDirectory, truth.mask.uri), join(output, item.caseId, truth.mask.uri))
  rows.push({
    sampleId: item.caseId,
    kind: item.kind,
    category: item.category ?? item.kind,
    typeBasis: item.typeBasis ?? 'selection_manifest',
    dataset: item.dataset,
    generator: item.generator ?? '',
    pairId: item.pairId ?? '',
    imageId: bundle.image.imageId,
    originalUri: `${item.caseId}/${original.uri}`,
    originalSha256: original.sha256,
    encodedWidth: bundle.image.encodedWidth,
    encodedHeight: bundle.image.encodedHeight,
    displayUri: `${item.caseId}/${display.uri}`,
    displaySha256: display.sha256,
    width: bundle.image.width,
    height: bundle.image.height,
    exifOrientation: bundle.image.exifOrientation,
    annotationUri: truth.mask ? `${item.caseId}/${truth.mask.uri}` : '',
    annotationSha256: truth.mask?.sha256 ?? '',
    annotationCoordinateSpace: truth.mask?.coordinateSpace ?? '',
    annotationEncoding: truth.mask
      ? 'dataset_native_unmodified; IMD2020_JPEG_threshold_128_if_used'
      : '',
    sourceImage: source.sourceImage,
    sourceMask: source.sourceMask ?? '',
    sourceManifest: source.sourceManifest ?? '',
    sourceUrl: source.sourceUrl
  })
  if (item.caseId === exampleId) {
    const input = await readJSON(join(sourceDirectory, 'vlm-input.json'))
    for (const asset of input.artifacts) {
      if (!['original', 'display'].includes(asset.type))
        await copy(join(sourceDirectory, asset.uri), join(output, item.caseId, asset.uri))
      asset.uri = `${item.caseId}/${asset.uri}`
    }
    for (const report of input.reports) {
      for (const asset of report.artifacts) asset.uri = `${item.caseId}/${asset.uri}`
    }
    await writeFile(join(output, 'vlm-input.example.json'), JSON.stringify(input, null, 2) + '\n')
  }
}
await writeFile(
  join(output, 'manifest.tsv'),
  '\uFEFF' +
    [header.join('\t'), ...rows.map((row) => header.map((key) => cells(row[key])).join('\t'))].join(
      '\n'
    ) +
    '\n'
)
await writeFile(
  join(output, 'MATERIALS.md'),
  `# 第一阶段材料包\n\n按类型少量取样，共 ${rows.length} 张原文件。清单为 manifest.tsv。数据集标签和真值仅在清单与 annotations 中，不能作为待测图像的推理证据。\n\n唯一的 VLM 输入示例为 vlm-input.example.json，针对 ${exampleId}，只包含前三个模块。它引用的分类分数、定位矩形和热图均为 mock；文件哈希和尺寸来自实际读取。未执行来源凭证、水印检测或任何模型。\n\n附件 URI 相对于本材料包根目录。不要将 manifest.tsv、annotations 或预置答案一并提供给 VLM。\n\n## 覆盖\n\n${rows.map((row) => `- ${row.sampleId}: ${row.category} / ${row.dataset}${row.generator ? ` / ${row.generator}` : ''}${row.pairId ? ` / ${row.pairId}` : ''}`).join('\n')}\n\n## 边界\n\nIMD2020 样例来自本机已有的 Yu2018 生成式修复子集，不代表覆盖完整 IMD2020。CASIA 的拼接与复制移动标签依据本地清单、Tp_D / Tp_S 命名及 source_ids；它们不是模型预测。七个生成器来源也不代表七类互斥图像真实性结论。当前没有已验证的来源凭证或水印阳性样本，也没有多步编辑真值案例。\n\n原文件字节保留，显示副本按 EXIF 校正且不缩放。原生标注原样保存；IMD2020 原生掩码为 JPEG，使用时应参考其 128 阈值，不能将 JPEG 灰度值误认为严格二值。\n\n样例用于内部联调，不作为检测性能证明。源数据的使用条件仍以原数据集为准。\n`
)
console.log(
  `Prepared ${rows.length} varied source images, 1 VLM input JSON, and TSV catalog in ${output}`
)
