import type { FinalDecision, Region } from '../../shared/protocol'

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
}): string {
  const { evidence, decision, candidates, focusIndex } = input
  const focus = focusIndex === null ? undefined : candidates[focusIndex - 1]
  const lines = [
    '这是已经完成检查的图片分析记录。',
    `本次最终分析倾向：${DECISION_TEXT[decision]}。`
  ]
  if (focus) {
    lines.push(
      `优先核查的位置与对象：${focus.location}，${focus.observedContent ?? '候选内容尚未辨认'}。`
    )
    lines.push('局部定位结果：定位模型在这一范围检出了候选区域。')
    const strength = responseWording(focus.confidence)
    if (strength) lines.push(`该定位器在这一区域的响应强度：${strength}。`)
  } else if (candidates.length)
    lines.push(`检测器共提供${candidates.length}处主要候选，尚未指定优先对象。`)
  for (const value of Array.isArray(evidence.models) ? evidence.models : []) {
    const model = object(value)
    if (model.finding === '本轮未运行或未完成') continue
    if (model.model === 'SICA')
      lines.push(
        model.finding === '通用伪造筛查未报警'
          ? '全图通用特征检查：这一项未触发异常提示。'
          : `全图通用特征检查：${String(model.finding)}。`
      )
    if (model.model === 'FSD' && (model.finding === '存在AI生成线索' || !focus))
      lines.push(`AI生成检查：${String(model.finding)}，这一项只评价AI生成特征。`)
  }
  if (Array.isArray(evidence.disagreements) && evidence.disagreements.length)
    lines.push(
      '检查结果之间存在分歧，最终分析倾向已综合这些结果；某一检查未触发提示，不能直接抵消局部候选。'
    )
  const provenance = object(evidence.provenance)
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
      support: c.confidence ?? null
    }))
  }
}
