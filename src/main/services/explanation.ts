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
import { validateExplanationReport } from '../../shared/protocol'

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
  model: 'modelscope.cn/Qwen/Qwen3-VL-2B-Instruct-GGUF',
  host: 'http://127.0.0.1:11434',
  numCtx: 8192,
  // 1200 是"当前 schema 的合适值"：6 个 ≤140 字短字段实测 eval_count≈700。
  // 它不是硬性上限——schema 扩展（新增字段、放宽长度）时必须同步调大，否则会被 num_predict 截断。
  numPredict: 1200,
  // 送图上限：每张图都要吃视觉 token。2B/4GB 下默认 1（只送 display）。
  maxImages: 1
}
const MAX_SECTION_CHARS = 140
const MAX_ANALYSIS_CHARS = 900

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

interface AnalysisSections {
  conclusion: string
  aiGeneration: string
  classification: string
  localization: string
  provenance: string
  limitations: string
}

const SECTION_KEYS: Array<keyof AnalysisSections> = [
  'conclusion',
  'aiGeneration',
  'classification',
  'localization',
  'provenance',
  'limitations'
]

const SECTION_LABELS: Record<keyof AnalysisSections, string> = {
  conclusion: '结论',
  aiGeneration: 'AI 生成',
  classification: '整图分类',
  localization: '局部定位',
  provenance: '来源与凭证',
  limitations: '限制'
}

// 2B 只负责把"分区事实"各自改写成短句；跨区结构、引用和结论由代码控制。
const SYSTEM_PROMPT = `你是图像鉴伪解释器。只根据用户给出的分区事实写短句，输出 JSON。
硬性规则：
1. 只输出 JSON，字段为 conclusion、aiGeneration、classification、localization、provenance、limitations。
2. 每个字段只写本分区事实，不得跨区合并，不得补充事实中没有的因果、依据或置信度。
3. RITA、RiSE 是局部篡改定位器；只有 FSD 是 AI 生成检测。不得把 RITA/RiSE 说成 AI 生成分类器。
4. 不写“确定伪造”“100%”“绝对”“置信度高”等表述。
5. 不得新增事实、不得修改任何数值。`

/**
 * 第四人核心服务：消费证据包，生成解释报告。
 *
 * 方案 G：finalDecision / confidence / claims / unresolved 由代码从上游证据确定性装配；
 * VLM 只负责把分区事实改写成短句。analysis 由 6 个分区短句拼接，每段单独做角色校验，
 * 不通过时用规则文本回填，避免 2B 模型跨模块串写或数组循环。
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

  // 1. 提取上游报告
  const upstreamReports = bundle.reports
  const provenanceReport = upstreamReports.find(
    (report): report is ProvenanceReport => report.moduleId === 'provenance'
  )
  const manipulationReport = upstreamReports.find(
    (report): report is ManipulationReport => report.moduleId === 'manipulation'
  )
  const aigcReport = upstreamReports.find((report): report is AigcReport => report.moduleId === 'aigc')

  // 2. 确定性字段：不从模型生成
  const finalDecision = deriveFinalDecision(manipulationReport)
  const categorizedClaims = buildClaims(provenanceReport, manipulationReport, aigcReport)
  const claims = categorizedClaims.map((item) => item.claim)
  const unresolved = buildUnresolved(provenanceReport, manipulationReport, aigcReport, finalDecision)
  const disagreements = getDisagreements(manipulationReport)
  const fallbackSections = buildFallbackSections(categorizedClaims, unresolved, finalDecision)

  // 3. 图片与 prompt（按 maxImages 依次送 display / mask / crop）
  const images = await prepareImages(bundle, taskDirectory, config.maxImages)
  console.log(`[explanation-images] maxImages=${config.maxImages} sent=${images.length}`)
  const prompt = buildPrompt(finalDecision, categorizedClaims, unresolved, disagreements)

  // 4. VLM 只生成分区短句；解析失败或超时时整体降级
  let sections = fallbackSections
  let mode: 'local' | 'mock' = 'local'
  let producerName = `ollama:${config.model}`
  let errorMsg: string | null = null

  try {
    const rawSections = await generateAnalysis(prompt, images, config)
    sections = repairSections(rawSections, fallbackSections)
  } catch (error) {
    console.warn('VLM 调用或校验失败，降级为规则模板:', error)
    mode = 'mock'
    producerName = 'template-fallback'
    errorMsg = error instanceof Error ? error.message : String(error)
    sections = fallbackSections
  }

  const analysis = clampText(composeAnalysis(sections), MAX_ANALYSIS_CHARS)

  const result: ExplanationResult = {
    finalDecision,
    confidence: UNAVAILABLE_CONFIDENCE,
    analysis,
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

  const validationErrors = validateExplanationReport(report, upstreamReports)
  if (validationErrors.length > 0) {
    console.error('解释报告校验失败:', validationErrors)
    report.limitations.push(...validationErrors.map((message) => `校验：${message}`))
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

async function prepareImages(
  bundle: EvidenceBundle,
  taskDirectory: string,
  maxImages: number
): Promise<string[]> {
  const base64Images: string[] = []
  const displayArtifact = bundle.artifacts.find(
    (artifact) => artifact.artifactId === bundle.image.displayArtifactId
  )

  // 送图优先级：display（整图）→ mask（篡改区域，面积大者优先）→ crop（局部特写，面积大者优先）。
  // 每多送一张图都要额外吃视觉 token 并挤占 num_ctx，默认 1 即只送 display。
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

  const ordered: Artifact[] = displayArtifact
    ? [displayArtifact, ...byType('mask'), ...byType('crop')]
    : []

  for (const artifact of ordered.slice(0, maxImages)) {
    try {
      const buffer = await readFile(join(taskDirectory, artifact.uri))
      base64Images.push(buffer.toString('base64'))
    } catch (error) {
      console.warn(`读取图片失败（${artifact.type}: ${artifact.uri}）:`, error)
    }
  }

  return base64Images
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
      }、IPTC=${details.hasIptc === true ? '有' : '无'}，CreatorTool=${
        creatorTool ?? '未记录'
      }。`,
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
    items.push(
      `局部篡改检测未完成（status=${manipulation?.status ?? '缺失'}），整体结论只能为 inconclusive。`
    )
  } else if (finalDecision === 'inconclusive') {
    items.push('聚合层判定为 inconclusive，单张图片无法给出确定的真伪结论。')
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

function buildFallbackSections(
  categorized: CategorizedClaim[],
  unresolved: string[],
  finalDecision: FinalDecision
): AnalysisSections {
  const pick = (category: ClaimCategory): string =>
    categorized
      .filter((item) => item.category === category)
      .map((item) => item.claim.text)
      .join('')

  const conclusion =
    finalDecision === 'suspicious'
      ? '聚合层判定为可疑。'
      : finalDecision === 'no_anomaly_detected'
        ? '聚合层未检出明显异常。'
        : '聚合层判定为 inconclusive，暂无法给出确定结论。'

  return {
    conclusion,
    aiGeneration: pick('aigc') || '未提供可用的 AI 生成检测结果。',
    classification: pick('classification') || '未提供可用的整图分类结果。',
    localization: pick('localization') || '未提供可用的局部定位结果。',
    provenance: pick('provenance') || '未提供可用的来源与凭证信息。',
    limitations: unresolved.length > 0 ? `${unresolved.slice(0, 3).join('；')}。` : '无额外限制说明。'
  }
}

// --- Prompt 与 VLM 调用 ---

function buildPrompt(
  finalDecision: FinalDecision,
  categorized: CategorizedClaim[],
  unresolved: string[],
  disagreements: string[]
): string {
  const facts = (category: ClaimCategory): string => {
    const lines = categorized
      .filter((item) => item.category === category)
      .map((item) => `- ${item.claim.text}`)
    return lines.length > 0 ? lines.join('\n') : '- （无）'
  }

  const lines: string[] = []
  lines.push('【聚合结论】')
  lines.push(`finalDecision=${finalDecision}`)
  lines.push('')

  lines.push('【分区事实（只能改写本区，禁止跨区合并）】')
  lines.push('AI 生成（只写 FSD）：')
  lines.push(facts('aigc'))
  lines.push('整图分类（只写 SICA）：')
  lines.push(facts('classification'))
  lines.push('局部定位（只写 RITA/RiSE）：')
  lines.push(facts('localization'))
  lines.push('来源与凭证（只写元数据/C2PA/水印）：')
  lines.push(facts('provenance'))
  lines.push('')

  lines.push('【模块间分歧】')
  if (disagreements.length === 0) lines.push('无')
  else for (const item of disagreements) lines.push(`- ${item}`)
  lines.push('')

  lines.push('【必须说明的限制】')
  for (const item of unresolved) lines.push(`- ${item}`)
  lines.push('')

  lines.push('【输出要求】')
  lines.push(
    '只输出 JSON，六个字符串字段：conclusion、aiGeneration、classification、localization、provenance、limitations。'
  )
  lines.push('每段 1–2 句、40–120 字；只改写本区事实，不得跨区合并、不得新增事实或改动数值。')
  lines.push(
    'conclusion 必须与聚合结论一致且不写置信度；aiGeneration 不得提 RITA/RiSE；localization 不得提 AI 生成/AIGC；classification 不得提局部定位。'
  )
  lines.push('每个字段必须是一句完整中文说明，不能只写类别值或模块名。句式示例（数值以本样本事实为准）：')
  lines.push('conclusion: "聚合层判定为 inconclusive，暂无法给出确定结论。"')
  lines.push('classification: "SICA 整图分类结果为 fake，偏向存在篡改。"')
  lines.push('limitations: "FSD 的 z-score 未校准，C2PA 签名未验证。"')

  return lines.join('\n')
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
  config: ExplanationConfig
): Promise<AnalysisSections> {
  let lastProblem: string | null = null

  // 最多两次：仅当输出无法解析或缺字段时重试；网络/超时直接抛出，由上层降级。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userContent =
      attempt === 0
        ? prompt
        : `${prompt}\n\n【上一次输出未通过校验】${lastProblem ?? '未知问题'}。请严格按六个字段重写。`

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
        format: EXPLANATION_SCHEMA,
        // temperature 固定 0：解释任务要确定性，不属于环境相关配置。
        options: { temperature: 0, num_predict: config.numPredict, num_ctx: config.numCtx }
      }),
      signal: AbortSignal.timeout(120000)
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
    }

    const data = (await response.json()) as OllamaChatResponse
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

    const sections = parseSections(parsed)
    if (!sections) {
      lastProblem = '缺少必要字段或字段不是字符串'
      console.warn(`  第 ${attempt + 1} 次输出未通过校验：${lastProblem}`)
      continue
    }

    console.log('----- [Ollama] sections -----')
    for (const key of SECTION_KEYS) console.log(`  ${key}: ${sections[key]}`)
    console.log('-----------------------------')
    return sections
  }

  throw new Error(`VLM 输出未通过校验：${lastProblem ?? '未知问题'}`)
}

function parseSections(value: unknown): AnalysisSections | null {
  const record = asRecord(value)
  const sections = {} as AnalysisSections
  for (const key of SECTION_KEYS) {
    const text = asString(record[key])
    if (!text) return null
    sections[key] = text
  }
  return sections
}

/**
 * 对每段做角色/绝对化检查；不通过时用规则文本回填，而不是整份降级。
 * 这样单个分区写错不会拖垮整个解释，VLM 仍可贡献其余段落。
 */
function repairSections(raw: AnalysisSections, fallback: AnalysisSections): AnalysisSections {
  const repaired = { ...raw }
  for (const key of SECTION_KEYS) {
    const problem = sectionProblem(key, repaired[key])
    if (problem) {
      console.warn(`  段落 ${key} 未通过检查（${problem}），改用规则文本`)
      repaired[key] = fallback[key]
    } else {
      repaired[key] = clampText(repaired[key].trim(), MAX_SECTION_CHARS)
    }
  }
  return repaired
}

function sectionProblem(key: keyof AnalysisSections, text: string): string | null {
  const value = text.trim()
  // 2B 容易把字段当“值”填（如 classification: fake），用最小长度挡住
  if (value.length < 15) return '段落过短（疑似只写了类别值或模块名）'

  // 所有分区都不得出现未校准置信度或绝对化结论
  if (/(?:置信度|可信度)(?:高|较高|很高)|高置信|100%|确定(就是)?(伪造|篡改)/.test(value)) {
    return '出现置信度或绝对化表述'
  }

  switch (key) {
    case 'aiGeneration':
      if (/RITA|RiSE/.test(value)) return 'AI 生成段提到 RITA/RiSE'
      break
    case 'classification':
      if (/RITA|RiSE|局部定位/.test(value)) return '整图分类段提到局部定位'
      break
    case 'localization':
      if (/AIGC|AI\s*生成|ai_generated/i.test(value)) return '局部定位段提到 AI 生成'
      break
    case 'provenance':
      if (/SICA|RITA|RiSE|FSD/.test(value)) return '来源段提到检测器'
      break
    case 'limitations':
      if (/判定为 ai_generated|整图分类结果|标记可疑区域|CreatorTool=/.test(value)) {
        return '限制段混入检测事实'
      }
      break
  }
  return null
}

function composeAnalysis(sections: AnalysisSections): string {
  return SECTION_KEYS.map((key) => {
    const text = sections[key].trim().replace(/[。；;]+$/u, '')
    return `${SECTION_LABELS[key]}：${text}。`
  }).join('')
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

function clampText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastStop = cut.lastIndexOf('。')
  return lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut
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
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : []
}

// Ollama 的 JSON Schema 约束：六个字符串字段，没有数组，避免 2B 模型在 claims 上循环。
const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: {
    conclusion: { type: 'string' },
    aiGeneration: { type: 'string' },
    classification: { type: 'string' },
    localization: { type: 'string' },
    provenance: { type: 'string' },
    limitations: { type: 'string' }
  },
  required: [
    'conclusion',
    'aiGeneration',
    'classification',
    'localization',
    'provenance',
    'limitations'
  ]
}
