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
  presentation?: 'unmarked_context_crop'
  rawResponse?: unknown
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
              content: withScene
                ? '第一张只提供场景上下文，第二张是未加标记的文档局部。请只简短描述第二张局部中文字或底色的实际外观，不抄录具体数字，不推断编辑手法。'
                : '这张原始局部图里主要是什么？用简短中文通俗称呼回答，不推断编辑手法。',
              images: withScene
                ? [args.full.toString('base64'), context.bytes.toString('base64')]
                : [context.bytes.toString('base64')]
            }
          ],
          stream: false,
          options: { temperature: 0, num_ctx: args.numCtx, num_predict: 60 }
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
      observations.push({
        regionId,
        status: 'completed',
        text: data.message.content,
        finishReason: data.done_reason,
        contextBBoxXYWH: context.bbox,
        presentation: 'unmarked_context_crop',
        inputImageCount: withScene ? 2 : 1,
        rawResponse: data
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
