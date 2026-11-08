import type { DetectorResult } from '../../shared/contracts'
import { sicaClassSupport, fsdClassSupport, sicaDecisionConfidence, fsdDecisionConfidence } from '../../shared/decision-confidence'
import { assessLocalizationReliability, buildEvidenceLinks } from './evidence-links'

// A concise reader/VLM view. The complete v1.0 bundle remains the audit record.
export function manipulationSummary(bundle: Record<string, any>, detectors: DetectorResult[]) {
  const report = bundle.reports.find((item: any) => item.moduleId === 'manipulation')
  if (!report) throw new Error('Evidence bundle is missing its manipulation report')
  const records = report.result?.detectors ?? report.extensions.detectorExecutions
  const assets = new Map<string, Record<string, any>>(
    bundle.artifacts.map((item: any) => [item.artifactId, item])
  )
  const uri = (id: string | null | undefined) => (id ? (assets.get(id)?.uri ?? null) : null)
  const evidence = report.evidence.map((entry: any) => ({
    evidenceId: entry.evidenceId,
    model: entry.data.detector,
    description: entry.description,
    artifacts: entry.artifactIds.map(uri)
  }))
  const model = (backend: string) => {
    const record = records.find((item: any) => item.backend === backend)
    return {
      id: backend,
      name: backend === 'aigc' ? 'FSD' : backend === 'sica' ? 'SICA' : backend === 'rita' ? 'RITA' : 'RiSE',
      ...(record?.producer ? { version: record.producer.version } : {}),
      ...(record?.checkpointSha256 ? { checkpointSha256: record.checkpointSha256 } : {})
    }
  }
  const screening = detectors.find((item) => item.backend === 'sica')!
  const aigc = detectors.find((item) => item.backend === 'aigc')!
  const errorSummary = (error: { code: string }) => ({
    code: error.code,
    message:
      (
        {
          MODEL_NOT_READY: '模型未就绪',
          INVALID_MODEL: '模型校验失败',
          TIMEOUT: '推理超时'
        } as Record<string, string>
      )[error.code] ?? '检测执行失败，详见完整记录。'
  })
  const regions = (report.result?.regions ?? []).map((region: any) => ({
    regionId: region.regionId,
    model: region.detector,
    bboxXYWH: region.bboxXYWH,
    ...(typeof region.areaPixels === 'number' ? { areaPixels: region.areaPixels } : {}),
    confidence: region.confidence ?? null,
    crop: uri(region.cropArtifactId)
  }))
  return {
    schemaVersion: '1.0',
    reportType: 'manipulation_summary',
    reportId: report.reportId,
    image: {
      imageId: bundle.image.imageId,
      sha256: bundle.image.sha256,
      width: bundle.image.width,
      height: bundle.image.height,
      original: uri(bundle.image.originalArtifactId),
      display: uri(bundle.image.displayArtifactId),
      coordinateSpace: 'display_image_pixels'
    },
    status: report.extensions.executionStatus,
    decision: 'inconclusive',
    evidenceLinks: buildEvidenceLinks(report, bundle.reports.find((r: any) => r.moduleId === 'aigc'), bundle.reports.find((r: any) => r.moduleId === 'provenance')),
    localizationReliability: assessLocalizationReliability(report),
    confidencePolicy: { reliability: 'not_calibrated', comparableAcrossModels: false },
    contentType: report.result?.contentType ?? null,
    routing: report.result?.routing
      ? {
          mode: report.result.routing.mode,
          status: report.result.routing.status,
          decision: report.result.routing.decision,
          ...(report.result.routing.scores
            ? { scores: report.result.routing.scores }
            : {}),
          ...(typeof report.result.routing.margin === 'number'
            ? { margin: report.result.routing.margin }
            : {}),
          ...(typeof report.result.routing.marginThreshold === 'number'
            ? { marginThreshold: report.result.routing.marginThreshold }
            : {}),
          ...(report.result.routing.error
            ? { error: report.result.routing.error }
            : {})
        }
      : null,
    screening: {
      model: model('sica'),
      status: screening.status,
      ...(screening.classification
        ? {
            decision: screening.classification.decision,
            score: screening.classification.score,
            threshold: screening.classification.threshold,
            confidence: sicaClassSupport(screening.classification.score, screening.classification.decision),
            decisionConfidence: sicaDecisionConfidence(screening.classification.score, screening.classification.threshold),
            calibrated: false
          }
        : {}),
      ...(screening.error ? { error: errorSummary(screening.error) } : {})
    },
    // [第三人任务] 联合报告在整图筛查前保留 FSD AIGC 结果。
    aigc: {
      model: model('aigc'),
      status: aigc.status,
      ...(aigc.aigc ? {
        decision: aigc.aigc.decision,
        zScore: aigc.aigc.zScore,
        threshold: aigc.aigc.threshold,
        confidence: fsdClassSupport(aigc.aigc.zScore, aigc.aigc.threshold, aigc.aigc.decision),
        decisionConfidence: fsdDecisionConfidence(aigc.aigc.zScore, aigc.aigc.threshold),
        attributedSource: aigc.aigc.attributedSource,
        attributionScore: aigc.aigc.attributionScore
      } : {}),
      ...(aigc.error ? { error: errorSummary(aigc.error) } : {})
    },
    localization: detectors
      // [第三人任务] FSD 结果写入单独的 aigc 字段，不计入最多两项的局部定位列表。
      .filter((item) => item.backend !== 'sica' && item.backend !== 'aigc')
      .map((item) => {
        const own = bundle.artifacts.filter((asset: any) =>
          asset.uri.startsWith(`detectors/${item.backend}/`)
        )
        const listed = regions.filter((region: any) => region.model === item.backend)
        return {
          model: model(item.backend),
          status: item.status,
          ...(item.localization
            ? {
                regionCount: item.localization.regionCount,
                confidence: records.find((record: any) => record.backend === item.backend)?.result?.confidence ?? null,
                listedRegionCount: listed.length,
                areaFraction: item.localization.manipulatedAreaFraction,
                mask: own.find((asset: any) => asset.type === 'mask')?.uri ?? null,
                heatmap: own.find((asset: any) => asset.type === 'heatmap')?.uri ?? null,
                evidenceIds: evidence
                  .filter((entry: any) => entry.model === item.backend)
                  .map((entry: any) => entry.evidenceId)
              }
            : {}),
          ...(item.error ? { error: errorSummary(item.error) } : {})
        }
      }),
    regions,
    evidence,
    disagreements: report.result?.disagreements ?? [],
    limitations: [
      '筛查分数与定位响应不是整图真实性概率；标记区域可能包含误报。',
      '本摘要仅含篡改视觉检测；来源与水印见bundle.json，通用OCR与综合解释由后续模块处理。'
    ],
    audit: 'bundle.json'
  }
}
