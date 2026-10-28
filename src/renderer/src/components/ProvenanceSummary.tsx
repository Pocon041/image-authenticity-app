import type { EvidenceBundle } from '../../../shared/protocol'

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export function ProvenanceSummary({ bundle }: { bundle: Record<string, unknown> }) {
  // The main process validates the formal bundle before crossing the UI DTO boundary.
  const provenance = (bundle as unknown as EvidenceBundle).reports.find(
    (report) => report.moduleId === 'provenance'
  )
  if (!provenance || provenance.moduleId !== 'provenance') return null
  if (!provenance.result)
    return (
      <details className="detector-details" data-testid="provenance-summary">
        <summary>来源与水印检查</summary>
        <p>来源模块未完成：{provenance.error?.message ?? provenance.status}</p>
      </details>
    )
  const { metadata, credentials, watermark } = provenance.result
  const credentialDetails = object(credentials.details),
    watermarkDetails = object(watermark.details)
  const parser = object(metadata.details.parser),
    reader = object(credentialDetails.reader)
  const outcomes: Record<string, string> = {
    no_manifest_container_found: '未发现内嵌凭证',
    manifest_container_found: '发现内嵌凭证标记',
    malformed_container: '容器检查未完整完成',
    unsupported_format: '当前格式不支持扫描',
    candidate_watermark_indicators_found: '发现水印候选线索',
    no_known_watermark_indicators_found: '未匹配当前支持的水印线索',
    some_pixel_checks_unavailable: '部分水印检查未完成'
  }
  return (
    <details className="detector-details" data-testid="provenance-summary">
      <summary>来源与水印检查</summary>
      <ul>
        <li>
          <strong>图像信息</strong>
          <span>{metadata.status === 'completed' ? '已读取基础信息' : '未完成'}</span>
          {parser.status && parser.status !== 'completed' ? <p>详细元数据解析未完成。</p> : null}
        </li>
        <li>
          <strong>C2PA</strong>
          <span>{outcomes[String(credentialDetails.outcome)] ?? '检查未完成'}</span>
          {reader.status === 'completed' ? (
            <p>SDK验证状态：{String(reader.validationState ?? '未提供')}。此状态不等于内容真实。</p>
          ) : null}
        </li>
        <li>
          <strong>水印</strong>
          <span>{outcomes[String(watermarkDetails.combinedOutcome)] ?? '检查未完成'}</span>
        </li>
      </ul>
      <p>
        缺少元数据或凭证、未匹配水印，都不能证明图片真实或伪造。详细子检查结果保存在完整证据包。
      </p>
    </details>
  )
}
