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
  Evidence
} from '../../shared/protocol'
import type { Region } from '../../shared/protocol'
import { validateExplanationReport } from '../../shared/protocol'
import {
  sicaClassSupport,
  fsdClassSupport,
  sicaDecisionConfidence
} from '../../shared/decision-confidence'
import { observeRegions, type RegionObservation } from './visual-observation'
import { drawRegionBoundaries, BOUNDARY_NOTE } from './visual-boundary'
import { readOllamaChat } from './ollama-stream'
import type { ExplanationProgress } from '../../shared/contracts'
import {
  locateCandidates,
  assessOriginal,
  describeLinkedEvidence,
  inferOperation,
  OPERATION_NAMES,
  type EvidenceAssessment
} from './evidence-assessment'
import {
  primaryExplanationRegions,
  evidenceForAssessment,
  buildNarrationFacts,
  linkAssessment,
  linkedExplanation,
  type NarrationCandidate
} from './explanation-evidence'
import { USER_EXPLANATION_SYSTEM, type UserExplanation } from './user-explanation'
import { provenanceForVlm, provenanceNarrationFacts } from './provenance-input'
import { releaseLocalModel } from './local-model'
import { AppError } from '../errors'
import { sourceConclusion } from './source-conclusion'
import { assessLocalizationReliability, buildEvidenceLinks } from './evidence-links'

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
  // 保留原送图上限配置；目前综合阶段只发送一张带预测外轮廓的原图。
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
interface ExplanationOptions {
  onProgress?: (progress: Omit<ExplanationProgress, 'taskId' | 'imageId'>) => void
  signal?: AbortSignal
  releaseModel?: boolean
}

export async function releaseConfiguredLocalModel(): Promise<void> {
  try {
    const config = await loadExplanationConfig()
    await releaseLocalModel(config.host, config.model)
  } catch (error) {
    console.warn('准备检测时未能释放本地解释模型:', error)
  }
}

export async function generateExplanation(
  bundle: EvidenceBundle,
  taskId: string,
  modelName?: string,
  ollamaHost?: string,
  options?: ExplanationOptions
): Promise<ExplanationReport> {
  const config = await loadExplanationConfig(modelName, ollamaHost)
  let shouldRelease = options?.releaseModel
  try {
    const report = await runExplanation(bundle, taskId, config, options)
    if (report.result?.aiGenerationSource === 'credentials') shouldRelease = false
    return report
  } finally {
    if (shouldRelease) await releaseLocalModel(config.host, config.model)
  }
}

async function runExplanation(
  bundle: EvidenceBundle,
  taskId: string,
  config: ExplanationConfig,
  options?: ExplanationOptions
): Promise<ExplanationReport> {
  const startTime = performance.now()
  const taskDirectory = join(process.cwd(), 'work/analysis-runs', taskId)

  // 配置：显式参数 > 环境变量 > local（或 SRDP_EXPLANATION_CONFIG 指定的文件）> example > 内置默认。
  // 每次调用读一次，不缓存：改 JSON 后下一次分析立即生效，不用重启应用。
  const requestSignal = options?.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)])
    : AbortSignal.timeout(120000)
  options?.signal?.throwIfAborted()
  const notify = options?.onProgress

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
  const visibleOcr = asRecord(
    asRecord(provenanceReport?.result?.watermark?.details?.detectors).visible
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
  const allRegions = manipulationReport?.result?.regions ?? []
  const fusionLinks = buildEvidenceLinks(manipulationReport, aigcReport, provenanceReport)
  const hasStrongMultiRegionLink = fusionLinks.some(
    (link) =>
      link.relation === 'corroborates' &&
      link.strength === 'strong' &&
      (link.question === 'local_editing' || link.question === 'image_anomaly') &&
      link.regionIds.length > 1
  )
  const selectedRegions = primaryExplanationRegions(
    allRegions.filter((region) => regionEvidenceIds(region, manipulationReport).length > 0),
    hasStrongMultiRegionLink ? { regionsPerLocalizer: 3 } : undefined
  )
  const aliases = selectedRegions.map((_, index) => String.fromCharCode(65 + index))
  const sourceAnswer = sourceConclusion(provenanceReport, aigcReport)

  // 同一张原图上的预测外轮廓与简洁JSON。
  const { images, references, original } = sourceAnswer
    ? { images: [], references: [], original: undefined }
    : await prepareImages(bundle, taskDirectory, config.maxImages, selectedRegions)
  console.log(`[explanation-images] maxImages=${config.maxImages} sent=${images.length}`)
  notify?.({
    phase: 'observing',
    label: sourceAnswer ? '正在整理来源凭证与AI检测结果' : '正在对应预测区域与原图位置'
  })
  const visualGuidance = sourceAnswer
    ? { status: 'skipped', focusIndex: null, raw: null }
    : await locateCandidates({
        images,
        count: selectedRegions.length,
        regions: selectedRegions.map((region) => region.bboxXYWH),
        config,
        signal: requestSignal
      })
  if (!sourceAnswer && selectedRegions.length)
    notify?.({
      phase: 'observing',
      label: `正在查看 ${selectedRegions.length} 处候选的未标记原始内容`
    })
  const observations = original
    ? await observeRegions({
        directory: taskDirectory,
        full: original,
        regions: selectedRegions,
        artifacts: bundle.artifacts,
        model: config.model,
        host: config.host,
        numCtx: config.numCtx,
        maxImages: config.maxImages,
        ocrTexts: visibleOcr.status === 'completed' ? visibleOcr.recognizedTexts : undefined,
        signal: requestSignal
      })
    : []
  const prompt = buildPrompt(
    disagreements,
    manipulationReport,
    aigcReport,
    selectedRegions,
    references,
    bundle.image.width,
    bundle.image.height,
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
  let producerName = sourceAnswer ? 'verified-source-summary' : `ollama:${config.model}`
  let errorMsg: string | null = null
  const rawJudgements: unknown[] = []
  const rawNarratives: unknown[] = []

  try {
    answer =
      sourceAnswer ??
      (await generateAnalysis(
        prompt,
        config,
        aliases,
        rawJudgements,
        requestSignal,
        notify,
        rawNarratives,
        selectedRegions.map((region, index) => ({
          regionId: aliases[index],
          sourceRegionId: region.regionId,
          location: regionPosition(region, bundle.image.width, bundle.image.height),
          observedContent: observations[index]?.text ?? null,
          confidence: region.confidence,
          context: observations[index]?.context ?? null,
          contextSource: observations[index]?.contextSource,
          nearbyText: observations[index]?.nearbyText,
          visibleText: observations[index]?.visibleText ?? null,
          detector: typeof region.detector === 'string' ? region.detector : undefined
        })),
        original,
        visualGuidance.focusIndex
      ))
  } catch (error) {
    if (options?.signal?.aborted) throw new AppError('CANCELLED', '已停止生成说明。')
    console.warn('VLM 调用或校验失败，降级为规则模板:', error)
    mode = 'mock'
    producerName = 'template-fallback'
    errorMsg = error instanceof Error ? error.message : String(error)
  }

  if (options?.signal?.aborted) throw new AppError('CANCELLED', '已停止生成说明。')
  const regionAnalyses = answer.regions.map((region) => {
    const source = selectedRegions[aliases.indexOf(region.regionId)]
    return {
      ...region,
      location: region.location || regionPosition(source, bundle.image.width, bundle.image.height),
      regionId: source.regionId,
      evidenceIds: regionEvidenceIds(source, manipulationReport),
      ...(region.suspectedOperation && region.suspectedOperation !== OPERATION_NAMES.unknown
        ? { operationSource: 'vlm_hypothesis' as const }
        : {})
    }
  })

  const result: ExplanationResult = {
    finalDecision: answer.finalDecision,
    ...(answer.aiGeneration ? { aiGeneration: answer.aiGeneration } : {}),
    ...(answer.aiGenerationSource ? { aiGenerationSource: answer.aiGenerationSource } : {}),
    ...(answer.localManipulation ? { localManipulation: answer.localManipulation } : {}),
    evidenceLinks: buildEvidenceLinks(manipulationReport, aigcReport, provenanceReport),
    localizationReliability: assessLocalizationReliability(manipulationReport),
    decisionSource: sourceAnswer
      ? 'evidence_fusion'
      : mode === 'local' && !answer.extractionFailed
        ? (answer.decisionSource ?? 'vlm')
        : 'rule_fallback',
    upstreamDecision,
    confidence: UNAVAILABLE_CONFIDENCE,
    analysis: answer.summary,
    lead: answer.lead,
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
    answer.narrationSource === 'evidence_records' ? 'linked-evidence-summary' : producerName,
    mode,
    startTime,
    upstreamReports,
    errorMsg
  )
  report.extensions = {
    visualObservations: observations,
    pipeline: sourceAnswer
      ? 'verified_source_record_summary'
      : answer.narrationSource === 'evidence_records'
        ? 'linked_evidence_with_visual_context'
        : 'contour_guidance_unmarked_observation_original_assessment_then_narration',
    visualGuidance,
    assessment: answer.assessment,
    narrationFacts: answer.narrationFacts,
    regionSelection: {
      strategy: 'primary_per_localizer_by_area',
      totalCount: allRegions.length,
      presentedCount: sourceAnswer ? 0 : selectedRegions.length
    },
    rawJudgements,
    rawNarratives,
    structuredExtraction:
      sourceAnswer || answer.narrationSource === 'evidence_records'
        ? 'not_run'
        : answer.methodExtractionFailed
          ? 'failed'
          : mode === 'local'
            ? 'completed'
            : 'not_run',
    inputPresentation: {
      type: sourceAnswer
        ? 'source_records'
        : selectedRegions.length
          ? 'predicted_region_outer_contours'
          : 'full_image',
      imageCount: images.length,
      regionCount: sourceAnswer ? 0 : selectedRegions.length,
      annotationAddedBy: sourceAnswer ? null : 'app',
      forStage: sourceAnswer ? 'source_records' : 'visual_guidance',
      assessment: {
        type: sourceAnswer
          ? 'source_records'
          : answer.narrationSource === 'evidence_records'
            ? 'linked_detection_records'
            : 'unmarked_original',
        imageCount:
          sourceAnswer || answer.narrationSource === 'evidence_records' ? 0 : original ? 1 : 0
      },
      observation: {
        type: sourceAnswer ? 'not_run' : 'unmarked_region_and_document_context'
      },
      narration: {
        type: sourceAnswer
          ? 'source_record_summary'
          : answer.narrationSource === 'evidence_records'
            ? 'linked_evidence_summary'
            : 'text_only_evidence',
        imageCount: 0
      }
    }
  }

  const validationErrors = validateExplanationReport(report, upstreamReports)
  if (validationErrors.length > 0) {
    throw new Error(`解释报告校验失败：${validationErrors.join('; ')}`)
  }

  notify?.({
    phase: 'finished',
    label: mode === 'local' ? '综合分析已完成' : '智能分析未完成，检测报告仍可查看'
  })

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
  role: 'full_image' | 'annotated_input'
  regions?: string[]
}

async function prepareImages(
  bundle: EvidenceBundle,
  taskDirectory: string,
  maxImages: number,
  regions: Region[]
): Promise<{ images: string[]; references: ImageReference[]; original?: Buffer }> {
  const base64Images: string[] = []
  const references: ImageReference[] = []
  const displayArtifact = bundle.artifacts.find(
    (artifact) => artifact.artifactId === bundle.image.displayArtifactId
  )

  // One scene, with predicted outer contours. Never send a black/white mask as another image.
  if (displayArtifact && maxImages >= 1) {
    try {
      const original = await readFile(join(taskDirectory, displayArtifact.uri))
      const groups = new Map<string, Region[]>()
      for (const region of regions) {
        if (!region.maskArtifactId) throw new Error('候选区域缺少预测掩码')
        const group = groups.get(region.maskArtifactId) ?? []
        group.push(region)
        groups.set(region.maskArtifactId, group)
      }
      const layers = await Promise.all(
        [...groups].map(async ([id, group]) => {
          const artifact = bundle.artifacts.find(
            (item) => item.artifactId === id && item.type === 'mask'
          )
          if (!artifact || artifact.sourceArtifactId !== displayArtifact.artifactId)
            throw new Error('候选掩码与显示图像的关联无效')
          return { mask: await readFile(join(taskDirectory, artifact.uri)), regions: group }
        })
      )
      const annotated = await drawRegionBoundaries(original, layers)
      base64Images.push(annotated.toString('base64'))
      references.push({ index: 1, role: regions.length ? 'annotated_input' : 'full_image' })
      return { images: base64Images, references, original }
    } catch (error) {
      console.warn('准备边界标记图失败:', error)
      throw error
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
    const creatorTool = asRecord(provenanceForVlm(provenance).metadata).creatorTool
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
    const source = provenanceForVlm(provenance)
    const outcome = asRecord(provenance?.result?.credentials?.details).outcome ?? '未知'
    push('provenance', {
      text: `C2PA 凭证检查结果为 ${outcome}。${provenanceNarrationFacts({ credentials: source.credentials }).join(' ')}`,
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
    .filter((detector) => detector.status === 'failed')
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
    const credentials = asRecord(provenanceForVlm(provenance).credentials)
    if (asRecord(provenance?.result?.credentials?.details).outcome === 'manifest_container_found') {
      if (credentials.verification !== '本地凭证验证通过')
        items.push(`C2PA：${credentials.verification}。`)
    } else items.push('未发现内嵌来源凭证。')
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
  disagreements: string[],
  manipulation: ManipulationReport | undefined,
  aigc: AigcReport | undefined,
  selectedRegions: Region[],
  images: ImageReference[],
  imageWidth: number,
  imageHeight: number,
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
          source: record.source,
          target: record.target,
          calibrated: false,
          comparableAcrossModels: false,
          ...(supports ? { supports } : {})
        }
      : null
  }
  const models: JsonObject[] = [
    {
      model: 'SICA',
      task: '通用整图真实性分类',
      scope: 'whole_image',
      finding:
        classification.predictedClass === 'real'
          ? '通用伪造筛查未报警'
          : classification.predictedClass === 'fake'
            ? '整图存在可疑线索'
            : '本轮未运行或未完成',
      score: sicaScore,
      threshold: classification.threshold ?? null,
      decisionConfidence: sicaDecisionConfidence(sicaScore, classification.threshold),
      support: support(
        sicaClassSupport(sicaScore, classification.predictedClass),
        classification.predictedClass === 'real' ? '通用伪造筛查未报警' : '整图存在可疑线索'
      )
    },
    {
      model: 'FSD',
      task: 'AI生成分类',
      scope: 'whole_image',
      finding:
        aigc?.result?.decision === 'non_ai'
          ? '未检出AI生成线索'
          : aigc?.result?.decision === 'ai_generated'
            ? '存在AI生成线索'
            : '本轮未运行或未完成',
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
      scope: 'localized_regions',
      finding: detector?.status === 'completed' ? '已标记的局部异常候选' : '本轮未运行或未完成',
      regionCount: result.regionCount ?? null,
      support: support(result.confidence),
      shownRegionCount: regions.length,
      regions: regions.map((region) => ({
        bboxXYWH: region.bboxXYWH,
        position: regionPosition(region, imageWidth, imageHeight),
        support: support(region.confidence),
        observedContent: observations[selectedRegions.indexOf(region)]?.text ?? null
      }))
    })
  }
  const unavailableModels = getDetectors(manipulation)
    .filter((detector) => detector.status === 'failed')
    .map((detector) => ({
      model: detector.backend,
      status: 'failed',
      code: asRecord(detector.error).code
    }))
  return JSON.stringify({
    images: images.map((image) => ({ index: image.index, role: image.role })),
    annotation: { type: 'predicted_region_outer_contours', color: '青色', note: BOUNDARY_NOTE },
    imageRelationship:
      '所有图片和局部观察来自同一张待分析输入，没有编辑前参考图；裁剪仅用于看清内容',
    models: models.filter((model) => model.finding !== '本轮未运行或未完成'),
    evidenceLinks: buildEvidenceLinks(manipulation, aigc, provenance),
    localizationReliability: assessLocalizationReliability(manipulation),
    ...(unavailableModels.length ? { unavailableModels } : {}),
    provenance: provenanceForVlm(provenance),
    observationSource: '局部观察来自未加标记的原始局部像素，只描述内容，不代表异常已经证实。',
    disagreements,
    evidenceScope:
      '整图筛查、AI生成和局部编辑是不同任务；支持度说明各自结论，综合时结合局部标记与可见内容。',
    supportMeaning: '支持度描述模型对当前类别或标记像素的响应强度，非正确率，不跨模型按数值大小排名'
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
  config: ExplanationConfig,
  regionIds: string[],
  rawJudgements: unknown[],
  requestSignal: AbortSignal,
  notify: ((progress: Omit<ExplanationProgress, 'taskId' | 'imageId'>) => void) | undefined,
  rawNarratives: unknown[],
  candidates: NarrationCandidate[],
  original: Buffer | undefined,
  visualFocusHintIndex: number | null
): Promise<UserExplanation> {
  notify?.({ phase: 'synthesizing', label: '正在核对未标记原图与真实检测证据', text: '' })
  const evidence = { ...evidenceForAssessment(prompt, candidates), visualFocusHintIndex }
  const links = JSON.parse(prompt).evidenceLinks ?? []
  const linkedAssessment = linkAssessment(null, links, candidates)
  const assessment =
    linkedAssessment.decisionSource === 'evidence_fusion'
      ? linkedAssessment
      : await assessOriginal({
          original,
          evidence,
          count: candidates.length,
          config,
          signal: requestSignal,
          rawJudgements
        })
  const focus = assessment.focusIndex === null ? undefined : candidates[assessment.focusIndex - 1]
  const subject = (focus?.context || focus?.observedContent || '')
    .trim()
    .replace(/[。！!？?，,；;]+$/u, '')
  assessment.targetDescription = focus
    ? [
        joinTarget(focus.location, subject),
        focus.visibleText &&
        !(focus.context || focus.observedContent || '').includes(focus.visibleText)
          ? `“${focus.visibleText}”`
          : null
      ]
        .filter(Boolean)
        .join('，')
    : ''
  let linkedDescription: Awaited<ReturnType<typeof describeLinkedEvidence>> = null
  if (focus && assessment.decisionSource === 'evidence_fusion') {
    linkedDescription = await describeLinkedEvidence({
      original,
      target: assessment.targetDescription,
      evidence: { ...evidence, candidate: candidates[assessment.focusIndex! - 1] },
      config,
      signal: requestSignal,
      rawJudgements
    })
    if (linkedDescription) {
      assessment.targetDescription = joinTarget(focus.location, linkedDescription.subject)
      assessment.operation = linkedDescription.operation
      assessment.operationReason = linkedDescription.operationReason
    }
  }
  if (
    focus &&
    assessment.decision !== 'no_anomaly_detected' &&
    assessment.decisionSource !== 'evidence_fusion' &&
    !links.some(
      (link: { relation: string; question: string; models: string[] }) =>
        link.relation === 'different_tasks' &&
        link.question === 'ai_generation' &&
        link.models.includes('aigc')
    )
  ) {
    notify?.({ phase: 'synthesizing', label: '正在比较复制移动、拼接和移除修复三类方式' })
    Object.assign(
      assessment,
      await inferOperation({
        original,
        target: assessment.targetDescription,
        hasDuplicateEvidence:
          candidates.filter(
            (candidate) =>
              candidate.observedContent && candidate.observedContent === focus.observedContent
          ).length > 1,
        config,
        signal: requestSignal,
        rawJudgements
      })
    )
  }
  const facts = buildNarrationFacts({
    evidence: JSON.parse(prompt),
    decision: assessment.decision,
    focusIndex: assessment.focusIndex,
    candidates,
    assessment
  })
  const linked = linkedExplanation(
    assessment,
    links,
    candidates,
    provenanceNarrationFacts(evidence.provenance)
  )
  if (linked) {
    notify?.({
      phase: 'synthesizing',
      label: '正在汇总相互印证的筛查与定位证据',
      text: linked.summary,
      decision: linked.finalDecision
    })
    return { ...linked, narrationFacts: facts }
  }
  const selectedFocus =
    assessment.focusIndex === null ? undefined : candidates[assessment.focusIndex - 1]
  const lead = buildLead(assessment, selectedFocus)
  const writingQuestion = selectedFocus
    ? `首段已经写好为：“${lead}”。不要重复它，直接使用“补充依据”“手法判断”两个标题继续说明；依据分2至3条短项目，不新增事实。`
    : `首段已经写好为：“${lead}”。不要重复它，直接使用“补充依据”“手法判断”两个标题继续说明，不新增事实。`

  notify?.({
    phase: 'synthesizing',
    label: '判断已形成，正在整理位置与依据',
    text: '',
    decision: assessment.decision
  })
  const response = await fetch(`${config.host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: facts + '\n' + writingQuestion }
      ],
      stream: !!notify,
      options: { temperature: 0, num_predict: config.numPredict, num_ctx: config.numCtx }
    }),
    signal: requestSignal
  })
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
  let partialContent = ''
  let data: OllamaChatResponse
  try {
    data = notify
      ? await readOllamaChat(response, (text) => {
          partialContent = text
          notify({ phase: 'synthesizing', label: '正在生成分析说明', text })
        })
      : await response.json()
  } catch (error) {
    rawNarratives.push({
      message: { content: partialContent },
      incomplete: true,
      error: String(error)
    })
    throw error
  }
  rawNarratives.push(data)
  const narrative = data.message?.content
  if (!narrative?.trim()) throw new Error('Ollama 返回为空')
  if (data.done_reason === 'length') throw new Error('分析说明达到输出上限，未生成完整回答')

  // Optional verbatim operation reference; never rewrite the narrative or reclassify the image.
  notify?.({ phase: 'synthesizing', label: '回答已生成，正在保存证据引用' })
  let operationQuote: string | undefined,
    methodExtractionFailed = true
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const extracted = await fetch(`${config.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          format: {
            type: 'object',
            properties: { suspectedOperationQuote: { type: ['string', 'null'] } },
            required: ['suspectedOperationQuote'],
            additionalProperties: false
          },
          messages: [
            {
              role: 'system',
              content:
                '只逐字提取回答实际提出的候选编辑方式短语。若回答没有推测具体手法、明确无法区分或只列举方法类别，填null。不要重新判断图片。'
            },
            { role: 'user', content: JSON.stringify({ answer: narrative }) }
          ],
          options: { temperature: 0, num_predict: 160, num_ctx: config.numCtx }
        }),
        signal: requestSignal
      })
      if (!extracted.ok) throw new Error(`手法引用提取HTTP ${extracted.status}`)
      const raw = (await extracted.json()) as OllamaChatResponse
      rawJudgements.push({ stage: 'operation_extraction', ...raw })
      const value = JSON.parse(raw.message?.content ?? '')
      if (
        value.suspectedOperationQuote !== null &&
        typeof value.suspectedOperationQuote !== 'string'
      )
        continue
      if (typeof value.suspectedOperationQuote === 'string') {
        if (
          !value.suspectedOperationQuote.trim() ||
          !narrative.includes(value.suspectedOperationQuote)
        )
          continue
        operationQuote = value.suspectedOperationQuote
      }
      methodExtractionFailed = false
      break
    } catch (error) {
      rawJudgements.push({ stage: 'operation_extraction', extractionError: String(error) })
      if (requestSignal.aborted) break
    }
  }
  return {
    finalDecision: assessment.decision,
    summary: narrative,
    evidenceBalance: '',
    primaryRegionId: focus?.regionId ?? null,
    regions: focus
      ? [
          {
            regionId: focus.regionId,
            location: focus.location,
            subject:
              assessment.targetDescription ||
              focus.context ||
              focus.observedContent ||
              '疑似篡改位置',
            reason: narrative,
            suspectedOperation:
              assessment.operation !== 'unknown'
                ? OPERATION_NAMES[assessment.operation]
                : (operationQuote ?? OPERATION_NAMES.unknown),
            operationReason: assessment.operationReason
          }
        ]
      : [],
    methodExtractionFailed,
    lead,
    narrationFacts: facts,
    assessment
  }
}

function buildLead(assessment: EvidenceAssessment, focus: NarrationCandidate | undefined): string {
  if (!focus) {
    if (assessment.decision === 'no_anomaly_detected') return '目前没有发现明确的异常线索。'
    if (assessment.decision === 'inconclusive')
      return '现有检查结果暂不能形成明确判断，具体依据见下文。'
    return '当前检查发现了值得关注的图像异常线索，主要依据见下文。'
  }
  const target =
    assessment.targetDescription || focus?.context || focus?.observedContent || '图中被定位的位置'
  const method =
    assessment.operation === 'unknown'
      ? '具体手法暂不能区分'
      : `可能是${OPERATION_NAMES[assessment.operation]}`
  if (assessment.decision === 'no_anomaly_detected')
    return `目前没有发现明确的异常线索，${target}暂不支持确认发生了篡改。`
  if (assessment.decision === 'inconclusive')
    return `${target}被定位为需要重点核查的位置，${method}，但现有检查结果存在分歧，暂不能确认已经发生了篡改。`
  return `${target}存在值得重点核查的局部异常线索，${method}；这是模型结合当前证据提出的判断，仍需要把它作为疑似篡改处理。`
}

function regionPosition(region: Region, width: number, height: number): string {
  const [x, y, w, h] = region.bboxXYWH
  const horizontal =
    w >= (width * 2) / 3
      ? ''
      : x + w / 2 < width / 3
        ? '左侧'
        : x + w / 2 > (width * 2) / 3
          ? '右侧'
          : '中部'
  const vertical =
    h >= (height * 2) / 3
      ? ''
      : y + h / 2 < height / 3
        ? '上方'
        : y + h / 2 > (height * 2) / 3
          ? '下方'
          : ''
  return `图片${horizontal || vertical ? horizontal + vertical : w >= (width * 2) / 3 && h >= (height * 2) / 3 ? '大部分区域' : '中部'}`
}

function joinTarget(location: string, subject: string | null | undefined): string {
  const clean = (subject ?? '').trim().replace(/[。！!？?，,；;]+$/u, '')
  if (!clean) return location
  if (clean.includes(location)) return clean
  return `${location}的${clean}`
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
