import type { FinalDecision, Region } from '../../shared/protocol'
import { OPERATION_NAMES, type EvidenceAssessment } from './evidence-assessment'

type ObjectValue = Record<string, unknown>
const object = (v: unknown): ObjectValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as ObjectValue) : {}

export const DECISION_TEXT: Record<FinalDecision, string> = {
  suspicious: '有值得核查的异常线索',
  no_anomaly_detected: '未发现明确异常线索',
  inconclusive: '现有证据有分歧，暂不能确定'
}

/** An explanation focus, not a tamper-probability ranking. Preserve all detector regions upstream. */
export function primaryExplanationRegions(regions: Region[]): Region[] {
  const ranked = [...regions].sort(
    (a, b) =>
      Number(b.areaPixels ?? b.bboxXYWH[2] * b.bboxXYWH[3]) -
      Number(a.areaPixels ?? a.bboxXYWH[2] * a.bboxXYWH[3])
  )
  const seen = new Set<unknown>()
  return ranked
    .filter((region) => {
      const key = region.detector ?? region.maskArtifactId ?? region.regionId
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 3)
}

export interface NarrationCandidate {
  regionId: string
  location: string
  observedContent: string | null
  confidence?: unknown
  detector?: string
  context?: string | null
  visibleText?: string | null
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
        `SICA整图伪造筛查：${String(model.finding)}${responseWording(model.support) ? `，对这个分类结果的支持${responseWording(model.support)}` : ''}。`
      )
    if (model.model === 'FSD')
      lines.push(
        `FSD的AI生成检测：${String(model.finding)}${responseWording(model.support) ? `，对这个结果的支持${responseWording(model.support)}` : ''}，该项只评价AI生成。`
      )
  }
  if (Array.isArray(evidence.disagreements) && evidence.disagreements.length)
    lines.push(
      '检查结果之间存在分歧，最终分析倾向已综合这些结果；某一检查未触发提示，不能直接抵消局部候选。'
    )
  const provenance = object(evidence.provenance)
  if (assessment) {
    lines.push(`VLM综合图像与证据后提出的可能方式：${OPERATION_NAMES[assessment.operation]}。`)
    if (assessment.operationEvidence !== 'none')
      lines.push(
        `对应线索类型：${assessment.operationEvidence === 'duplicate_internal' ? '图内重复对象' : assessment.operationEvidence === 'external_boundary' ? '外部内容与边界关系' : '擦除或修复痕迹'}。`
      )
    if (assessment.operationReason)
      lines.push(`模型提出该方式的理由（推测）：${assessment.operationReason}`)
  }
  const credential = object(provenance.credentials).outcome
  if (credential === 'manifest_container_found')
    lines.push('来源检查发现了内嵌凭证标记；该标记不等于内容已验证真实。')
  if (object(provenance.watermark).outcome === 'candidate_watermark_indicators_found')
    lines.push('来源检查发现了水印候选线索，尚不能据此确定生成平台或是否篡改。')
  return lines.join('\n')
}

export function evidenceForAssessment(prompt: string, candidates: NarrationCandidate[]) {
  const parsed = object(JSON.parse(prompt))
  // Discard display-only fields, not evidence. The analyst receives the unmarked original.
  return {
    models: parsed.models,
    provenance: parsed.provenance,
    disagreements: parsed.disagreements,
    candidates: candidates.map((c, index) => ({
      index: index + 1,
      position: c.location,
      content: c.observedContent,
      context: c.context ?? null,
      visibleText: c.visibleText ?? null,
      detector: c.detector,
      support: c.confidence ?? null
    }))
  }
}
