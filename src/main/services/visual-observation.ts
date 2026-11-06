import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { Artifact, Region } from '../../shared/protocol'

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
      let contextResponse: unknown
      if (withScene) {
        try {
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
                    '根据整图确认局部内容属于哪一条记录、哪个字段。记录填写记录的自然名称，字段填写字段的作用。只填简短名称，不抄录提问，无法辨认填null。'
                },
                {
                  role: 'user',
                  content:
                    '局部实际读到的内容：' +
                    (content.visibleText || content.subject) +
                    '。请在这张整图中确认它所属的记录和字段。',
                  images: [args.full.toString('base64')]
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
        finishReason: data.done_reason,
        contextBBoxXYWH: context.bbox,
        presentation: 'unmarked_context_crop',
        inputImageCount: withScene ? 2 : 1,
        requestImageCounts: withScene ? [1, 1] : [1],
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
