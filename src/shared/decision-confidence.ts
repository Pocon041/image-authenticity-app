/** Threshold distance for a model's own decision, never accuracy or a fusion weight. */
export interface DecisionConfidence {
  value: number
  source: 'threshold_distance'
  distance: number
  normalization: 'class_side_range' | 'distance_over_distance_plus_one'
  calibrated: false
  comparableAcrossModels: false
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Support for a stated task, not the probability of correctness. */
export interface ModelSupport {
  value: number
  description: string
  target: 'general_image_classification' | 'ai_generation_classification' | 'marked_region_pixels'
  source: 'model_sigmoid' | 'threshold_distance' | 'mean_tamper_response'
  calibrated: false
  comparableAcrossModels: false
}

export function sicaClassSupport(score: unknown, decision: unknown): ModelSupport | null {
  if (!finite(score) || score < 0 || score > 1 || (decision !== 'real' && decision !== 'fake'))
    return null
  return {
    value: decision === 'fake' ? score : 1 - score,
    description: '当前预测类别的模型支持度',
    target: 'general_image_classification', source: 'model_sigmoid',
    calibrated: false, comparableAcrossModels: false
  }
}

export function fsdClassSupport(score: unknown, threshold: unknown, decision: unknown): ModelSupport | null {
  if (decision !== 'ai_generated' && decision !== 'non_ai') return null
  const margin = fsdDecisionConfidence(score, threshold)
  return margin ? {
    value: margin.value, description: '当前AI分类的阈值距离支持度', target: 'ai_generation_classification', source: 'threshold_distance',
    calibrated: false, comparableAcrossModels: false
  } : null
}

export function sicaDecisionConfidence(
  score: unknown,
  threshold: unknown
): DecisionConfidence | null {
  if (
    !finite(score) ||
    !finite(threshold) ||
    score < 0 ||
    score > 1 ||
    threshold < 0 ||
    threshold > 1
  )
    return null
  const distance = Math.abs(score - threshold)
  const range = score >= threshold ? 1 - threshold : threshold
  return {
    value: distance === 0 ? 0 : Math.min(1, distance / range),
    source: 'threshold_distance',
    distance,
    normalization: 'class_side_range',
    calibrated: false,
    comparableAcrossModels: false
  }
}

export function fsdDecisionConfidence(
  score: unknown,
  threshold: unknown
): DecisionConfidence | null {
  if (!finite(score) || !finite(threshold)) return null
  const distance = Math.abs(score - threshold)
  if (!Number.isFinite(distance)) return null
  return {
    value: distance / (1 + distance),
    source: 'threshold_distance',
    distance,
    normalization: 'distance_over_distance_plus_one',
    calibrated: false,
    comparableAcrossModels: false
  }
}
