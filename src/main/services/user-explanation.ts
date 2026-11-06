import type { FinalDecision } from '../../shared/protocol'
import type { EvidenceAssessment } from './evidence-assessment'

export interface UserExplanation {
  extractionFailed?: boolean
  methodExtractionFailed?: boolean
  narrationFacts?: string
  assessment?: EvidenceAssessment
  finalDecision: FinalDecision
  summary: string
  evidenceBalance: string
  primaryRegionId?: string | null
  regions: {
    regionId: string
    location: string
    subject: string
    reason: string
    suspectedOperation?: string
    operationReason?: string
  }[]
}

export const USER_EXPLANATION_SYSTEM =
  '将图片分析记录转述成简洁自然的用户说明，忠实保留判断和事实，不新增分析。正文用两个标题：### 重点位置、### 分析依据。重点位置一句话说明哪条记录的哪个字段或具体对象，保留可辨认关键原文。分析依据用2至3条短项目，将模型结果、支持程度、定位和可能方式结合说明，手法以“可能”表述。不要说“候选区域”，不要复述坐标、内部编号或专业小数。'

export const JUDGEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    finalDecision: { type: 'string', enum: ['suspicious', 'no_anomaly_detected', 'inconclusive'] },
    primaryRegionId: { type: ['string', 'null'] },
    subject: { type: 'string' },
    suspectedOperationQuote: { type: ['string', 'null'] }
  },
  required: ['finalDecision', 'primaryRegionId', 'subject', 'suspectedOperationQuote']
}

export const operationNames: Record<string, string> = {
  copy_move: '复制移动',
  splicing: '拼接',
  removal: '擦除',
  inpainting: '局部修复或重绘',
  text_edit: '文字修改',
  ai_generation: 'AI生成',
  unknown: '暂不能区分'
}

/** Only validate shape and region identity; never filter the model's judgement or wording. */
export function parseUserExplanation(
  value: unknown,
  regionIds: readonly string[]
): UserExplanation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  let v = value as Record<string, unknown>
  if (
    typeof v.explanation === 'string' &&
    typeof v.subject === 'string' &&
    typeof v.suspectedOperation === 'string'
  ) {
    if (!Object.hasOwn(operationNames, v.suspectedOperation)) return null
    const operation = operationNames[v.suspectedOperation]
    v = {
      finalDecision: v.finalDecision,
      primaryRegionId: v.primaryRegionId,
      summary: v.explanation,
      evidenceBalance: '',
      regions:
        typeof v.primaryRegionId === 'string'
          ? [
              {
                regionId: v.primaryRegionId,
                location: '',
                subject: v.subject,
                reason: v.explanation,
                suspectedOperation: operation,
                operationReason: ''
              }
            ]
          : []
    }
  }
  const text = (x: unknown) => typeof x === 'string' && !!x.trim()
  if (
    typeof v.finalDecision !== 'string' ||
    !['suspicious', 'no_anomaly_detected', 'inconclusive'].includes(v.finalDecision) ||
    !text(v.summary) ||
    typeof v.evidenceBalance !== 'string' ||
    !Array.isArray(v.regions) ||
    v.regions.length > 3 ||
    (v.primaryRegionId !== undefined &&
      v.primaryRegionId !== null &&
      (typeof v.primaryRegionId !== 'string' || !regionIds.includes(v.primaryRegionId)))
  )
    return null
  const seen = new Set<string>()
  for (const region of v.regions) {
    if (
      !region ||
      typeof region !== 'object' ||
      Array.isArray(region) ||
      typeof region.regionId !== 'string' ||
      !regionIds.includes(region.regionId) ||
      seen.has(region.regionId) ||
      typeof region.location !== 'string' ||
      !text(region.subject) ||
      !text(region.reason) ||
      (region.suspectedOperation !== undefined && typeof region.suspectedOperation !== 'string') ||
      (region.operationReason !== undefined && typeof region.operationReason !== 'string')
    )
      return null
    seen.add(region.regionId)
  }
  if (typeof v.primaryRegionId === 'string' && !seen.has(v.primaryRegionId)) return null
  return v as unknown as UserExplanation
}
