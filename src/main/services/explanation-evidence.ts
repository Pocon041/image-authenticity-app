import type { FinalDecision, Region, EvidenceLink } from '../../shared/protocol'
import type { UserExplanation } from './user-explanation'
import { OPERATION_NAMES, type EvidenceAssessment } from './evidence-assessment'
import { provenanceNarrationFacts } from './provenance-input'
import type { NearbyText } from './region-text'

type ObjectValue = Record<string, unknown>
const object = (v: unknown): ObjectValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as ObjectValue) : {}

export const DECISION_TEXT: Record<FinalDecision, string> = {
  suspicious: '有值得核查的异常线索',
  no_anomaly_detected: '未发现明确异常线索',
  inconclusive: '现有证据有分歧，暂不能确定'
}

/** An explanation focus, not a tamper-probability ranking. Preserve all detector regions upstream. */
export function primaryExplanationRegions(
  regions: Region[],
  options: { regionsPerLocalizer?: number } = {}
): Region[] {
  const regionsPerLocalizer = Math.max(1, options.regionsPerLocalizer ?? 1)
  const ranked = [...regions].sort(
    (a, b) =>
      Number(b.areaPixels ?? b.bboxXYWH[2] * b.bboxXYWH[3]) -
      Number(a.areaPixels ?? a.bboxXYWH[2] * a.bboxXYWH[3])
  )
  const counts = new Map<unknown, number>()
  return ranked
    .filter((region) => {
      const key = region.detector ?? region.maskArtifactId ?? region.regionId
      const count = counts.get(key) ?? 0
      if (count >= regionsPerLocalizer) return false
      counts.set(key, count + 1)
      return true
    })
    .slice(0, 3)
}

export interface NarrationCandidate {
  regionId: string
  sourceRegionId?: string
  location: string
  observedContent: string | null
  confidence?: unknown
  detector?: string
  context?: string | null
  visibleText?: string | null
  contextSource?: string
  nearbyText?: NearbyText[]
}

/** Join compatible findings, not confidence magnitudes; retain the VLM's own visual assessment. */
export function linkAssessment(
  visual: EvidenceAssessment | null,
  links: EvidenceLink[],
  candidates: NarrationCandidate[]
): EvidenceAssessment {
  const base: EvidenceAssessment = visual ?? {
    decision: 'inconclusive',
    focusIndex: null,
    targetDescription: '',
    operation: 'unknown',
    operationReason: '',
    operationEvidence: 'none'
  }
  const link = links.find(
    (item) =>
      item.relation === 'corroborates' &&
      item.strength === 'strong' &&
      ['local_editing', 'image_anomaly'].includes(item.question)
  )
  if (!link) return { ...base, decisionSource: 'vlm' }
  const eligible = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) =>
      link.regionIds.includes(candidate.sourceRegionId ?? candidate.regionId)
    )
  if (!eligible.length) return { ...base, decisionSource: 'vlm' }
  const focus = eligible.find(({ index }) => index + 1 === base.focusIndex) ?? eligible[0]
  return {
    ...base,
    ...(visual ? { visualDecision: visual.decision, visualReason: visual.decisionReason } : {}),
    decision: 'suspicious',
    decisionSource: 'evidence_fusion',
    localManipulation: link.question === 'local_editing' ? 'supported' : 'uncertain',
    decisionReason: link.description,
    focusIndex: focus.index + 1
  }
}

/** Detector facts are quoted from records; visual content and methods keep their own origins. */
export function linkedExplanation(
  assessment: EvidenceAssessment,
  links: EvidenceLink[],
  candidates: NarrationCandidate[],
  provenanceFacts: string[] = []
): UserExplanation | null {
  if (assessment.decisionSource !== 'evidence_fusion' || assessment.focusIndex === null) return null
  const focus = candidates[assessment.focusIndex - 1]
  const target = assessment.targetDescription || focus.location
  const locatingModel = focus.detector === 'rise' ? 'RiSE' : 'RITA'
  const aiClue = links.some(
    (link) =>
      link.question === 'ai_generation' &&
      link.models.includes('aigc') &&
      link.relation === 'different_tasks'
  )
  const regionCount = Math.max(
    1,
    links.find(
      (link) =>
        link.relation === 'corroborates' &&
        (link.question === 'local_editing' || link.question === 'image_anomaly')
    )?.regionIds.length ?? 1
  )
  const evidenceLines = [
    '- SICA的整图筛查发现了通用伪造线索。',
    `- ${locatingModel}在${regionCount > 1 ? `图中共${regionCount}处` : target}标出了局部异常${regionCount > 1 ? `，重点查看${target}` : ''}，与整图筛查相互支持。`,
    ...links
      .filter((item) => item.relation === 'different_tasks')
      .map((item) => `- ${item.description}`)
  ]
  const photoshop = provenanceFacts.find((fact) => /文件记录的编辑工具/u.test(fact))
  if (photoshop)
    evidenceLines.push(
      `- ${photoshop.replace(/[。；]+$/u, '')}；这说明文件有后期处理背景，但本身不等于AI生成。`
    )
  const method = aiClue
    ? '本轮同时发现AI生成线索，尚不能区分整图生成、AI局部编辑或其他后期处理。'
    : assessment.operation === 'unknown'
      ? '检测结果支持该位置存在局部篡改，具体是复制移动、拼接还是移除修复，尚不能区分。'
      : `可能涉及${OPERATION_NAMES[assessment.operation]}。${assessment.operationReason}（图像模型推测）`
  const summary = `### 判断依据\n${evidenceLines.join('\n')}\n\n### 可能方式\n${method}`
  return {
    finalDecision: 'suspicious',
    decisionSource: 'evidence_fusion',
    narrationSource: 'evidence_records',
    localManipulation: aiClue ? 'uncertain' : 'supported',
    ...(aiClue ? { aiGeneration: 'supported' as const } : {}),
    lead: aiClue
      ? `这张图像存在伪造及AI生成线索，${target}是定位模型标出的异常位置。`
      : `这张图像存在明确的局部篡改迹象，${regionCount > 1 ? `共定位到${regionCount}处异常区域，重点是${target}` : `重点是${target}`}。整图筛查与局部定位相互支持。`,
    summary,
    evidenceBalance: '',
    primaryRegionId: focus.regionId,
    assessment: { ...assessment, localManipulation: aiClue ? 'uncertain' : 'supported' },
    regions: [
      {
        regionId: focus.regionId,
        location: focus.location,
        subject: target,
        reason: evidenceLines.join('\n'),
        suspectedOperation: OPERATION_NAMES[assessment.operation],
        operationReason: assessment.operationReason
      }
    ]
  }
}

/** Verbal presentation of a bounded locator response only; not a correctness or fusion threshold. */
function responseWording(value: unknown) {
  const v = object(value).value
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return null
  return v >= 0.8 ? '较强' : v >= 0.5 ? '中等' : '较弱'
}

/** Only actual evidence reaches the writer: no graphics instructions, coordinates or raw scores. */
export function buildNarrationFacts(input: {
  evidence: ObjectValue
  decision: FinalDecision
  focusIndex: number | null
  candidates: NarrationCandidate[]
  assessment?: EvidenceAssessment
}): string {
  const { evidence, decision, candidates, focusIndex, assessment } = input
  const focus = focusIndex === null ? undefined : candidates[focusIndex - 1]
  const lines = [
    '这是已经完成检查的图片分析记录。',
    `本次最终分析倾向：${DECISION_TEXT[decision]}。`
  ]
  if (assessment?.decisionReason)
    lines.push(
      `${assessment.decisionSource === 'evidence_fusion' ? '检测关系汇总依据' : 'VLM原图判断时返回的简短依据'}：${assessment.decisionReason}`
    )
  if (focus) {
    lines.push(
      `重点位置：${assessment?.targetDescription || focus.context || focus.observedContent || focus.location}。`
    )
    if (focus.visibleText) lines.push(`该处清楚可辨的原文：${focus.visibleText}`)
    lines.push(
      `局部定位结果：${focus.detector === 'rise' ? 'RiSE' : focus.detector === 'rita' ? 'RITA' : '定位模型'}标出了这一处疑似篡改的位置。`
    )
    const strength = responseWording(focus.confidence)
    if (strength) lines.push(`该定位器在这一区域的响应强度：${strength}。`)
  } else if (candidates.length)
    lines.push(`检测器标出了${candidates.length}处需要检查的位置，尚未指定重点。`)
  for (const value of Array.isArray(evidence.models) ? evidence.models : []) {
    const model = object(value)
    if (model.finding === '本轮未运行或未完成') continue
    if (model.model === 'SICA')
      lines.push(
        `SICA整图伪造筛查（作用范围：整张图片）：${String(model.finding)}${responseWording(model.decisionConfidence ?? model.support) ? `，对这个分类结果的阈值距离支持${responseWording(model.decisionConfidence ?? model.support)}` : ''}。`
      )
    if (model.model === 'FSD')
      lines.push(
        `FSD的AI生成检测（作用范围：整张图片）：${String(model.finding)}${responseWording(model.support) ? `，对这个结果的支持${responseWording(model.support)}` : ''}，该项只评价AI生成。`
      )
  }
  if (Array.isArray(evidence.disagreements) && evidence.disagreements.length)
    lines.push(
      '检查结果之间存在分歧，最终分析倾向已综合这些结果；某一检查未触发提示，不能直接抵消局部候选。'
    )
  if (assessment) {
    lines.push(`VLM综合图像与证据后提出的可能方式：${OPERATION_NAMES[assessment.operation]}。`)
    if (assessment.operationEvidence !== 'none')
      lines.push(
        `对应线索类型：${assessment.operationEvidence === 'duplicate_internal' ? '图内重复对象' : assessment.operationEvidence === 'external_boundary' ? '外部内容与边界关系' : '擦除或修复痕迹'}。`
      )
    if (assessment.operationReason)
      lines.push(`模型提出该方式的理由（推测）：${assessment.operationReason}`)
  }
  lines.push(...provenanceNarrationFacts(evidence.provenance))
  if (Array.isArray(evidence.unavailableModels) && evidence.unavailableModels.length)
    lines.push(
      `本次执行失败的检查：${evidence.unavailableModels.map((item) => object(item).model).join('、')}。`
    )
  return lines.join('\n')
}

export function evidenceForAssessment(prompt: string, candidates: NarrationCandidate[]) {
  const parsed = object(JSON.parse(prompt))
  const qualitative = (value: unknown) => {
    const item = object(value)
    const support = object(item.support)
    const decision = object(item.decisionConfidence)
    const raw = typeof decision.value === 'number' ? decision.value : support.value
    return responseWording({ value: raw }) ?? '未提供'
  }
  const models = Array.isArray(parsed.models)
    ? parsed.models.map((value) => {
        const model = object(value)
        const regions = Array.isArray(model.regions)
          ? model.regions.map((region) => {
              const item = object(region)
              return {
                position: item.position,
                supportLevel: qualitative({ support: item.support }),
                observedContent: item.observedContent ?? null
              }
            })
          : undefined
        return {
          model: model.model,
          task: model.task,
          scope: model.scope,
          finding: model.finding,
          supportLevel: qualitative(model),
          regionCount: model.regionCount ?? null,
          shownRegionCount: model.shownRegionCount ?? null,
          ...(regions ? { regions } : {})
        }
      })
    : []
  // Discard display-only fields, not evidence. The analyst receives the unmarked original.
  return {
    models,
    ...(parsed.unavailableModels ? { unavailableModels: parsed.unavailableModels } : {}),
    provenance: parsed.provenance,
    evidenceLinks: Array.isArray(parsed.evidenceLinks)
      ? parsed.evidenceLinks.map((link) => ({
          relation: link.relation,
          question: link.question,
          strength: link.strength,
          models: link.models,
          description: link.description
        }))
      : [],
    localizationReliability: parsed.localizationReliability,
    imageRelationship: parsed.imageRelationship,
    disagreements: parsed.disagreements,
    candidates: candidates.map((c, index) => ({
      index: index + 1,
      position: c.location,
      content: c.observedContent,
      context: c.context ?? null,
      ...(c.contextSource ? { contextSource: c.contextSource } : {}),
      ...(c.nearbyText?.length ? { nearbyText: c.nearbyText } : {}),
      visibleText: c.visibleText ?? null,
      detector: c.detector,
      supportLevel: responseWording(c.confidence) ?? '未提供'
    }))
  }
}
