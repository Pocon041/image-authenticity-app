import type { ContentType, DetectorBackend, DetectorResult } from '../../shared/contracts'

export const detectorNames: Record<DetectorBackend, string> = {
  aigc: 'FSD AI 生成检测',
  sica: 'SICA',
  rita: 'RITA',
  rise: 'RiSE'
}
export function plannedDetectors(type: ContentType, supplement = false): DetectorBackend[] {
  if (type === 'unsure') return ['aigc', 'sica', 'rita', 'rise']
  const primary = type === 'photo' ? 'rita' : 'rise'
  return supplement ? ['aigc', 'sica', primary, primary === 'rita' ? 'rise' : 'rita'] : ['aigc', 'sica', primary]
}
export function workflowFlags(detectors: DetectorResult[]): string[] {
  const flags: string[] = []
  const screening = detectors.find(
    (d) => d.backend === 'sica' && d.status === 'completed'
  )?.classification
  const localized = detectors.filter((d) => d.status === 'completed' && d.localization)
  const found = localized.some((d) => d.localization!.regionCount > 0)
  if (screening?.decision === 'real' && found)
    flags.push('整图筛查倾向真实，但定位器标记了局部异常。')
  if (screening?.decision === 'fake' && localized.length > 0 && !found)
    flags.push('整图筛查可疑，当前定位器尚未标记具体区域。')
  if (localized.length === 2 && localized.some((d) => d.localization!.regionCount === 0) && found)
    flags.push('两种定位器对是否存在可疑区域的输出不一致。')
  if (detectors.some((d) => d.status === 'failed'))
    flags.push('部分检测未完成，请结合失败项目查看结果。')
  return flags
}
