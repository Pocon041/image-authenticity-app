import type { Metadata } from 'sharp'

type Json = Record<string, any>

const XMP_FIELDS = [
  'tiff:Make',
  'tiff:Model',
  'xmp:CreateDate',
  'xmp:ModifyDate',
  'xmp:MetadataDate',
  'xmp:CreatorTool',
  'exif:DateTimeOriginal',
  'photoshop:DateCreated',
  'photoshop:Credit',
  'dc:rights',
  'dc:description',
  'dc:title',
  'Iptc4xmpCore:Location'
]

function xmlDecode(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function parseXmp(data?: Buffer): Json {
  if (!data?.length) return { status: 'not_present', fields: {} }
  const text = data.toString('utf8').slice(0, 1_000_000)
  const fields: Record<string, string[]> = {}
  for (const name of XMP_FIELDS) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const attribute = new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)`, 'i').exec(text)
    const localName = name.split(':').at(-1)!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const element = new RegExp(
      `<(?:[\\w.-]+:)?${localName}\\b[^>]*>(.*?)</(?:[\\w.-]+:)?${localName}\\s*>`,
      'is'
    ).exec(text)
    const value = attribute?.[1] ?? element?.[1]?.replace(/<[^>]*>/g, ' ')
    if (value?.trim()) fields[name] = [xmlDecode(value.replace(/\s+/g, ' ').trim()).slice(0, 2048)]
  }
  return { status: 'parsed', fields }
}

export function parseIptc(data?: Buffer): Json {
  if (!data?.length) return { status: 'not_present', fields: {} }
  const tags: Record<string, string> = {
    '2:25': 'keywords',
    '2:55': 'dateCreated',
    '2:60': 'timeCreated',
    '2:80': 'byline',
    '2:85': 'bylineTitle',
    '2:90': 'city',
    '2:95': 'provinceOrState',
    '2:100': 'countryCode',
    '2:101': 'countryName',
    '2:105': 'headline',
    '2:110': 'credit',
    '2:115': 'source',
    '2:116': 'copyrightNotice',
    '2:120': 'captionOrAbstract'
  }
  const utf8 = data.includes(Buffer.from([0x1b, 0x25, 0x47]))
  const fields: Record<string, string[]> = {}
  let offset = 0,
    records = 0
  while (offset + 5 <= data.length && records < 512) {
    if (data[offset] !== 0x1c) {
      offset++
      continue
    }
    const record = data[offset + 1],
      dataset = data[offset + 2],
      length = data.readUInt16BE(offset + 3),
      end = offset + 5 + length
    if (length === 0x8000 || end > data.length) break
    records++
    const name = tags[`${record}:${dataset}`]
    if (name) {
      const value = data
        .subarray(offset + 5, end)
        .toString(utf8 ? 'utf8' : 'latin1')
        .replace(/\0/g, '')
        .trim()
      if (value) (fields[name] ??= []).push(value.slice(0, 1024))
    }
    offset = end
  }
  return { status: 'parsed', fields, recordCount: records }
}

export function provenanceMetadataSummary(
  metadata: Metadata,
  extracted: Json | null,
  parserStatus: Json
): Json {
  return {
    format: metadata.format ?? null,
    encodedDimensions: [metadata.width ?? null, metadata.height ?? null],
    orientation: metadata.orientation ?? 1,
    channels: metadata.channels ?? null,
    colourspace: metadata.space ?? null,
    depth: metadata.depth ?? null,
    density: metadata.density ?? null,
    hasExif: Boolean(metadata.exif),
    hasIccProfile: Boolean(metadata.icc),
    hasXmp: Boolean(metadata.xmp),
    hasIptc: Boolean(metadata.iptc),
    metadataBytes: {
      exif: metadata.exif?.length ?? 0,
      xmp: metadata.xmp?.length ?? 0,
      iptc: metadata.iptc?.length ?? 0
    },
    exif: extracted?.exif ?? {},
    gps: extracted?.gps ?? {},
    xmp: { ...parseXmp(metadata.xmp), ...(extracted?.xmp ? { extracted: extracted.xmp } : {}) },
    iptc: parseIptc(metadata.iptc),
    parser: parserStatus,
    strippingAssessment: 'unknown'
  }
}
