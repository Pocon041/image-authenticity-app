// src/shared/protocol.ts
// 协议 v1.0 类型定义，严格对应 schemas/report-bundle.schema.json。
// 与 src/shared/contracts.ts 中的现有 UI 类型（AnalysisReport 等）互相独立，
// 两者之间通过 adapter 连接，不在这里混用。
//
// 约定：
// - result 采用「每个模块一个 interface，result 为 ResultType | null」的方案；
//   status 与 result/error 的联动约束由 validate* 运行时校验函数保证。
// - schema 中 open object（operationHints、clues、details、data、extensions）统一用 Record<string, unknown>。
// - 字符串 pattern（hash、imageId）在类型层无法表达，交由运行时校验。

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import bundleSchema from '../../schemas/report-bundle.schema.json'

// ===== 基础标量与元组 =====

export type Id = string
export type Hash = string // 运行时保证 ^[a-f0-9]{64}$
export type ImageId = string // 运行时保证 ^sha256:[a-f0-9]{64}$
export type BBox = [number, number, number, number] // [x>=0, y>=0, w>=1, h>=1]

// ===== 状态与枚举 =====

export type ReportStatus = 'completed' | 'failed' | 'unsupported' | 'not_run'
export type ReportMode = 'mock' | 'local'
export type ModuleId = 'provenance' | 'manipulation' | 'aigc' | 'explanation'

export type FinalDecision = 'suspicious' | 'no_anomaly_detected' | 'inconclusive'
export type ManipulationDecision = FinalDecision
export type AigcDecision = 'ai_generated' | 'non_ai' | 'inconclusive'
export type CheckStatus = 'completed' | 'failed' | 'unsupported' | 'not_run'

export type ArtifactType = 'original' | 'display' | 'crop' | 'mask' | 'heatmap'
export type ArtifactCoordinateSpace =
  'encoded_file_pixels' | 'display_image_pixels' | 'region_local_pixels'
export type ArtifactOrigin = 'original' | 'derived' | 'mock'
export type EvidenceOrigin = 'measured' | 'mock'

// ===== 图片与附件 =====

export interface ImageInfo {
  imageId: ImageId
  sha256: Hash
  originalArtifactId: Id
  displayArtifactId: Id
  encodedWidth: number
  encodedHeight: number
  width: number
  height: number
  exifOrientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  coordinateSpace: 'display_image_pixels'
  displayTransform: 'exif_auto_orient_no_resize'
}

export interface Artifact {
  artifactId: Id
  type: ArtifactType
  uri: string
  mediaType: string // ^image/
  sha256: Hash
  width: number
  height: number
  coordinateSpace: ArtifactCoordinateSpace
  bboxXYWH: BBox | null
  sourceArtifactId: string | null
  origin: ArtifactOrigin
}

// ===== 证据 =====

export interface Evidence {
  evidenceId: Id
  kind: string
  origin: EvidenceOrigin
  description: string
  regionId: string | null
  artifactIds: Id[]
  data: Record<string, unknown>
  limitation: string
}

// ===== 通用结构 =====

export interface Producer {
  name: string
  version: string
}

export interface ReportError {
  code: string
  message: string
}

export interface Score {
  name: string
  value: number
  positiveClass: string
  calibrated: boolean
}

export interface Region {
  regionId: Id
  bboxXYWH: BBox
  coordinateSpace: 'display_image_pixels'
  maskArtifactId: string | null
  // schema: additionalProperties: true
  [key: string]: unknown
}

export interface Check {
  status: CheckStatus
  details: Record<string, unknown>
  // schema: additionalProperties: true
  [key: string]: unknown
}

// ===== 四个模块的 result =====

export interface ProvenancePreprocessing {
  [key: string]: unknown
  originalPreserved: true
  displayTransform: 'exif_auto_orient_no_resize'
}

export interface ProvenanceResult {
  preprocessing: ProvenancePreprocessing
  metadata: Check
  credentials: Check
  watermark: Check
  // schema: additionalProperties: true
  [key: string]: unknown
}

export interface ManipulationResult {
  decision: ManipulationDecision
  score: Score | null
  regions: Region[]
  operationHints: Record<string, unknown>[]
  // schema: additionalProperties: true
  [key: string]: unknown
}

export interface AigcResult {
  decision: AigcDecision
  score: Score | null
  clues: Record<string, unknown>[]
  // schema: additionalProperties: true
  [key: string]: unknown
}

// confidence 的 if/then 约束用判别联合表达，类型层即可保证：
// unavailable -> value=null, calibrated=false
// vlm_self_assessment -> value=number, calibrated=false
// calibrated_fusion -> value=number, calibrated=true
export type Confidence =
  | { source: 'unavailable'; value: null; calibrated: false }
  | { source: 'vlm_self_assessment'; value: number; calibrated: false }
  | { source: 'calibrated_fusion'; value: number; calibrated: true }

export interface ExplanationClaim {
  text: string
  evidenceIds: Id[] // minItems 1, unique
}

export interface ExplanationResult {
  finalDecision: FinalDecision
  confidence: Confidence
  analysis: string // minLength 1
  claims: ExplanationClaim[]
  unresolved: string[]
  // schema: additionalProperties: true
  [key: string]: unknown
}

// ===== 模块报告 =====

export interface ModuleReportBase {
  schemaVersion: '1.0'
  reportId: Id
  imageId: ImageId
  taskId: Id
  mode: ReportMode
  status: ReportStatus
  producer: Producer
  createdAt: string // RFC 3339
  elapsedMs: number
  inputReportIds: Id[]
  evidence: Evidence[]
  artifacts: Artifact[]
  limitations: string[]
  error: ReportError | null
  extensions?: Record<string, unknown>
}

export interface ProvenanceReport extends ModuleReportBase {
  moduleId: 'provenance'
  result: ProvenanceResult | null
}

export interface ManipulationReport extends ModuleReportBase {
  moduleId: 'manipulation'
  result: ManipulationResult | null
}

export interface AigcReport extends ModuleReportBase {
  moduleId: 'aigc'
  result: AigcResult | null
}

export interface ExplanationReport extends ModuleReportBase {
  moduleId: 'explanation'
  result: ExplanationResult | null
}

export type ModuleReport = ProvenanceReport | ManipulationReport | AigcReport | ExplanationReport

// ===== 证据包 =====

export interface EvidenceBundle {
  schemaVersion: '1.0'
  bundleId: Id
  purpose: 'integration_fixture' | 'analysis'
  createdAt: string
  image: ImageInfo
  reports: ModuleReport[]
  artifacts: Artifact[]
}

// ===== 运行时校验 =====

// Reuse the canonical schema so the runtime contract cannot drift from the JSON files.
const ajv = new Ajv({ allErrors: true, strict: false, strictNumbers: true })
addFormats(ajv)
ajv.addSchema(bundleSchema)
const checkBundle = ajv.getSchema<EvidenceBundle>(bundleSchema.$id)!
const checkModuleReport = ajv.compile<ModuleReport>({ $ref: `${bundleSchema.$id}#/$defs/report` })

export function validateEvidenceBundle(value: unknown): string[] {
  return checkBundle(value) ? [] : [ajv.errorsText(checkBundle.errors, { separator: '; ' })]
}

export function assertEvidenceBundle(value: unknown): asserts value is EvidenceBundle {
  const errors = validateEvidenceBundle(value)
  if (errors.length) throw new Error(`Invalid evidence bundle: ${errors.join('; ')}`)
}

/**
 * Validate an explanation against the shared schema, then resolve its citations.
 * Omit upstreamReports for a shape-only check; pass [] to require an empty input set.
 * Successful validation proves structure and citation integrity, not factual correctness.
 */
export function validateExplanationReport(
  report: unknown,
  upstreamReports?: readonly ModuleReport[]
): string[] {
  if (!checkModuleReport(report))
    return [ajv.errorsText(checkModuleReport.errors, { separator: '; ' })]
  if (report.moduleId !== 'explanation') return ['moduleId must be "explanation"']
  const errors: string[] = []
  if (report.inputReportIds.includes(report.reportId))
    errors.push('inputReportIds cannot reference the explanation itself')
  const localEvidence = new Set<string>()
  for (const evidence of report.evidence) {
    if (localEvidence.has(evidence.evidenceId))
      errors.push(`duplicate evidenceId in report: ${evidence.evidenceId}`)
    localEvidence.add(evidence.evidenceId)
  }
  const localArtifacts = new Set<string>()
  for (const artifact of report.artifacts) {
    if (localArtifacts.has(artifact.artifactId))
      errors.push(`duplicate artifactId in report: ${artifact.artifactId}`)
    localArtifacts.add(artifact.artifactId)
  }
  if (upstreamReports === undefined) return errors

  const byId = new Map<string, ModuleReport>()
  for (const upstream of upstreamReports) {
    if (!checkModuleReport(upstream)) {
      errors.push('upstream report does not conform to protocol v1.0')
      continue
    }
    if (byId.has(upstream.reportId))
      errors.push(`ambiguous upstream reportId: ${upstream.reportId}`)
    byId.set(upstream.reportId, upstream)
  }
  const evidenceOwners = new Map<string, string>()
  for (const id of report.inputReportIds) {
    const upstream = byId.get(id)
    if (!upstream) {
      errors.push(`inputReportIds references unknown reportId: ${id}`)
      continue
    }
    if (upstream.imageId !== report.imageId) {
      errors.push(`input report imageId mismatch: ${id}`)
      continue
    }
    for (const evidence of upstream.evidence) {
      if (evidenceOwners.has(evidence.evidenceId))
        errors.push(`ambiguous upstream evidenceId: ${evidence.evidenceId}`)
      evidenceOwners.set(evidence.evidenceId, id)
    }
  }
  for (const [index, claim] of (report.result?.claims ?? []).entries()) {
    for (const id of claim.evidenceIds) {
      if (!evidenceOwners.has(id))
        errors.push(`claims[${index}] references unknown evidenceId: ${id}`)
    }
  }
  return errors
}
