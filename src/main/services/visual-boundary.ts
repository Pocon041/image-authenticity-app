import sharp from 'sharp'

export const BOUNDARY_NOTE =
  '青色细线由系统沿检测器预测区域的外缘额外添加，只提示候选位置，不是原图元素，也不是篡改痕迹；区域内部没有填色。'

interface RegionGeometry {
  bboxXYWH: number[]
  areaPixels?: number | null
}
export interface BoundaryLayer {
  mask: Buffer
  regions: readonly RegionGeometry[]
}

/** Match an entire 8-connected component, not unrelated pixels sharing its bbox. */
function componentPixels(mask: Buffer, width: number, height: number, region: RegionGeometry) {
  const [x, y, w, h] = region.bboxXYWH
  if (
    region.bboxXYWH.length !== 4 ||
    ![x, y, w, h].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    w < 1 ||
    h < 1 ||
    x + w > width ||
    y + h > height
  )
    throw new Error('候选轮廓超出图片范围')
  if (region.areaPixels != null && (!Number.isInteger(region.areaPixels) || region.areaPixels < 1))
    throw new Error('候选区域像素数无效')
  const visited = new Uint8Array(w * h),
    queue = new Uint32Array(w * h)
  let matched: Uint8Array | undefined
  for (let start = 0; start < w * h; start++) {
    const sx = start % w,
      sy = Math.floor(start / w)
    if (visited[start] || !mask[(y + sy) * width + x + sx]) continue
    let head = 0,
      tail = 1,
      minX = sx,
      maxX = sx,
      minY = sy,
      maxY = sy,
      escapes = false
    queue[0] = start
    visited[start] = 1
    while (head < tail) {
      const index = queue[head++],
        px = index % w,
        py = Math.floor(index / w)
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = px + dx,
            ny = py + dy,
            gx = x + nx,
            gy = y + ny
          if (gx < 0 || gy < 0 || gx >= width || gy >= height || !mask[gy * width + gx]) continue
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            escapes = true
            continue
          }
          const next = ny * w + nx
          if (!visited[next]) {
            visited[next] = 1
            queue[tail++] = next
          }
        }
    }
    if (
      escapes ||
      minX !== 0 ||
      minY !== 0 ||
      maxX !== w - 1 ||
      maxY !== h - 1 ||
      (region.areaPixels != null && region.areaPixels !== tail)
    )
      continue
    if (matched) throw new Error('预测轮廓与区域对应不唯一')
    matched = new Uint8Array(w * h)
    for (let i = 0; i < tail; i++) matched[queue[i]] = 1
  }
  if (!matched) throw new Error('预测掩码中没有与候选区域匹配的轮廓')
  return matched
}

/** Exterior background only: no inner-hole outlines or painting over the object. */
function exterior(mask: Uint8Array, width: number, height: number) {
  const outside = new Uint8Array(mask.length),
    queue = new Uint32Array(mask.length)
  let head = 0,
    tail = 1
  outside[0] = 1
  queue[0] = 0 // Components have an empty padded border.
  while (head < tail) {
    const i = queue[head++],
      x = i % width,
      y = Math.floor(i / width)
    for (const next of [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1
    ]) {
      if (next >= 0 && !mask[next] && !outside[next]) {
        outside[next] = 1
        queue[tail++] = next
      }
    }
  }
  return outside
}

/** Draw real predicted outer contours on a copy; do not replace them with boxes or expand objects. */
export async function drawRegionBoundaries(full: Buffer, layers: readonly BoundaryLayer[]) {
  const { width, height } = await sharp(full).metadata()
  if (!width || !height) throw new Error('图像尺寸无效')
  if (!layers.some((layer) => layer.regions.length)) return full
  const radius = Math.max(2, Math.min(4, Math.round(Math.min(width, height) / 600)))
  const overlays: { input: Buffer; left: number; top: number }[] = []
  for (const layer of layers) {
    if (!layer.regions.length) continue
    const meta = await sharp(layer.mask).metadata()
    if (meta.width !== width || meta.height !== height) throw new Error('预测掩码与整图尺寸不一致')
    const rawMask = await sharp(layer.mask).removeAlpha().greyscale().raw().toBuffer()
    for (const region of layer.regions) {
      const selected = componentPixels(rawMask, width, height, region)
      const [x, y, w, h] = region.bboxXYWH
      const pw = w + radius * 2,
        ph = h + radius * 2
      const padded = new Uint8Array(pw * ph)
      for (let row = 0; row < h; row++)
        padded.set(selected.subarray(row * w, (row + 1) * w), (row + radius) * pw + radius)
      const outside = exterior(padded, pw, ph),
        rgba = Buffer.alloc(pw * ph * 4)
      const paint = (index: number) => {
        const i = index * 4
        rgba[i] = 0
        rgba[i + 1] = 212
        rgba[i + 2] = 255
        rgba[i + 3] = 255
      }
      for (let row = radius; row < ph - radius; row++)
        for (let col = radius; col < pw - radius; col++) {
          const index = row * pw + col
          if (!padded[index]) continue
          const gx = x + col - radius,
            gy = y + row - radius
          // Only at the canvas edge, close the outline with one frame pixel.
          if (gx === 0 || gy === 0 || gx === width - 1 || gy === height - 1) paint(index)
          if (
            ![
              index - 1,
              index + 1,
              index - pw,
              index + pw,
              index - pw - 1,
              index - pw + 1,
              index + pw - 1,
              index + pw + 1
            ].some((i) => outside[i])
          )
            continue
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
              const next = (row + dy) * pw + col + dx
              if (outside[next]) paint(next)
            }
        }
      const left = Math.max(0, x - radius),
        top = Math.max(0, y - radius)
      const clippedWidth = Math.min(width, x + w + radius) - left
      const clippedHeight = Math.min(height, y + h + radius) - top
      const input = await sharp(rgba, { raw: { width: pw, height: ph, channels: 4 } })
        .extract({
          left: left - (x - radius),
          top: top - (y - radius),
          width: clippedWidth,
          height: clippedHeight
        })
        .png()
        .toBuffer()
      overlays.push({ input, left, top })
    }
  }
  return sharp(full).composite(overlays).png().toBuffer()
}
