type MetadataSegment = Buffer | string | undefined

const MARKERS = [
  { id: 'watermark_keyword', pattern: /\bwatermark(?:ed|ing)?\b/i },
  { id: 'digimarc', pattern: /\bdigimarc\b/i },
  { id: 'adobe_stock', pattern: /\badobe\s*stock\b/i },
  { id: 'shutterstock', pattern: /\bshutterstock\b/i },
  { id: 'getty_images', pattern: /\bgetty\s*images?\b/i },
  { id: 'istock', pattern: /\bistock(?:photo)?\b/i },
  { id: 'alamy', pattern: /\balamy\b/i },
  { id: 'dreamstime', pattern: /\bdreamstime\b/i },
  { id: 'depositphotos', pattern: /\bdepositphotos\b/i }
] as const

/** Scans metadata text for known watermark markers. This does not inspect image pixels. */
export function scanMetadataWatermark(segments: {
  exif?: MetadataSegment
  xmp?: MetadataSegment
  iptc?: MetadataSegment
}) {
  const inspectedSegments: string[] = []
  const candidateMarkers = new Set<string>()

  for (const [name, value] of [
    ['exif', segments.exif],
    ['xmp', segments.xmp],
    ['iptc', segments.iptc]
  ] as const) {
    if (typeof value !== 'string' && !Buffer.isBuffer(value)) continue
    inspectedSegments.push(name)
    const text = typeof value === 'string' ? value : value.toString('latin1')
    for (const marker of MARKERS) {
      if (marker.pattern.test(text)) candidateMarkers.add(marker.id)
    }
  }

  return {
    status: 'completed',
    details: {
      method: 'metadata_text_marker_scan',
      outcome:
        inspectedSegments.length === 0
          ? 'no_metadata_to_scan'
          : candidateMarkers.size > 0
            ? 'candidate_markers_found'
            : 'no_known_markers_found',
      inspectedSegments,
      candidateMarkers: [...candidateMarkers],
      limitations: [
        '命中仅表示元数据中出现已知关键词或品牌标记，不等于确认存在水印。',
        '此元数据子检查只读文本区段，不检查图像像素。'
      ]
    }
  }
}

export function combineWatermarkChecks(
  metadataScan: ReturnType<typeof scanMetadataWatermark>,
  pixelScan: Record<string, any>
) {
  const visible = pixelScan.visible ?? {
    status: pixelScan.status ?? 'failed',
    outcome: 'unavailable',
    reason: pixelScan.reason ?? '可见水印 OCR 未返回结果。'
  }
  const invisible = pixelScan.invisible ?? {
    status: pixelScan.status ?? 'failed',
    outcome: 'unavailable',
    reason: pixelScan.reason ?? '隐形水印解码器未返回结果。'
  }
  const visibleCandidates = Array.isArray(visible.candidates) ? visible.candidates : []
  const metadataFound = metadataScan.details.candidateMarkers.length > 0
  const visibleFound = visibleCandidates.length > 0
  const invisibleFound = invisible.outcome === 'candidate_signature_match'
  const detectors = [visible, invisible]
  const unavailable = detectors.some((detector) => detector.status !== 'completed')

  return {
    status: 'completed',
    details: {
      method: 'metadata_text_ocr_and_sdxl_signature_scan',
      outcome: metadataScan.details.outcome,
      combinedOutcome:
        metadataFound || visibleFound || invisibleFound
          ? 'candidate_watermark_indicators_found'
          : unavailable
            ? 'some_pixel_checks_unavailable'
            : 'no_known_watermark_indicators_found',
      inspectedSegments: metadataScan.details.inspectedSegments,
      candidateMarkers: metadataScan.details.candidateMarkers,
      detectors: {
        metadata: {
          status: 'completed',
          outcome: metadataScan.details.outcome,
          inspectedSegments: metadataScan.details.inspectedSegments,
          candidateMarkers: metadataScan.details.candidateMarkers,
          limitation: '元数据关键词命中不能证明画面上有水印；元数据缺失也不能证明不存在水印。'
        },
        visible,
        invisible
      },
      limitations: [
        ...metadataScan.details.limitations,
        '可见水印使用RapidOCR识别固定图库和通用标记词；只能报告文字线索，不能判断文字是水印、图像内容还是后期叠加。',
        '隐形水印只检测Stable Diffusion XL公开的48位DWT-DCT固定载荷；不支持通用隐形水印或SynthID。'
      ]
    }
  }
}
