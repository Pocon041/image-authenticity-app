import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  EvidenceBundle,
  ExplanationReport,
  ModuleReport,
  ExplanationResult,
  ExplanationClaim,
  Confidence,
  FinalDecision,
  ProvenanceReport,
  ManipulationReport,
  AigcReport,
  Evidence,
  Artifact
} from '../../shared/protocol'
import type { Region } from '../../shared/protocol'
import { validateExplanationReport } from '../../shared/protocol'
import { sicaClassSupport, fsdClassSupport } from '../../shared/decision-confidence'
import { observeRegions, type RegionObservation } from './visual-observation'
import {
  USER_EXPLANATION_SYSTEM,
  USER_EXPLANATION_SCHEMA,
  parseUserExplanation,
  type UserExplanation
} from './user-explanation'

export interface ExplanationConfig {
  model: string
  host: string
  numCtx: number
  numPredict: number
  maxImages: number
}

/**
 * 内置兜底配置：配置文件、环境变量全缺失时仍能跑。
 * 数值说明见 config/explanation.example.json 的 `_comment` 字段。
 */
const BUILTIN_CONFIG: ExplanationConfig = {
  // Local Ollama tag created from Qwen/Qwen3-VL-2B-Instruct-GGUF.
  // A remote model name and host remain supported through config or explicit arguments.
  model: 'srdp-qwen3-vl-2b',
  host: 'http://127.0.0.1:11434',
  numCtx: 8192,
  // 简短摘要、权衡与最多三个区域；格式扩展后需重新检查输出预算。
  numPredict: 1200,
  // 整图及最多两个定位器掩码。
  maxImages: 3
}

const UNAVAILABLE_CONFIDENCE: Confidence = {
  value: null,
  source: 'unavailable',
  calibrated: false
}

type ClaimCategory = 'aigc' | 'classification' | 'localization' | 'provenance'

interface CategorizedClaim {
  category: ClaimCategory
  claim: ExplanationClaim
}

// 模型根据图片与结构化证据给出面向用户的综合判断。
const SYSTEM_PROMPT = USER_EXPLANATION_SYSTEM

/**
 * 第四人核心服务：消费证据包，生成解释报告。
 *
 * VLM给出独立定性判断和简洁区域解释；代码映射区域与证据引用。
 * 原始检测结论和技术指标保留，失败时返回明确标记的基础说明。
 */
export async function generateExplanation(
  bundle: EvidenceBundle,
  taskId: string,
  modelName?: string,
  ollamaHost?: string
): Promise<ExplanationReport> {
  const startTime = performance.now()
  const taskDirectory = join(process.cwd(), 'work/analysis-runs', taskId)

  // 配置：显式参数 > 环境变量 > local（或 SRDP_EXPLANATION_CONFIG 指定的文件）> example > 内置默认。
  // 每次调用读一次，不缓存：改 JSON 后下一次分析立即生效，不用重启应用。
  const config = await loadExplanationConfig(modelName, ollamaHost)
  const requestSignal = AbortSignal.timeout(120000)

  // 1. 提取上游报告
  const upstreamReports = bundle.reports
  const provenanceReport = upstreamReports.find(
    (report): report is ProvenanceReport => report.moduleId === 'provenance'
  )
  const manipulationReport = upstreamReports.find(
    (report): report is ManipulationReport => report.moduleId === 'manipulation'
  )
  const aigcReport = upstreamReports.find(
    (report): report is AigcReport => report.moduleId === 'aigc'
  )

  // 上游事实用于追溯，不固定模型的综合判断。
  const upstreamDecision = deriveFinalDecision(manipulationReport)
  const categorizedClaims = buildClaims(provenanceReport, manipulationReport, aigcReport)
  const claims = categorizedClaims.map((item) => item.claim)
  const unresolved = buildUnresolved(
    provenanceReport,
    manipulationReport,
    aigcReport,
    upstreamDecision
  )
  const disagreements = getDisagreements(manipulationReport)
  const selectedRegions = [...(manipulationReport?.result?.regions ?? [])]
    .sort(
      (a, b) =>
        Number(b.areaPixels ?? b.bboxXYWH[2] * b.bboxXYWH[3]) -
        Number(a.areaPixels ?? a.bboxXYWH[2] * a.bboxXYWH[3])
    )
    .filter((region) => regionEvidenceIds(region, manipulationReport).length > 0)
    .slice(0, 3)
  const aliases = selectedRegions.map((_, index) => String.fromCharCode(65 + index))

  // 整图、预测掩码与简洁JSON。
  const { images, references } = await prepareImages(
    bundle,
    taskDirectory,
    config.maxImages,
    selectedRegions
  )
  console.log(`[explanation-images] maxImages=${config.maxImages} sent=${images.length}`)
  const fullImageIndex = references.findIndex((reference) => reference.role === 'full_image')
  const observations =
    fullImageIndex >= 0
      ? await observeRegions({
          directory: taskDirectory,
          full: Buffer.from(images[fullImageIndex], 'base64'),
          regions: selectedRegions,
          artifacts: bundle.artifacts,
          model: config.model,
          host: config.host,
          numCtx: config.numCtx,
          signal: requestSignal
        })
      : []
  const prompt = buildPrompt(
    upstreamDecision,
    categorizedClaims,
    disagreements,
    manipulationReport,
    aigcReport,
    selectedRegions,
    references,
    bundle.image.width,
    observations,
    provenanceReport
  )

  // 模型给出自己的定性判断；格式失败或超时时提供基础说明。
  let answer: UserExplanation = {
    finalDecision: upstreamDecision,
    summary: selectedRegions.length
      ? '检查已标记出值得关注的局部区域，可以先查看图片中的标记位置。'
      : '图片检查已完成，检测结果已保存。',
    evidenceBalance: '综合说明暂未生成，已完成的检测结果仍可查看。',
    regions: []
  }
  let mode: 'local' | 'mock' = 'local'
  let producerName = `ollama:${config.model}`
  let errorMsg: string | null = null
  const rawJudgements: unknown[] = []

  try {
    answer = await generateAnalysis(prompt, images, config, aliases, rawJudgements, requestSignal)
  } catch (error) {
    console.warn('VLM 调用或校验失败，降级为规则模板:', error)
    mode = 'mock'
    producerName = 'template-fallback'
    errorMsg = error instanceof Error ? error.message : String(error)
  }

  const regionAnalyses = answer.regions.map((region) => {
    const source = selectedRegions[aliases.indexOf(region.regionId)]
    return {
      ...region,
      location:
        region.location ||
        (source.bboxXYWH[0] + source.bboxXYWH[2] / 2 > (bundle.image.width * 2) / 3
          ? '图片右侧'
          : source.bboxXYWH[0] + source.bboxXYWH[2] / 2 < bundle.image.width / 3
            ? '图片左侧'
            : '图片中部'),
      regionId: source.regionId,
      evidenceIds: regionEvidenceIds(source, manipulationReport),
      operationSource: 'vlm_hypothesis' as const
    }
  })

  const result: ExplanationResult = {
    finalDecision: answer.finalDecision,
    decisionSource: mode === 'local' ? 'vlm' : 'rule_fallback',
    upstreamDecision,
    confidence: UNAVAILABLE_CONFIDENCE,
    analysis: answer.summary,
    evidenceBalance: answer.evidenceBalance,
    regionAnalyses,
    primaryRegionId: answer.primaryRegionId
      ? (selectedRegions[aliases.indexOf(answer.primaryRegionId)]?.regionId ?? null)
      : null,
    claims,
    unresolved
  }

  // 5. 构建并校验最终报告
  const report = buildReport(
    bundle,
    taskId,
    result,
    producerName,
    mode,
    startTime,
    upstreamReports,
    errorMsg
  )
  report.extensions = {
    visualObservations: observations,
    pipeline: 'region_observation_then_evidence_synthesis',
    rawJudgements
  }

  const validationErrors = validateExplanationReport(report, upstreamReports)
  if (validationErrors.length > 0) {
    throw new Error(`解释报告校验失败：${validationErrors.join('; ')}`)
  }

  return report
}

// --- 配置加载 ---

interface ConfigLayer {
  source: string
  values: Partial<ExplanationConfig>
}

/**
 * 读取解释模块配置。文件缺失/JSON 非法/字段类型不对都只丢弃该字段，不抛错；
 * 只有"显式参数"非法时才抛错——静默回退会掩盖调用方 bug，等同伪造配置。
 */
async function loadExplanationConfig(
  explicitModel?: string,
  explicitHost?: string
): Promise<ExplanationConfig> {
  const root = process.cwd()
  // SRDP_EXPLANATION_CONFIG 的语义与 SRDP_RITA_CONFIG 一致：替换 local 文件路径，不新增配置层。
  const localPath = process.env.SRDP_EXPLANATION_CONFIG
    ? resolve(root, process.env.SRDP_EXPLANATION_CONFIG)
    : join(root, 'config', 'explanation.local.json')

  const explicit: Partial<ExplanationConfig> = {}
  if (explicitModel !== undefined) {
    explicit.model = requireExplicitString(explicitModel, 'modelName')
  }
  if (explicitHost !== undefined) {
    explicit.host = requireExplicitHost(explicitHost, 'ollamaHost')
  }

  // 数组顺序即优先级升序：后面的层覆盖前面的层（逐字段）。
  const layers: ConfigLayer[] = [
    { source: 'builtin', values: BUILTIN_CONFIG },
    {
      source: 'config/explanation.example.json',
      values: await readExplanationConfigFile(join(root, 'config', 'explanation.example.json'))
    },
    { source: localPath, values: await readExplanationConfigFile(localPath) },
    { source: 'env', values: readEnvConfig() },
    { source: 'explicit', values: explicit }
  ]

  const model = pickField(layers, 'model')
  const host = pickField(layers, 'host')
  const numCtx = pickField(layers, 'numCtx')
  const numPredict = pickField(layers, 'numPredict')
  const maxImages = pickField(layers, 'maxImages')

  console.log(
    `[explanation-config] model=${model.value} (${model.source}) host=${host.value} (${host.source}) ` +
      `numCtx=${numCtx.value} (${numCtx.source}) numPredict=${numPredict.value} (${numPredict.source}) ` +
      `maxImages=${maxImages.value} (${maxImages.source})`
  )

  return {
    model: model.value,
    host: host.value,
    numCtx: numCtx.value,
    numPredict: numPredict.value,
    maxImages: maxImages.value
  }
}

function pickField<K extends keyof ExplanationConfig>(
  layers: ConfigLayer[],
  field: K
): { value: ExplanationConfig[K]; source: string } {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const value = layers[i].values[field]
    if (value !== undefined) {
      return { value: value as ExplanationConfig[K], source: layers[i].source }
    }
  }
  // builtin 层永远有值，理论上到不了这里。
  throw new Error(`解释配置字段 ${field} 没有可用取值`)
}

async function readExplanationConfigFile(path: string): Promise<Partial<ExplanationConfig>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    // local 缺失是常态；只有"存在但读不了"才值得提示。
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[explanation-config] 读取 ${path} 失败，跳过该层：`, error)
    }
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    console.warn(`[explanation-config] ${path} 不是合法 JSON，跳过该层`)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn(`[explanation-config] ${path} 顶层不是对象，跳过该层`)
    return {}
  }

  const record = parsed as Record<string, unknown>
  const values: Partial<ExplanationConfig> = {}

  const model = normalizeModel(record.model, path)
  if (model) values.model = model
  const host = normalizeHost(record.host, path)
  if (host) values.host = host
  const numCtx = normalizePositiveInt(record.numCtx, 'numCtx', path)
  if (numCtx) values.numCtx = numCtx
  const numPredict = normalizePositiveInt(record.numPredict, 'numPredict', path)
  if (numPredict) values.numPredict = numPredict
  const maxImages = normalizePositiveInt(record.maxImages, 'maxImages', path)
  if (maxImages) values.maxImages = maxImages

  return values
}

function readEnvConfig(): Partial<ExplanationConfig> {
  const values: Partial<ExplanationConfig> = {}
  // 只支持 OLLAMA_HOST（Ollama 官方变量，客户端也读它）。
  // 不提供 OLLAMA_MODEL：模型选择属于本模块配置，避免和 Ollama 自身变量混淆。
  // Ollama 官方习惯写 127.0.0.1:11434（无协议头），normalizeHost 会补 http://。
  const host = normalizeHost(process.env.OLLAMA_HOST, 'env OLLAMA_HOST')
  if (host) values.host = host
  return values
}

function normalizeModel(value: unknown, source: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.trim() === '') {
    console.warn(`[explanation-config] ${source} 的 model 不是非空字符串，忽略该字段`)
    return null
  }
  return value.trim()
}

function normalizeHost(value: unknown, source: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.trim() === '') {
    console.warn(`[explanation-config] ${source} 的 host 不是非空字符串，忽略该字段`)
    return null
  }
  const raw = value.trim()
  const withScheme = raw.includes('://') ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.warn(`[explanation-config] ${source} 的 host 协议只支持 http/https，忽略该字段`)
      return null
    }
  } catch {
    console.warn(`[explanation-config] ${source} 的 host 不是合法 URL，忽略该字段`)
    return null
  }
  // 去掉尾斜杠，避免拼出 //api/chat
  return withScheme.replace(/\/+$/, '')
}

function normalizePositiveInt(value: unknown, field: string, source: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    console.warn(`[explanation-config] ${source} 的 ${field} 必须是正整数，忽略该字段`)
    return null
  }
  return value
}

function requireExplicitString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`显式参数 ${name} 必须是非空字符串，实际收到 ${JSON.stringify(value)}`)
  }
  return value.trim()
}

function requireExplicitHost(value: unknown, name: string): string {
  const raw = requireExplicitString(value, name)
  const withScheme = raw.includes('://') ? raw : `http://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(`显式参数 ${name} 不是合法 URL：${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`显式参数 ${name} 的协议只支持 http/https：${raw}`)
  }
  return withScheme.replace(/\/+$/, '')
}

// --- 报告装配 ---

function buildReport(
  bundle: EvidenceBundle,
  taskId: string,
  result: ExplanationResult,
  producerName: string,
  mode: 'local' | 'mock',
  startTime: number,
  inputReports: ModuleReport[],
  errorMsg: string | null = null
): ExplanationReport {
  const usedReportIds = inputReports
    .filter((report) => ['provenance', 'manipulation', 'aigc'].includes(report.moduleId))
    .map((report) => report.reportId)

  return {
    schemaVersion: '1.0',
    reportId: `explanation-${crypto.randomUUID()}`,
    imageId: bundle.image.imageId,
    taskId,
    moduleId: 'explanation',
    mode,
    status: 'completed',
    producer: { name: producerName, version: '1.0.0' },
    createdAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startTime),
    inputReportIds: usedReportIds,
    result,
    evidence: [],
    artifacts: [],
    limitations: errorMsg ? [`VLM 失败降级为模板：${errorMsg}`] : [],
    error: null
  }
}

function regionEvidenceIds(region: Region, manipulation: ManipulationReport | undefined): string[] {
  return (manipulation?.evidence ?? [])
    .filter(
      (evidence) =>
        evidence.kind === 'model_localization' &&
        (evidence.regionId === region.regionId ||
          (region.maskArtifactId !== null &&
            evidence.artifactIds.includes(region.maskArtifactId)) ||
          (typeof region.detector === 'string' && evidence.data.detector === region.detector))
    )
    .map((evidence) => evidence.evidenceId)
}

interface ImageReference {
  index: number
  role: 'full_image' | 'predicted_mask'
  regions?: string[]
}

async function prepareImages(
  bundle: EvidenceBundle,
  taskDirectory: string,
  maxImages: number,
  regions: Region[]
): Promise<{ images: string[]; references: ImageReference[] }> {
  const base64Images: string[] = []
  const references: ImageReference[] = []
  const displayArtifact = bundle.artifacts.find(
    (artifact) => artifact.artifactId === bundle.image.displayArtifactId
  )

  // 发送整图与各定位器预测掩码，JSON按实际发送顺序标注图片身份。
  // 不把裁剪或黑白掩码当成另一个独立场景。
  const area = (artifact: Artifact): number =>
    artifact.bboxXYWH ? artifact.bboxXYWH[2] * artifact.bboxXYWH[3] : 0
  const byType = (type: Artifact['type']): Artifact[] =>
    displayArtifact
      ? bundle.artifacts
          .filter(
            (artifact) =>
              artifact.type === type && artifact.sourceArtifactId === displayArtifact.artifactId
          )
          .sort((a, b) => area(b) - area(a))
      : []

  const ordered: Artifact[] = displayArtifact ? [displayArtifact, ...byType('mask')] : []

  for (const artifact of ordered.slice(0, maxImages)) {
    try {
      const buffer = await readFile(join(taskDirectory, artifact.uri))
      base64Images.push(buffer.toString('base64'))
      references.push({
        index: base64Images.length,
        role: artifact.type === 'display' ? 'full_image' : 'predicted_mask',
        ...(artifact.type === 'mask'
          ? {
              regions: regions.flatMap((region, index) =>
                region.maskArtifactId === artifact.artifactId
                  ? [String.fromCharCode(65 + index)]
                  : []
              )
            }
          : {})
      })
    } catch (error) {
      console.warn(`读取图片失败（${artifact.type}: ${artifact.uri}）:`, error)
    }
  }

  return { images: base64Images, references }
}

// --- 确定性字段 ---

function deriveFinalDecision(manipulation: ManipulationReport | undefined): FinalDecision {
  if (!manipulation || manipulation.status !== 'completed' || !manipulation.result) {
    return 'inconclusive'
  }
  return manipulation.result.decision ?? 'inconclusive'
}

function buildClaims(
  provenance: ProvenanceReport | undefined,
  manipulation: ManipulationReport | undefined,
  aigc: AigcReport | undefined
): CategorizedClaim[] {
  const claims: CategorizedClaim[] = []
  const push = (category: ClaimCategory, claim: ExplanationClaim): void => {
    claims.push({ category, claim })
  }

  // AI 生成（FSD）
  const aigcEvidence = findEvidence(aigc, 'aigc_classification')
  if (aigcEvidence) {
    const inner = asRecord(getDetector(manipulation, 'aigc')?.result)
    const aigcInfo = asRecord(inner.aigc)
    const decision = asString(aigcInfo.decision) ?? asString(aigc?.result?.decision) ?? '未知'
    const zScore = asNumber(aigcInfo.zScore) ?? asNumber(aigc?.result?.score?.value)
    const threshold = asNumber(aigcInfo.threshold) ?? asNumber(aigc?.result?.threshold)
    push('aigc', {
      text: `FSD 的 AI 生成检测判定为 ${decision}（z=${fmtNum(zScore, 2)}，阈值=${
        threshold === null ? '未知' : threshold
      }；z-score 未校准，不等于概率）。`,
      evidenceIds: [aigcEvidence.evidenceId]
    })
  }

  // 整图分类（SICA）
  const sicaEvidence = findEvidence(manipulation, 'image_classification')
  if (sicaEvidence) {
    const inner = asRecord(getDetector(manipulation, 'sica')?.result)
    const score = asNumber(asRecord(inner.score).value)
    const classification = asRecord(inner.classification)
    const predicted = asString(classification.predictedClass)
    const threshold = asNumber(classification.threshold)
    const verdict =
      predicted === 'fake'
        ? '偏向存在篡改'
        : predicted === 'real'
          ? '偏向未检出明显篡改'
          : '未给出明确类别'
    push('classification', {
      text: `SICA 整图分类结果为 ${predicted ?? '未知'}（score=${fmtNum(score)}，阈值=${
        threshold === null ? '未知' : threshold
      }），${verdict}。`,
      evidenceIds: [sicaEvidence.evidenceId]
    })
  }

  // 局部定位（RITA / RiSE）
  for (const backend of ['rita', 'rise'] as const) {
    const evidence = findEvidence(
      manipulation,
      'model_localization',
      (item) => String(item.data.detector) === backend
    )
    if (!evidence) continue

    const inner = asRecord(getDetector(manipulation, backend)?.result)
    const regionCount = asNumber(inner.regionCount)
    const areaFraction = asNumber(inner.areaFraction)
    const name = backend === 'rita' ? 'RITA' : 'RiSE'
    const scope = backend === 'rita' ? '照片局部篡改定位' : '文档局部篡改定位'
    push('localization', {
      text: `${name}（${scope}）在 ${
        regionCount === null ? '未知数量' : `${regionCount} 处`
      }标记可疑区域，面积占比 ${
        areaFraction === null ? '未知' : `${(areaFraction * 100).toFixed(2)}%`
      }；该模块只做局部定位，不判断是否为生成式内容。`,
      evidenceIds: [evidence.evidenceId]
    })
  }

  // 元数据
  const metadataEvidence = findEvidence(provenance, 'image_metadata_inventory')
  if (metadataEvidence) {
    const details = asRecord(provenance?.result?.metadata?.details)
    const format = asString(details.format) ?? '未知'
    const fields = asRecord(asRecord(details.xmp).fields)
    const creatorToolValue = fields['xmp:CreatorTool']
    const creatorTool =
      Array.isArray(creatorToolValue) && typeof creatorToolValue[0] === 'string'
        ? creatorToolValue[0]
        : null
    push('provenance', {
      text: `图像元数据格式为 ${format}，EXIF=${details.hasExif === true ? '有' : '无'}、XMP=${
        details.hasXmp === true ? '有' : '无'
      }、IPTC=${details.hasIptc === true ? '有' : '无'}，CreatorTool=${creatorTool ?? '未记录'}。`,
      evidenceIds: [metadataEvidence.evidenceId]
    })
  }

  // C2PA 凭证
  const c2paEvidence = findEvidence(provenance, 'c2pa_manifest_presence')
  if (c2paEvidence) {
    const details = asRecord(provenance?.result?.credentials?.details)
    const outcome = asString(details.outcome) ?? '未知'
    push('provenance', {
      text: `C2PA 凭证检查结果为 ${outcome}；未发现嵌入清单不排除外部凭证，签名也未在本地验证。`,
      evidenceIds: [c2paEvidence.evidenceId]
    })
  }

  // 水印
  const watermarkEvidence = findEvidence(provenance, 'watermark_detection')
  if (watermarkEvidence) {
    const details = asRecord(provenance?.result?.watermark?.details)
    const outcome = asString(details.outcome) ?? '未知'
    const combined = asString(details.combinedOutcome) ?? '未知'
    push('provenance', {
      text: `水印检查结果 outcome=${outcome}、combined=${combined}；未命中已知线索不构成否定证据。`,
      evidenceIds: [watermarkEvidence.evidenceId]
    })
  }

  // 兜底：仅有预处理证据时也给一条可追溯记录
  if (claims.length === 0) {
    const preprocessingEvidence = findEvidence(provenance, 'image_preprocessing')
    if (preprocessingEvidence) {
      push('provenance', {
        text: '已完成图像预处理，但上游未提供可用的检测结论。',
        evidenceIds: [preprocessingEvidence.evidenceId]
      })
    }
  }

  return claims
}

function buildUnresolved(
  provenance: ProvenanceReport | undefined,
  manipulation: ManipulationReport | undefined,
  aigc: AigcReport | undefined,
  finalDecision: FinalDecision
): string[] {
  const items: string[] = []

  if (!manipulation || manipulation.status !== 'completed' || !manipulation.result) {
    items.push(`局部篡改检测未完成（status=${manipulation?.status ?? '缺失'}）。`)
  } else if (finalDecision === 'inconclusive') {
    items.push('上游汇总尚未给出整图真伪结论。')
  }

  const unfinished = getDetectors(manipulation)
    .filter((detector) => typeof detector.status === 'string' && detector.status !== 'completed')
    .map((detector) => String(detector.backend))
  if (unfinished.length > 0) {
    items.push(`以下检测器未完成：${unfinished.join('、')}。`)
  }

  if (!aigc || aigc.status !== 'completed' || !aigc.result) {
    items.push('缺少可用的 AIGC 报告，未评估 AI 生成。')
  } else {
    items.push('FSD 的 z-score 未经校准，不能当作概率使用。')
  }

  if (asString(asRecord(provenance?.result?.credentials?.details).outcome)) {
    items.push('C2PA 签名未在本地完成验证，未发现清单不排除外部凭证。')
  }
  if (asString(asRecord(provenance?.result?.watermark?.details).outcome)) {
    items.push('水印与元数据的“未命中/缺失”不等于图像真实或被剥离。')
  }

  for (const disagreement of getDisagreements(manipulation)) {
    items.push(`模块间分歧：${disagreement}`)
  }

  items.push('本解释为辅助性描述，不构成司法或权威鉴定结论。')
  return items
}

// --- Prompt 与 VLM 调用 ---

function buildPrompt(
  finalDecision: FinalDecision,
  categorized: CategorizedClaim[],
  disagreements: string[],
  manipulation: ManipulationReport | undefined,
  aigc: AigcReport | undefined,
  selectedRegions: Region[],
  images: ImageReference[],
  imageWidth: number,
  observations: RegionObservation[],
  provenance: ProvenanceReport | undefined
): string {
  const sica = getDetector(manipulation, 'sica')
  const sicaResult = asRecord(sica?.result)
  const classification = asRecord(sicaResult.classification)
  const sicaScore = asNumber(asRecord(sicaResult.score).value)
  const support = (value: unknown, supports?: string) => {
    const record = asRecord(value)
    return typeof record.value === 'number'
      ? {
          value: Number(record.value.toFixed(4)),
          meaning: record.description,
          ...(supports ? { supports } : {})
        }
      : null
  }
  const models: JsonObject[] = [
    {
      model: 'SICA',
      task: '通用整图真实性分类',
      status: sica?.status ?? 'not_run',
      finding:
        classification.predictedClass === 'real'
          ? '整图未见明显异常'
          : classification.predictedClass === 'fake'
            ? '整图存在可疑线索'
            : '尚无结果',
      score: sicaScore,
      threshold: classification.threshold ?? null,
      support: support(
        sicaClassSupport(sicaScore, classification.predictedClass),
        classification.predictedClass === 'real' ? '整图未见明显异常' : '整图存在可疑线索'
      )
    },
    {
      model: 'FSD',
      task: 'AI生成分类',
      status: aigc?.status ?? 'not_run',
      finding:
        aigc?.result?.decision === 'non_ai'
          ? '未检出AI生成线索'
          : aigc?.result?.decision === 'ai_generated'
            ? '存在AI生成线索'
            : '尚无结果',
      score: aigc?.result?.score?.value ?? null,
      threshold: aigc?.result?.threshold ?? null,
      support: support(
        fsdClassSupport(
          aigc?.result?.score?.value,
          aigc?.result?.threshold,
          aigc?.result?.decision
        ),
        aigc?.result?.decision === 'non_ai' ? '未检出AI生成线索' : '存在AI生成线索'
      )
    }
  ]
  for (const backend of ['rita', 'rise'] as const) {
    const detector = getDetector(manipulation, backend)
    const result = asRecord(detector?.result)
    const regions = selectedRegions.filter((region) => region.detector === backend)
    models.push({
      model: backend === 'rita' ? 'RITA' : 'RiSE',
      task: backend === 'rita' ? '照片局部篡改定位' : '文档局部篡改定位',
      status: detector?.status ?? 'not_run',
      regionCount: result.regionCount ?? null,
      support: support(result.confidence),
      shownRegionCount: regions.length,
      regions: regions.map((region) => ({
        regionId: String.fromCharCode(65 + selectedRegions.indexOf(region)),
        bboxXYWH: region.bboxXYWH,
        position:
          region.bboxXYWH[0] + region.bboxXYWH[2] / 2 > (imageWidth * 2) / 3
            ? '图片右侧'
            : region.bboxXYWH[0] + region.bboxXYWH[2] / 2 < imageWidth / 3
              ? '图片左侧'
              : '图片中部',
        support: support(region.confidence)
      }))
    })
  }
  return JSON.stringify({
    task: '评估是否存在异常；如有，说明优先核查的目标、候选编辑方式及依据',
    images,
    maskLegend: '白色是检测器标记的异常候选；掩码与待分析整图同坐标',
    imageRelationship:
      '所有图片和局部观察来自同一张待分析输入，没有编辑前参考图；裁剪仅用于看清内容',
    models,
    provenance: {
      status: provenance?.status ?? 'not_run',
      metadata: {
        format: provenance?.result?.metadata?.details?.format ?? null,
        creatorTool:
          asRecord(asRecord(provenance?.result?.metadata?.details?.xmp).fields)[
            'xmp:CreatorTool'
          ] ?? null
      },
      credentials: {
        status: provenance?.result?.credentials?.status ?? 'not_run',
        outcome: provenance?.result?.credentials?.details?.outcome ?? null
      },
      watermark: {
        status: provenance?.result?.watermark?.status ?? 'not_run',
        outcome:
          provenance?.result?.watermark?.details?.combinedOutcome ??
          provenance?.result?.watermark?.details?.outcome ??
          null
      }
    },
    regionObservations: observations.map((observation) => ({
      regionId: observation.regionId,
      status: observation.status,
      ...(observation.text ? { content: observation.text.slice(0, 600) } : {})
    })),
    observationSource: '区域观察仅描述可见内容，尚未判定异常',
    disagreements,
    evidenceScope:
      '整图筛查、AI生成和局部编辑是不同任务；支持度说明各自结论，综合时结合局部标记与可见内容。',
    supportMeaning: '支持度描述模型对当前类别或标记像素的响应强度，非正确率',
    output: {
      fields: ['finalDecision', 'primaryRegionId', 'subject', 'suspectedOperation', 'explanation'],
      regionIds: selectedRegions.map((_, index) => String.fromCharCode(65 + index)),
      operationTypes: {
        copy_move: '复制移动',
        splicing: '拼接',
        removal: '擦除',
        inpainting: '局部修复或重绘',
        text_edit: '文字修改',
        ai_generation: 'AI生成',
        unknown: '暂不能区分'
      },
      style: '选出一个最值得关注的区域；explanation用两句中文概括判断与理由'
    }
  })
}

interface OllamaChatResponse {
  done_reason?: string
  eval_count?: number
  prompt_eval_count?: number
  message?: { content?: string }
}

async function generateAnalysis(
  prompt: string,
  images: string[],
  config: ExplanationConfig,
  regionIds: string[],
  rawJudgements: unknown[],
  requestSignal: AbortSignal
): Promise<UserExplanation> {
  let lastProblem: string | null = null

  // 最多两次：仅当输出无法解析或缺字段时重试；网络/超时直接抛出，由上层降级。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userContent =
      attempt === 0
        ? prompt
        : `${prompt}\n\n【上一次输出未通过校验】${lastProblem ?? '未知问题'}。请按约定格式重写。`

    const response = await fetch(`${config.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent, images }
        ],
        stream: false,
        format: USER_EXPLANATION_SCHEMA,
        // temperature 固定 0：解释任务要确定性，不属于环境相关配置。
        options: { temperature: 0, num_predict: config.numPredict, num_ctx: config.numCtx }
      }),
      signal: requestSignal
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
    }

    const data = (await response.json()) as OllamaChatResponse
    rawJudgements.push(data)
    console.log(
      `[Ollama] attempt=${attempt + 1} done_reason=${data.done_reason} eval_count=${data.eval_count} prompt_eval_count=${data.prompt_eval_count}`
    )

    const content = data.message?.content
    if (!content) throw new Error('Ollama 返回为空')

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      lastProblem = '输出不是合法 JSON（可能被截断）'
      console.warn(`  第 ${attempt + 1} 次输出未通过校验：${lastProblem}`)
      continue
    }

    const sections = parseUserExplanation(parsed, regionIds)
    if (!sections) {
      lastProblem = '请按约定JSON回答，用日常语言解释并使用已有区域编号'
      console.warn(`  第 ${attempt + 1} 次输出未通过校验：${lastProblem}`)
      continue
    }

    console.log('----- [Ollama] sections -----')
    console.log(JSON.stringify(sections))
    console.log('-----------------------------')
    return sections
  }

  throw new Error(`VLM 输出未通过校验：${lastProblem ?? '未知问题'}`)
}

// --- 低层工具 ---

type JsonObject = Record<string, unknown>

function asRecord(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function fmtNum(value: number | null, digits = 4): string {
  return value === null ? '未知' : value.toFixed(digits)
}

function getDetectors(manipulation: ManipulationReport | undefined): JsonObject[] {
  const raw = manipulation?.result?.detectors
  return Array.isArray(raw) ? (raw as JsonObject[]) : []
}

function getDetector(
  manipulation: ManipulationReport | undefined,
  backend: string
): JsonObject | undefined {
  return getDetectors(manipulation).find((detector) => String(detector.backend) === backend)
}

function findEvidence(
  report: { evidence: Evidence[] } | undefined,
  kind: string,
  match?: (evidence: Evidence) => boolean
): Evidence | undefined {
  return report?.evidence.find((evidence) => evidence.kind === kind && (!match || match(evidence)))
}

function getDisagreements(manipulation: ManipulationReport | undefined): string[] {
  const raw = manipulation?.result?.disagreements
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}
