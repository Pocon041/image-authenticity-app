import type { ProvenanceReport } from '../../shared/protocol'

type Obj = Record<string, any>
const obj = (value: unknown): Obj =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {}
const list = (value: unknown): any[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string | null => {
  const item = Array.isArray(value) ? value[0] : value
  return typeof item === 'string' && item.trim() ? item.trim().slice(0, 240) : null
}
function compact(value: Obj): Obj {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) =>
        item !== null &&
        item !== undefined &&
        item !== '' &&
        (!Array.isArray(item) || item.length > 0) &&
        (typeof item !== 'object' || Object.keys(item).length > 0)
    )
  )
}

/** Only source findings useful for judgement; complete diagnostics stay in the original report. */
export function provenanceForVlm(report: ProvenanceReport | undefined): Obj {
  if (!report) return {}
  const result = obj(report.result)
  const details = obj(obj(result.metadata).details)
  const exif = obj(details.exif)
  const fields = obj(obj(details.xmp).fields)
  const extracted = obj(obj(details.xmp).extracted)
  const credentialDetails = obj(obj(result.credentials).details)
  const reader = obj(credentialDetails.reader)
  const watermark = obj(obj(result.watermark).details)
  const detectors = obj(watermark.detectors)
  const visible = obj(detectors.visible)
  const invisible = obj(detectors.invisible)
  const unavailableChecks = [
    ['provenance', report],
    ['metadata', details.parser],
    ['credentials', reader],
    ['visible_watermark', visible],
    ['invisible_watermark', invisible]
  ]
    .filter(([, check]) => ['failed', 'not_run'].includes(obj(check).status))
    .map(([name]) => name)
  const state =
    text(reader.validationState) ?? text(credentialDetails.signatureValidation) ?? 'not_run'
  const actions = list(reader.actions)
    .slice(0, 8)
    .map((item) => {
      const action = obj(item)
      const software = obj(action.softwareAgent)
      return compact({
        action: text(action.action),
        digitalSourceType: text(action.digitalSourceType)?.split('/').pop(),
        softwareAgent: text(action.softwareAgent) ?? text(software.name),
        version: text(software.version)
      })
    })
    .filter((item) => Object.keys(item).length > 0)
  return compact({
    metadata: compact({
      creatorTool:
        text(fields['xmp:CreatorTool']) ??
        text(extracted['xmp:CreatorTool']) ??
        text(exif.Software),
      camera: [text(exif.Make), text(exif.Model)].filter(Boolean).join(' '),
      createdAt: text(exif.DateTimeOriginal) ?? text(fields['xmp:CreateDate']),
      modifiedAt: text(exif.DateTime) ?? text(fields['xmp:ModifyDate'])
    }),
    credentials:
      report.status === 'completed' &&
      obj(result.credentials).status === 'completed' &&
      reader.status === 'completed' &&
      credentialDetails.outcome === 'manifest_container_found'
        ? compact({
            claimGenerator:
              list(reader.claimGeneratorInfo)
                .map((item) => text(obj(item).name))
                .find(Boolean) ?? text(reader.claimGenerator),
            aiDeclaration:
              reader.aiDeclaration === 'declared_ai_generated_or_composited'
                ? reader.aiDeclaration
                : null,
            actions,
            validation: compact({
              claimSignature: text(obj(reader.validationChecks).claimSignature),
              contentBinding: text(obj(reader.validationChecks).contentBinding),
              signerTrust: text(obj(reader.validationChecks).signerTrust)
            }),
            verification: credentialValidationText(state, reader)
          })
        : null,
    watermark: compact({
      metadataMarkers: list(watermark.candidateMarkers).slice(0, 12),
      visibleCandidates: list(visible.candidates)
        .slice(0, 6)
        .map((item) =>
          compact({
            text: text(obj(item).recognizedText),
            bboxXYWH: obj(item).bboxXYWH
          })
        ),
      invisibleMatch:
        invisible.outcome === 'candidate_signature_match' ? text(invisible.algorithm) : null
    }),
    unavailableChecks
  })
}

function credentialValidationText(state: string, reader: Obj): string {
  if (state === 'Trusted') return '本地凭证验证通过'
  if (state === 'Valid') return '凭证有效，签名者信任未确认'
  if (state === 'Invalid') {
    const checks = obj(reader.validationChecks)
    if (checks.claimSignature === 'passed' && checks.contentBinding === 'passed')
      return '签名和文件绑定通过；本地证书检查未全部通过'
    if (checks.contentBinding === 'failed') return '文件内容绑定未通过'
    if (checks.claimSignature === 'failed') return '声明签名验证未通过'
    return '本地凭证验证未通过'
  }
  return reader.status === 'failed' ? '凭证读取失败' : '未完成凭证验证'
}

/** Carry the key findings into the writing stage without repeating general caveats. */
export function provenanceNarrationFacts(value: unknown): string[] {
  const source = obj(value)
  const lines: string[] = []
  const metadata = obj(source.metadata)
  if (metadata.creatorTool) lines.push(`文件记录的编辑工具：${metadata.creatorTool}。`)
  const credentials = obj(source.credentials)
  if (Object.keys(credentials).length) {
    const software = list(credentials.actions)
      .map((action) => [obj(action).softwareAgent, obj(action).version].filter(Boolean).join('/'))
      .filter(Boolean)
    const claimed = [credentials.claimGenerator, ...new Set(software)].filter(Boolean).join('、')
    if (claimed) lines.push(`来源凭证记录的生成/处理工具：${claimed}。`)
    if (credentials.aiDeclaration === 'declared_ai_generated_or_composited')
      lines.push('来源凭证声明使用了AI生成或AI合成。')
    if (credentials.verification) lines.push(`凭证检查：${credentials.verification}。`)
  }
  const watermark = obj(source.watermark)
  const readings = list(watermark.visibleCandidates)
    .map((item) => text(obj(item).text))
    .filter(Boolean)
  if (readings.length) lines.push(`可见水印候选文字：${readings.join('、')}。`)
  if (list(watermark.metadataMarkers).length)
    lines.push(`元数据水印标记：${watermark.metadataMarkers.join('、')}。`)
  if (watermark.invisibleMatch) lines.push(`隐形水印匹配：${watermark.invisibleMatch}。`)
  if (list(source.unavailableChecks).length)
    lines.push(`本次未完成的来源检查：${source.unavailableChecks.join('、')}。`)
  return lines
}
