import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import sharp from 'sharp'
import type { ImageAsset } from '../shared/contracts'

const MAX_BYTES = 20 * 1024 * 1024
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

// Original source stays in the main process; the renderer receives a preview DTO only.
export interface ImportedImage {
  asset: ImageAsset
  sourcePath: string
  originalBytes: Buffer
}

export async function importImage(filePath: string): Promise<ImportedImage> {
  let mimeType = mimeTypes[extname(filePath).toLowerCase()]
  if (!mimeType) throw new Error('不支持此文件格式，请选择 PNG、JPG 或 WebP 图片。')
  const file = await open(filePath, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('请选择普通图片文件。')
    if (stat.size > MAX_BYTES) throw new Error('图片超过 20 MB，请选择较小的文件。')
    if (stat.size === 0) throw new Error('图片文件为空，请重新选择。')
    // A bounded read also handles a file that grows after stat().
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1))
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_BYTES || length > stat.size)
      throw new Error('图片文件在读取时发生变化，请重新选择。')
    const bytes = buffer.subarray(0, length)
    let width: number, height: number, preview: Buffer
    try {
      const input = sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'warning' })
      const metadata = await input.metadata()
      if (
        !metadata.width ||
        !metadata.height ||
        !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')
      ) {
        throw new Error('Unsupported image')
      }
      mimeType = `image/${metadata.format}`
      const rotated = metadata.orientation !== undefined && metadata.orientation >= 5
      width = rotated ? metadata.height : metadata.width
      height = rotated ? metadata.width : metadata.height
      // Decode the actual pixels and limit preview transfer size; the original stays untouched.
      preview = await input
        .rotate()
        .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
    } catch (error) {
      if (error instanceof Error && /pixel limit/i.test(error.message)) {
        throw new Error('图片分辨率过大，请选择不超过 6000 万像素的图片。')
      }
      throw new Error('无法解码这张图片，文件可能已损坏或格式不受支持。')
    }
    return {
      sourcePath: filePath,
      originalBytes: bytes,
      asset: {
        id: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        name: basename(filePath),
        size: length,
        width,
        height,
        mimeType,
        dataUrl: `data:image/png;base64,${preview.toString('base64')}`
      }
    }
  } finally {
    await file.close()
  }
}
