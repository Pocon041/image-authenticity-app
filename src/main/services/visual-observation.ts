import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { Artifact, Region } from '../../shared/protocol'
import { textNearRegion, textContext, type NearbyText } from './region-text'

export interface RegionObservation {
  regionId: string
  status: 'completed' | 'failed' | 'skipped'
  text?: string
  finishReason?: string
  error?: string
  contextBBoxXYWH?: [number, number, number, number]
  inputImageCount?: number
  requestImageCounts?: number[]
  presentation?: 'unmarked_context_crop'
  rawResponse?: unknown
  contextResponse?: unknown
  context?: string | null
  visibleText?: string | null
  subject?: string | null
  contextRecord?: string | null
  contextField?: string | null
  contextSource?: 'ocr_geometry' | 'ocr_geometry_vlm' | 'vlm_scene'
  nearbyText?: NearbyText[]
}

/** Preserve the model's quoted reading verbatim; no digits or field values are invented here. */
export function quotedReading(text: string): string | null {
  const values = [...text.matchAll(/[“「]([^”」\n]{1,80})[”」]/gu)].map((match) => match[1])
  const readings = values.length
    ? values
    : [...text.matchAll(/(?<!\d)\d{1,2}[:：]\d{2}(?!\d)/gu)].map((match) => match[0])
  return readings.length ? [...new Set(readings)].join('、') : null
}

/** Crop unchanged pixels around a predicted region; no tint or synthetic marks. */
export async function regionContext(full: Buffer, mask: Buffer, region: Region) {
  const info = await sharp(full).metadata()
  const maskInfo = await sharp(mask).metadata()
  if (
    maskInfo.width !== info.width ||
    maskInfo.height !== info.height ||
    !info.width ||
    !info.height
  )
    throw new Error('预测掩码与整图尺寸不一致')
  const [x, y, w, h] = region.bboxXYWH
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > info.width || y + h > info.height)
    throw new Error('区域超出图片范围')
  const padding = Math.max(16, Math.round(Math.max(w, h) * 0.2))
  const left = Math.max(0, x - padding),
    top = Math.max(0, y - padding)
  const width = Math.min(info.width, x + w + padding) - left,
    height = Math.min(info.height, y + h + padding) - top
  const bytes = await sharp(full).extract({ left, top, width, height }).png().toBuffer()
  return { bytes, bbox: [left, top, width, height] as [number, number, number, number] }
}

export async function observeRegions(args: {
  directory: string
  full: Buffer
  regions: Region[]
  artifacts: Artifact[]
  model: string
  host: string
  numCtx: number
  maxImages?: number
  ocrTexts?: unknown
  signal?: AbortSignal
}): Promise<RegionObservation[]> {
  const observations: RegionObservation[] = []
  for (const [index, region] of args.regions.entries()) {
    const regionId = String.fromCharCode(65 + index)
    try {
      args.signal?.throwIfAborted()
      if (region.bboxXYWH[2] < 8 || region.bboxXYWH[3] < 8) {
        observations.push({
          regionId,
          status: 'skipped',
          error: '候选自身像素不足以可靠辨认内容',
          presentation: 'unmarked_context_crop'
        })
        continue
      }
      const mask = args.artifacts.find((a) => a.artifactId === region.maskArtifactId)
      if (!mask) throw new Error('区域缺少预测掩码')
      const maskBytes = await readFile(join(args.directory, mask.uri))
      const context = await regionContext(args.full, maskBytes, region)
      // Record/field correspondence is meaningful for document localization only.
      // Photo localization uses the unmarked crop; the original full image is used later for assessment.
      const withScene = region.detector === 'rise' && (args.maxImages ?? 2) >= 2
      const response = await fetch(`${args.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: args.model,
          messages: [
            {
              role: 'user',
              content: '这张局部图片主要是什么？用简短的通俗称呼回答；有文字时读出能看清的原文。',
              images: [context.bytes.toString('base64')]
            }
          ],
          stream: false,

          options: { temperature: 0, num_ctx: args.numCtx, num_predict: 140 }
        }),
        signal: args.signal
          ? AbortSignal.any([args.signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000)
      })
      if (!response.ok) throw new Error(`区域观察HTTP ${response.status}`)
      const data = await response.json()
      if (
        data.done_reason === 'length' ||
        typeof data.message?.content !== 'string' ||
        !data.message.content.trim()
      )
        throw new Error('区域观察返回为空')
      const content = {
        context: null as string | null,
        subject: data.message.content as string,
        visibleText: quotedReading(data.message.content),
        record: null as string | null,
        field: null as string | null
      }
      const metadata = await sharp(args.full).metadata()
      const nearbyText =
        region.detector === 'rise'
          ? textNearRegion(args.ocrTexts, region, metadata.width!, metadata.height!)
          : []
      if (nearbyText.length) content.context = textContext(nearbyText, content.visibleText)
      let contextResponse: unknown
      if (withScene && !nearbyText.length) {
        try {
          const response = await fetch(`${args.host}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: args.model,
              stream: false,
              format: {
                type: 'object',
                properties: { 字段: { type: ['string', 'null'], maxLength: 30 } },
                required: ['字段']
              },
              messages: [
                {
                  role: 'system',
                  content:
                    '图1是整图，图2是对应的原始局部。根据两张图确认局部属于哪条记录和哪个字段。记录填写自然名称，例如第二条短信、第二笔交易、退货凭证中的商品条目；绝对不要填1、2等数字编号。字段填写具体作用，例如存款时间、订单号、原价。无法确定就填null，不抄录问题。'
                },
                {
                  role: 'user',
                  content:
                    '局部实际读到的内容：' +
                    (content.visibleText || content.subject) +
                    '。请在这张整图中确认它所属的记录和字段。',
                  images: [args.full.toString('base64'), context.bytes.toString('base64')]
                }
              ],
              options: { temperature: 0, num_ctx: args.numCtx, num_predict: 240 }
            }),
            signal: args.signal
              ? AbortSignal.any([args.signal, AbortSignal.timeout(60000)])
              : AbortSignal.timeout(60000)
          })
          if (!response.ok) throw new Error(`上下文HTTP ${response.status}`)
          const result = await response.json()
          contextResponse = result
          const parsed = JSON.parse(result.message?.content ?? '')
          if (
            result.done_reason === 'length' ||
            !['记录', '字段'].every(
              (key) => parsed[key] === null || typeof parsed[key] === 'string'
            )
          )
            throw new Error('记录字段对应结构无效')
          content.record = parsed.记录
          content.field = parsed.字段
          // This field is a record name, not a numeric index. Keep incomplete values in the raw record.
          const namedRecord =
            typeof parsed.记录 === 'string' && !/^\s*\d+\s*$/.test(parsed.记录) ? parsed.记录 : null
          content.context = [namedRecord, parsed.字段].filter(Boolean).join('中的') || null
        } catch (error) {
          contextResponse = { error: String(error) }
        }
      }
      if (withScene && nearbyText.length) {
        try {
          const relation = nearbyText[0]
          const response = await fetch(`${args.host}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: args.model,
              stream: false,
              format: {
                type: 'object',
                properties: {
                  记录: { type: ['string', 'null'], maxLength: 40 },
                  字段: { type: ['string', 'null'], maxLength: 30 }
                },
                required: ['记录', '字段']
              },
              messages: [
                {
                  role: 'system',
                  content:
                    '图1是完整图片，图2是目标位置的原始局部。来源OCR文字和它与目标的空间关系是实测信息，不是字段名称。请根据两图判断目标所属记录和字段作用。记录用自然名称，例如第二条短信、退货凭证；字段用作用名称，例如存款时间、订单号、原价。不要把OCR读到的数字或文字直接当作字段名；看不清填null。'
                },
                {
                  role: 'user',
                  content: `目标附近实测文字为“${relation.text}”，目标位于该文字的${relation.relation === 'left_neighbor' ? '右侧' : relation.relation === 'right_neighbor' ? '左侧' : '同一文字区域'}。${content.visibleText ? `目标局部读到“${content.visibleText}”。` : ''}请只输出目标字段作用，不要输出记录名称。`,
                  images: [args.full.toString('base64'), context.bytes.toString('base64')]
                }
              ],
              options: { temperature: 0, num_ctx: args.numCtx, num_predict: 180 }
            }),
            signal: args.signal
              ? AbortSignal.any([args.signal, AbortSignal.timeout(60000)])
              : AbortSignal.timeout(60000)
          })
          if (!response.ok) throw new Error(`OCR字段上下文HTTP ${response.status}`)
          const result = await response.json()
          contextResponse = result
          const parsed = JSON.parse(result.message?.content ?? '')
          if (
            result.done_reason === 'length' ||
            !(parsed.字段 === null || typeof parsed.字段 === 'string')
          )
            throw new Error('OCR字段上下文结构无效')
          const valid = (value: unknown) =>
            typeof value === 'string' && value.trim() && !value.includes(relation.text)
          if (valid(parsed.字段)) content.field = parsed.字段
          if (content.record || content.field)
            content.context =
              [content.record, content.field].filter(Boolean).join('中的') || content.context
        } catch (error) {
          contextResponse = { error: String(error), source: 'ocr_geometry' }
        }
      }
      observations.push({
        regionId,
        status: 'completed',
        text: [
          content.context,
          content.subject,
          content.visibleText ? `可见原文：${content.visibleText}` : null
        ]
          .filter(Boolean)
          .join('；'),
        context: content.context,
        subject: content.subject,
        visibleText: content.visibleText,
        contextRecord: content.record,
        contextField: content.field,
        contextSource:
          content.record || content.field
            ? 'ocr_geometry_vlm'
            : nearbyText.length
              ? 'ocr_geometry'
              : withScene
                ? 'vlm_scene'
                : undefined,
        nearbyText: nearbyText.length ? nearbyText : undefined,
        finishReason: data.done_reason,
        contextBBoxXYWH: context.bbox,
        presentation: 'unmarked_context_crop',
        inputImageCount: withScene ? 2 : 1,
        requestImageCounts: withScene ? [1, 2] : [1],
        rawResponse: data,
        contextResponse
      })
    } catch (error) {
      observations.push({
        regionId,
        status: 'failed',
        error: error instanceof Error ? error.message : '区域观察失败'
      })
    }
  }
  return observations
}
