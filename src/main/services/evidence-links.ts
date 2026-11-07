import type {
  AigcReport,
  ManipulationReport,
  ProvenanceReport,
  EvidenceLink
} from '../../shared/protocol'
import { verifiedAiCredential } from './source-conclusion'

/** Connect measured findings by their question; never combine their numeric scores. */
export function buildEvidenceLinks(
  manipulation?: ManipulationReport,
  aigc?: AigcReport,
  provenance?: ProvenanceReport
): EvidenceLink[] {
  const links: EvidenceLink[] = []
  const records =
    manipulation?.mode === 'local' && manipulation.status === 'completed'
      ? manipulation.result?.detectors
      : []
  const detectors = Array.isArray(records) ? (records as Record<string, any>[]) : []
  const sica = detectors.find((d) => d.backend === 'sica' && d.status === 'completed')
  const decision = sica?.result?.classification?.predictedClass
  const fsd = aigc?.mode === 'local' && aigc.status === 'completed' ? aigc.result?.decision : null
  const declaredAi = verifiedAiCredential(provenance)
  const regions = manipulation?.result?.regions ?? []
  const localized = detectors.filter(
    (d) => ['rita', 'rise'].includes(d.backend) && d.status === 'completed'
  )
  const ids = (model: string) =>
    (model === 'aigc'
      ? aigc?.evidence
      : model === 'provenance'
        ? provenance?.evidence
        : manipulation?.evidence
    )
      ?.filter((e) =>
        model === 'aigc'
          ? e.kind === 'aigc_classification'
          : model === 'provenance'
            ? e.kind === 'c2pa_manifest_presence'
            : e.data.detector === model
      )
      .map((e) => e.evidenceId) ?? []
  const add = (
    relation: EvidenceLink['relation'],
    question: EvidenceLink['question'],
    strength: EvidenceLink['strength'],
    models: string[],
    regionIds: string[],
    description: string
  ) => {
    const evidenceIds = [...new Set(models.flatMap(ids))]
    if (models.every((model) => ids(model).length) && evidenceIds.length)
      links.push({ relation, question, strength, models, evidenceIds, regionIds, description })
  }
  const hits = localized.filter(
    (d) => d.result?.regionCount > 0 && regions.some((r) => r.detector === d.backend)
  )
  const detectorResponse = (detector: Record<string, any>) => {
    const direct = detector.result?.confidence?.value ?? detector.result?.score?.value
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct
    const regional = regions
      .filter((region) => region.detector === detector.backend)
      .map((region) => region.confidence?.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    return regional.length ? Math.max(...regional) : null
  }
  const strongHits = hits.filter((detector) => {
    const response = detectorResponse(detector)
    return response !== null && response >= 0.8
  })
  const regionIds = regions
    .filter((r) => hits.some((d) => d.backend === r.detector))
    .map((r) => r.regionId)
  const strongRegionIds = regions
    .filter((r) => strongHits.some((d) => d.backend === r.detector))
    .map((r) => r.regionId)
  const names = hits.map((d) => (d.backend === 'rita' ? 'RITA' : 'RiSE')).join('、')
  const strongNames = strongHits.map((d) => (d.backend === 'rita' ? 'RITA' : 'RiSE')).join('、')
  if (
    decision === 'fake' &&
    strongHits.length &&
    ids('sica').length &&
    strongHits.some((d) => ids(d.backend).length)
  )
    add(
      'corroborates',
      fsd === 'ai_generated' || declaredAi ? 'image_anomaly' : 'local_editing',
      'strong',
      ['sica', ...strongHits.map((d) => d.backend)],
      strongRegionIds,
      `SICA检出通用伪造线索，${strongNames}以较强区域响应标出了局部异常；整图筛查与位置证据相互支持。`
    )
  if (decision === 'real' && hits.length)
    add(
      'different_findings',
      'local_editing',
      'supporting',
      ['sica', ...hits.map((d) => d.backend)],
      regionIds,
      `SICA未报警，${names}标出了局部异常，局部结果需结合原图查看。`
    )
  if (fsd === 'non_ai' && (hits.length || decision === 'fake'))
    add(
      'different_tasks',
      'local_editing',
      'supporting',
      ['aigc', ...(decision === 'fake' ? ['sica'] : []), ...hits.map((d) => d.backend)],
      regionIds,
      'FSD未检出AI生成线索；该结果回答AI生成问题，与传统局部编辑线索可以同时成立。'
    )
  if (fsd === 'ai_generated' && decision === 'real')
    add(
      'different_tasks',
      'ai_generation',
      'supporting',
      ['aigc', 'sica'],
      [],
      'FSD检出AI生成线索，SICA通用筛查未报警；两项检测的任务覆盖不同。'
    )
  if (fsd === 'ai_generated' && hits.length)
    add(
      'different_tasks',
      'ai_generation',
      'supporting',
      ['aigc', ...hits.map((d) => d.backend)],
      regionIds,
      'FSD检出AI生成线索，定位器提供局部异常范围；这些结果还不能区分整图生成与额外的局部编辑。'
    )
  if (declaredAi && (fsd === 'ai_generated' || fsd === 'non_ai'))
    add(
      fsd === 'ai_generated' ? 'corroborates' : 'different_findings',
      'ai_generation',
      fsd === 'ai_generated' ? 'strong' : 'supporting',
      ['provenance', 'aigc'],
      [],
      fsd === 'ai_generated'
        ? '文件绑定的AI生成声明与FSD生成检测相互印证。'
        : '来源声明记录AI生成或合成，但FSD本轮未检出生成线索。'
    )
  if (hits.length && localized.some((d) => d.result?.regionCount === 0))
    add(
      'different_findings',
      'local_editing',
      'supporting',
      localized.map((d) => d.backend),
      regionIds,
      '两个定位器对是否标记局部异常有不同反馈，各自掩码独立保留。'
    )
  return links
}
