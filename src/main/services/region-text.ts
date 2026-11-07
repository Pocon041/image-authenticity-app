import type { Region } from '../../shared/protocol'

export interface NearbyText {
  text: string
  bboxXYWH: [number, number, number, number]
  relation: 'overlapping' | 'left_neighbor' | 'right_neighbor'
  confidence?: number
}

/** Coordinate association only: no business-field classification or tamper decision. */
export function textNearRegion(
  readings: unknown,
  region: Pick<Region, 'bboxXYWH'>,
  width: number,
  height: number
): NearbyText[] {
  if (!Array.isArray(readings)) return []
  const [x, y, w, h] = region.bboxXYWH
  const candidates: (NearbyText & { full: boolean; gap: number })[] = []
  for (const item of readings) {
    if (!item || typeof item.recognizedText !== 'string' || !item.recognizedText.trim()) continue
    const box = item.bboxXYWH
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) continue
    const [tx, ty, tw, th] = box
    if (tx < 0 || ty < 0 || tw <= 0 || th <= 0 || tx + tw > width || ty + th > height) continue
    const vertical = Math.max(0, Math.min(y + h, ty + th) - Math.max(y, ty))
    if (vertical / Math.min(h, th) < 0.6) continue
    const horizontal = Math.max(0, Math.min(x + w, tx + tw) - Math.max(x, tx))
    const gap = Math.max(0, x - tx - tw, tx - x - w)
    if (gap > Math.max(h * 2, width * 0.1)) continue
    const relation =
      horizontal / Math.min(w, tw) >= 0.25
        ? 'overlapping'
        : tx + tw / 2 < x + w / 2
          ? 'left_neighbor'
          : 'right_neighbor'
    candidates.push({
      text: item.recognizedText.trim(),
      bboxXYWH: box as NearbyText['bboxXYWH'],
      relation,
      ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}),
      full: item.region === 'full_image',
      gap
    })
  }
  candidates.sort(
    (a, b) =>
      Number(b.relation === 'overlapping') - Number(a.relation === 'overlapping') ||
      a.gap - b.gap ||
      Number(b.full) - Number(a.full) ||
      b.bboxXYWH[2] - a.bboxXYWH[2]
  )
  const selected: NearbyText[] = []
  for (const { full: _full, gap: _gap, ...candidate } of candidates) {
    if (
      selected.some(
        (item) =>
          item.text === candidate.text ||
          ((item.text.includes(candidate.text) || candidate.text.includes(item.text)) &&
            Math.abs(item.bboxXYWH[1] - candidate.bboxXYWH[1]) <
              Math.min(item.bboxXYWH[3], candidate.bboxXYWH[3]))
      )
    )
      continue
    selected.push(candidate)
    if (selected.length === 3) break
  }
  return selected
}

/** Quote measured neighboring text rather than inventing a record or field name. */
export function textContext(readings: NearbyText[], visibleText?: string | null): string | null {
  const first = readings[0]
  if (!first) return null
  if (first.relation === 'overlapping') {
    return visibleText && first.text.includes(visibleText)
      ? `“${first.text}”中的“${visibleText}”`
      : `“${first.text}”所在行`
  }
  return `“${first.text}”${first.relation === 'left_neighbor' ? '右侧' : '左侧'}的区域`
}
