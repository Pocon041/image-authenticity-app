const C2PA_JUMBF_UUID = Buffer.from('6332706100110010800000aa00389b71', 'hex')

type PresenceOutcome =
  | 'manifest_container_found'
  | 'no_manifest_container_found'
  | 'unsupported_format'
  | 'malformed_container'

function scanPng(bytes: Buffer): { outcome: PresenceOutcome; location: string | null } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (bytes.length < signature.length || !bytes.subarray(0, 8).equals(signature))
    return { outcome: 'malformed_container', location: null }

  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) return { outcome: 'malformed_container', location: null }
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'caBX')
      return { outcome: 'manifest_container_found', location: 'png_caBX_chunk' }
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IEND')
      return { outcome: 'no_manifest_container_found', location: null }
    offset = end
  }
  return { outcome: 'malformed_container', location: null }
}

function scanJpeg(bytes: Buffer): { outcome: PresenceOutcome; location: string | null } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return { outcome: 'malformed_container', location: null }

  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return { outcome: 'malformed_container', location: null }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    if (offset >= bytes.length) return { outcome: 'malformed_container', location: null }
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return { outcome: 'malformed_container', location: null }
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length)
      return { outcome: 'malformed_container', location: null }
    const payloadStart = offset + 2
    const payloadEnd = offset + length
    if (
      marker === 0xeb &&
      bytes.subarray(payloadStart, payloadEnd).includes(C2PA_JUMBF_UUID)
    )
      return { outcome: 'manifest_container_found', location: 'jpeg_app11_jumbf_uuid' }
    offset += length
  }
  return { outcome: 'no_manifest_container_found', location: null }
}

function scanWebp(bytes: Buffer): { outcome: PresenceOutcome; location: string | null } {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')
    return { outcome: 'malformed_container', location: null }

  const declaredEnd = 8 + bytes.readUInt32LE(4)
  if (declaredEnd > bytes.length || declaredEnd < 12)
    return { outcome: 'malformed_container', location: null }
  let offset = 12
  while (offset + 8 <= declaredEnd) {
    const size = bytes.readUInt32LE(offset + 4)
    const end = offset + 8 + size + (size % 2)
    if (end > declaredEnd) return { outcome: 'malformed_container', location: null }
    if (bytes.toString('ascii', offset, offset + 4) === 'C2PA')
      return { outcome: 'manifest_container_found', location: 'webp_c2pa_chunk' }
    offset = end
  }
  return offset === declaredEnd
    ? { outcome: 'no_manifest_container_found', location: null }
    : { outcome: 'malformed_container', location: null }
}

/** Finds C2PA manifest container markers; it does not parse or verify credentials. */
export function scanC2paManifestPresence(bytes: Buffer, format?: string) {
  const result =
    format === 'png'
      ? scanPng(bytes)
      : format === 'jpeg'
        ? scanJpeg(bytes)
        : format === 'webp'
          ? scanWebp(bytes)
          : { outcome: 'unsupported_format' as const, location: null }

  return {
    status: 'completed',
    details: {
      method: 'c2pa_embedded_manifest_presence_scan',
      format: format ?? null,
      outcome: result.outcome,
      containerLocation: result.location,
      signatureValidation: 'not_run',
      remoteCredentialLookup: 'not_run',
      limitations: [
        '存在性扫描不解析清单、不验证签名或信任链，也不证明图像内容未被修改。',
        '未发现嵌入容器不代表没有外部或云端凭证。'
      ]
    }
  }
}
