// src/shared/protocol.ts
// 协议 v1.0 类型定义，严格对应 schemas/bundle.schema.json。
// 与 src/shared/contracts.ts 中的现有 UI 类型（AnalysisReport 等）互相独立，
// 两者之间通过 adapter 连接，不在这里混用。
//
// 约定：
// - result 采用「每个模块一个 interface，result 为 ResultType | null」的方案；
//   status 与 result/error 的联动约束由 validate* 运行时校验函数保证。
// - schema 中 open object（operationHints、clues、details、data、extensions）统一用 Record<string, unknown>。
// - 字符串 pattern（hash、imageId）在类型层无法表达，交由运行时校验。

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
  | 'encoded_file_pixels'
  | 'display_image_pixels'
  | 'region_local_pixels'
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

export type ModuleReport =
  | ProvenanceReport
  | ManipulationReport
  | AigcReport
  | ExplanationReport

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

const FINAL_DECISIONS: readonly FinalDecision[] = [
  'suspicious',
  'no_anomaly_detected',
  'inconclusive'
]

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isHash(v: unknown): v is Hash {
  return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
}

function isImageId(v: unknown): v is ImageId {
  return typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v)
}

function isBBox(v: unknown): v is BBox {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && Number.isInteger(n)) &&
    v[0] >= 0 &&
    v[1] >= 0 &&
    v[2] >= 1 &&
    v[3] >= 1
  )
}

/**
 * 校验 ExplanationReport 单报告一致性。
 * - 不传 upstreamReports 时跳过 evidenceIds 引用解析。
 * - 传入 upstreamReports 时，claims.evidenceIds 必须能在 inputReportIds 对应的上游报告 evidence 中解析到。
 */
export function validateExplanationReport(
  report: ExplanationReport,
  upstreamReports: ModuleReport[] = []
): string[] {
  const errors: string[] = []

  if (report.moduleId !== 'explanation') {
    errors.push(`moduleId must be "explanation", got "${report.moduleId}"`)
    return errors
  }
  if (report.schemaVersion !== '1.0') {
    errors.push('schemaVersion must be "1.0"')
  }
  if (!isNonEmptyString(report.reportId)) {
    errors.push('reportId must be a non-empty string')
  }
  if (!isImageId(report.imageId)) {
    errors.push('imageId must match ^sha256:[a-f0-9]{64}$')
  }
  if (!isNonEmptyString(report.taskId)) {
    errors.push('taskId must be a non-empty string')
  }
  if (report.mode !== 'mock' && report.mode !== 'local') {
    errors.push('mode must be "mock" or "local"')
  }
  if (new Set(report.inputReportIds).size !== report.inputReportIds.length) {
    errors.push('inputReportIds must be unique')
  }

  // status 与 result / error 的联动
  if (report.status === 'completed') {
    if (report.result === null) {
      errors.push('status="completed" requires result to be an object')
    }
    if (report.error !== null) {
      errors.push('status="completed" requires error to be null')
    }
  } else {
    if (report.result !== null) {
      errors.push(`status="${report.status}" requires result to be null`)
    }
    if (report.status === 'failed' && report.error === null) {
      errors.push('status="failed" requires error')
    }
  }

  // 证据与附件基础字段
  const evidenceIds = new Set<string>()
  for (const ev of report.evidence) {
    if (!isNonEmptyString(ev.evidenceId)) {
      errors.push('evidence.evidenceId must be a non-empty string')
      continue
    }
    if (evidenceIds.has(ev.evidenceId)) {
      errors.push(`duplicate evidenceId in report: ${ev.evidenceId}`)
    }
    evidenceIds.add(ev.evidenceId)
  }
  for (const art of report.artifacts) {
    if (!isNonEmptyString(art.artifactId)) {
      errors.push('artifact.artifactId must be a non-empty string')
    }
    if (!isHash(art.sha256)) {
      errors.push(`artifact ${art.artifactId}: sha256 invalid`)
    }
    if (art.bboxXYWH !== null && !isBBox(art.bboxXYWH)) {
      errors.push(`artifact ${art.artifactId}: bboxXYWH invalid`)
    }
  }

  if (report.result === null) {
    return errors
  }

  const r = report.result

  if (!FINAL_DECISIONS.includes(r.finalDecision)) {
    errors.push(`invalid finalDecision: ${String(r.finalDecision)}`)
  }
  if (!isNonEmptyString(r.analysis)) {
    errors.push('analysis must be a non-empty string')
  }
  if (r.confidence.value !== null) {
    if (typeof r.confidence.value !== 'number') {
      errors.push('confidence.value must be number or null')
    } else if (r.confidence.value < 0 || r.confidence.value > 1) {
      errors.push('confidence.value must be in [0, 1]')
    }
  }
  if (!Array.isArray(r.unresolved) || r.unresolved.some((s) => typeof s !== 'string')) {
    errors.push('unresolved must be string[]')
  }

  // claims 内部约束
  r.claims.forEach((claim, i) => {
    if (typeof claim.text !== 'string') {
      errors.push(`claims[${i}].text must be a string`)
    }
    if (!Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0) {
      errors.push(`claims[${i}].evidenceIds must not be empty`)
      return
    }
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length) {
      errors.push(`claims[${i}].evidenceIds must be unique`)
    }
  })

  // 可选：跨报告引用解析
  if (upstreamReports.length > 0) {
    const inputIds = new Set(report.inputReportIds)
    const referenced: ModuleReport[] = upstreamReports.filter((u) =>
      inputIds.has(u.reportId)
    )
    const missingInputs = report.inputReportIds.filter(
      (id) => !upstreamReports.some((u) => u.reportId === id)
    )
    for (const id of missingInputs) {
      errors.push(`inputReportIds references unknown reportId: ${id}`)
    }
    const upstreamEvidence = new Set<string>()
    for (const up of referenced) {
      for (const ev of up.evidence) upstreamEvidence.add(ev.evidenceId)
    }
    r.claims.forEach((claim, i) => {
      for (const eid of claim.evidenceIds) {
        if (!upstreamEvidence.has(eid)) {
          errors.push(`claims[${i}] references unknown evidenceId: ${eid}`)
        }
      }
    })
  }

  return errors
}