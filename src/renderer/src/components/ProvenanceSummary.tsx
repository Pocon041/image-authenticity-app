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
  const watermarkDetectors = object(watermarkDetails.detectors)
  const visibleDetector = object(watermarkDetectors.visible)
  const visibleCandidates = Array.isArray(visibleDetector.candidates)
    ? visibleDetector.candidates.map(object)
    : []
  const knownTextLabels: Record<string, string> = {
    doubao_brand_text_candidate: '豆包',
    seedream_model_text_candidate: 'Seedream',
    openai_image_brand_text_candidate: 'OpenAI / ChatGPT',
    openai_image_model_text_candidate: 'DALL·E',
    midjourney_brand_text_candidate: 'Midjourney',
    stability_ai_brand_text_candidate: 'Stability AI',
    stable_diffusion_model_text_candidate: 'Stable Diffusion / SDXL',
    adobe_firefly_brand_text_candidate: 'Adobe Firefly',
    google_imagen_model_text_candidate: 'Google Imagen',
    google_gemini_brand_text_candidate: 'Gemini',
    microsoft_designer_brand_text_candidate: 'Microsoft Designer',
    microsoft_copilot_brand_text_candidate: 'Copilot',
    bing_image_creator_brand_text_candidate: 'Bing Image Creator',
    meta_ai_brand_text_candidate: 'Meta AI',
    canva_ai_brand_text_candidate: 'Canva AI',
    leonardo_ai_brand_text_candidate: 'Leonardo AI',
    ideogram_brand_text_candidate: 'Ideogram',
    runway_brand_text_candidate: 'Runway',
    kling_brand_text_candidate: '可灵 / Kling',
    jimeng_brand_text_candidate: '即梦 / Jimeng',
    tongyi_wanxiang_brand_text_candidate: '通义万相',
    ernie_yige_brand_text_candidate: '文心一格',
    hunyuan_brand_text_candidate: '腾讯混元',
    minimax_hailuo_brand_text_candidate: '海螺 AI / MiniMax',
    zhipu_qingying_brand_text_candidate: '智谱清影',
    generic_ai_generated_text: 'AI生成',
    generic_visual_watermark_candidate: '疑似视觉水印特征'
  }
  const getKnownTextLabels = (values: unknown[]) =>
    [...new Set(values.flatMap((value) => (Array.isArray(value) ? value : [])))]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => knownTextLabels[value])
      .filter((value): value is string => Boolean(value))
  const visibleTextLabels = getKnownTextLabels(
    visibleCandidates.map((candidate) => candidate.markers)
  )
  const metadataTextLabels = getKnownTextLabels([
    watermarkDetails.candidateMarkers as unknown[]
  ])
  const visibleCandidateTexts = [...new Set(visibleCandidates
    .map((candidate) => candidate.recognizedText)
    .filter((value): value is string => typeof value === 'string' && value.length > 0))].slice(0, 8)
  const parser = object(metadata.details.parser),
    reader = object(credentialDetails.reader)
  const rawClaimGeneratorInfo = reader.claimGeneratorInfo
  const claimGeneratorNames = [...new Set(
    (Array.isArray(rawClaimGeneratorInfo)
      ? rawClaimGeneratorInfo
      : rawClaimGeneratorInfo
        ? [rawClaimGeneratorInfo]
        : [])
      .map((entry) => object(entry).name)
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
  )]
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
            <>
              <p>SDK验证状态：{String(reader.validationState ?? '未提供')}。此状态不等于内容真实。</p>
              {claimGeneratorNames.map((name) => (
                <p key={name}>claim_generator_info.name：{name}</p>
              ))}
              {claimGeneratorNames.length === 0 && typeof reader.claimGenerator === 'string' ? (
                <p>claim_generator：{reader.claimGenerator}</p>
              ) : null}
            </>
          ) : null}
        </li>
        <li>
          <strong>水印</strong>
          <span>{outcomes[String(watermarkDetails.combinedOutcome)] ?? '检查未完成'}</span>
          {visibleTextLabels.length > 0 ? (
            <p>可见文字候选：{visibleTextLabels.join('、')}。文字匹配不能验证生成平台。</p>
          ) : null}
          {visibleCandidateTexts.length > 0 ? (
            <p>疑似水印识别文本：{visibleCandidateTexts.join('；')}</p>
          ) : null}
          {metadataTextLabels.length > 0 ? (
            <p>元数据文字候选：{metadataTextLabels.join('、')}。元数据可能被修改或复制。</p>
          ) : null}
          {visibleTextLabels.includes('Seedream') || metadataTextLabels.includes('Seedream') ? (
            <p>Seedream字样无法区分豆包、即梦或其他服务入口。</p>
          ) : null}
        </li>
      </ul>
      <p>
        缺少元数据或凭证、未匹配水印，都不能证明图片真实或伪造。详细子检查结果保存在完整证据包。
      </p>
    </details>
  )
}
