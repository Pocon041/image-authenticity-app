import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { Artifact, Region } from '../../shared/protocol'

export interface RegionObservation {
  regionId: string
  status: 'completed' | 'failed'
  text?: string
  finishReason?: string
  error?: string
  contextBBoxXYWH?: [number, number, number, number]
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
  signal?: AbortSignal
}): Promise<RegionObservation[]> {
  const observations: RegionObservation[] = []
  for (const [index, region] of args.regions.entries()) {
    const regionId = String.fromCharCode(65 + index)
    try {
      args.signal?.throwIfAborted()
      const mask = args.artifacts.find((a) => a.artifactId === region.maskArtifactId)
      if (!mask) throw new Error('区域缺少预测掩码')
      const context = await regionContext(
        args.full,
        await readFile(join(args.directory, mask.uri)),
        region
      )
      const input = {
        question: '这张局部图片中主要是什么对象或文字？用一句中文描述实际看到的内容。'
      }
      const response = await fetch(`${args.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: args.model,
          messages: [
            {
              role: 'user',
              content: JSON.stringify(input),
              images: [context.bytes.toString('base64')]
            }
          ],
          stream: false,
          options: { temperature: 0, num_ctx: args.numCtx, num_predict: 180 }
        }),
        signal: args.signal
          ? AbortSignal.any([args.signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000)
      })
      if (!response.ok) throw new Error(`区域观察HTTP ${response.status}`)
      const data = await response.json()
      if (typeof data.message?.content !== 'string' || !data.message.content.trim())
        throw new Error('区域观察返回为空')
      observations.push({
        regionId,
        status: 'completed',
        text: data.message.content,
        finishReason: data.done_reason,
        contextBBoxXYWH: context.bbox
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
