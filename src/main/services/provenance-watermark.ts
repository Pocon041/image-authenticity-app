import { combineWatermarkChecks, scanMetadataWatermark } from './watermark-metadata'
import { inspectPixelWatermarks } from './watermark-reader'

type Json = Record<string, any>

export async function inspectWatermarks(args: {
  root: string
  originalPath: string
  displayPath: string
  exif?: Buffer
  xmp?: Buffer
  iptc?: Buffer
  signal: AbortSignal
}): Promise<Json> {
  const metadata = scanMetadataWatermark({
    exif: args.exif,
    xmp: args.xmp,
    iptc: args.iptc
  })
  const pixels = await inspectPixelWatermarks({
    root: args.root,
    originalPath: args.originalPath,
    displayPath: args.displayPath,
    signal: args.signal
  })
  return combineWatermarkChecks(metadata, pixels)
}
