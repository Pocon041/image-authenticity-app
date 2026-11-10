import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import type {
  AnalysisReport,
  DetectorBackend,
  DetectorResult,
  HistoryEntry,
  HistoryPage,
  WorkflowRouting
} from '../../shared/contracts'
import {
  assertEvidenceBundle,
  validateExplanationReport,
  type EvidenceBundle,
  type ExplanationReport,
  type ModuleReport
} from '../../shared/protocol'
import { AppError } from '../errors'
import { importImage, type ImportedImage } from '../image-import'
import { sourceBytes } from './evidence-bundle'

interface StoredEntry extends HistoryEntry {
  schemaVersion: 1
  sha256: string
  mimeType: string
}
interface LegacyDetector {
  backend: DetectorBackend
  status: DetectorResult['status']
  reused?: boolean
  error?: DetectorResult['error']
  result?: {
    classification?: { predictedClass: 'real' | 'fake'; threshold: number }
    score?: { value: number }
    aigc?: NonNullable<AnalysisReport['aigc']>
    regionCount?: number
    areaFraction?: number
  }
}
const suffixes: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const backends = ['aigc', 'sica', 'rita', 'rise'] as const

async function directories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((item) => item.isDirectory() && /^[\w-]{1,80}$/.test(item.name))
      .map((item) => item.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
async function json<T>(directory: string, path: string): Promise<T> {
  const bytes = await sourceBytes(directory, path)
  if (bytes.length > 64 * 1024 * 1024) throw new Error('History record is too large')
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as T
}
async function thumbnail(bytes: Buffer): Promise<string> {
  const image = await sharp(bytes, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: 160, height: 120, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer()
  return `data:image/jpeg;base64,${image.toString('base64')}`
}
function validEntry(entry: StoredEntry, id: string): boolean {
  return (
    entry.schemaVersion === 1 &&
    entry.id === id &&
    typeof entry.name === 'string' &&
    Number.isFinite(Date.parse(entry.createdAt)) &&
    /^[a-f0-9]{64}$/.test(entry.sha256) &&
    !!suffixes[entry.mimeType] &&
    ['workflow', 'mock', ...backends].includes(entry.backend) &&
    ['completed', 'partial', 'failed'].includes(entry.status) &&
    ['mock', 'local'].includes(entry.mode) &&
    entry.width > 0 &&
    entry.height > 0 &&
    typeof entry.thumbnailDataUrl === 'string' &&
    entry.thumbnailDataUrl.startsWith('data:image/jpeg;base64,')
  )
}

function validStoredReport(report: AnalysisReport, entry: StoredEntry): boolean {
  if (
    report.id !== entry.id ||
    report.imageId !== `sha256:${entry.sha256}` ||
    report.backend !== entry.backend ||
    report.mode !== entry.mode ||
    typeof report.title !== 'string' ||
    typeof report.summary !== 'string' ||
    typeof report.disclaimer !== 'string' ||
    !Number.isFinite(report.elapsedMs) ||
    !Number.isFinite(Date.parse(report.createdAt)) ||
    !Array.isArray(report.sections) ||
    !report.sections.every(
      (section) =>
        section && typeof section.title === 'string' && typeof section.description === 'string'
    )
  )
    return false
  if (entry.backend === 'workflow') {
    const workflow = report.workflow
    return (
      !!workflow &&
      Array.isArray(workflow.detectors) &&
      workflow.detectors.every(
        (detector) =>
          detector &&
          backends.includes(detector.backend) &&
          ['completed', 'not_run', 'failed'].includes(detector.status)
      ) &&
      Array.isArray(workflow.flags) &&
      workflow.flags.every((flag) => typeof flag === 'string') &&
      ['completed', 'partial', 'failed'].includes(workflow.status) &&
      ['photo', 'document', 'unsure'].includes(workflow.contentType) &&
      !!workflow.summary &&
      typeof workflow.summary === 'object'
    )
  }
  if (entry.backend === 'sica')
    return (
      !!report.classification &&
      Number.isFinite(report.classification.score) &&
      Number.isFinite(report.classification.threshold)
    )
  if (entry.backend === 'aigc')
    return (
      !!report.aigc && Number.isFinite(report.aigc.zScore) && Number.isFinite(report.aigc.threshold)
    )
  if (entry.backend === 'rita' || entry.backend === 'rise')
    return (
      !!report.localization &&
      typeof report.localization.overlayDataUrl === 'string' &&
      report.localization.overlayDataUrl.startsWith('data:image/')
    )
  return true
}

export class AnalysisHistory {
  private readonly storage: string
  private readonly runs: string
  private readonly legacyIndex = new Map<string, { version: string; entry: HistoryEntry }>()
  private readonly legacyThumbnails = new Map<string, string>()

  constructor(root: string) {
    this.storage = resolve(root, 'work/desktop-history')
    this.runs = resolve(root, 'work/analysis-runs')
  }

  async save(image: ImportedImage, report: AnalysisReport): Promise<void> {
    if (
      !/^[\w-]{1,80}$/.test(report.id) ||
      report.imageId !== image.asset.id ||
      digest(image.originalBytes) !== image.asset.sha256
    )
      throw new Error('History image identity mismatch')
    const temporary = join(this.storage, `${report.id}.${randomUUID()}.tmp`)
    if (dirname(temporary) !== this.storage) throw new Error('Invalid history staging path')
    await mkdir(temporary, { recursive: true })
    try {
      const entry: StoredEntry = {
        schemaVersion: 1,
        id: report.id,
        name: image.asset.name,
        createdAt: report.createdAt,
        backend: report.backend ?? 'mock',
        mode: report.mode,
        status: report.workflow?.status ?? 'completed',
        width: image.asset.width,
        height: image.asset.height,
        sha256: image.asset.sha256,
        mimeType: image.asset.mimeType,
        thumbnailDataUrl: await thumbnail(image.originalBytes)
      }
      await writeFile(join(temporary, `original.${suffixes[entry.mimeType]}`), image.originalBytes)
      await writeFile(join(temporary, 'report.json'), JSON.stringify(report))
      await writeFile(join(temporary, 'entry.json'), JSON.stringify(entry))
      await rename(temporary, join(this.storage, report.id))
    } finally {
      // This is the staging directory created by this call under the fixed history root.
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async saveExplanation(report: ExplanationReport): Promise<void> {
    const entry = await this.entry(report.taskId)
    if (report.imageId !== `sha256:${entry.sha256}`)
      throw new Error('History explanation identity mismatch')
    const directory = join(this.storage, report.taskId)
    const temporary = join(directory, `explanation.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(report))
      await rename(temporary, join(directory, 'explanation.json'))
    } finally {
      await rm(temporary, { force: true })
    }
  }

  private async entry(id: string): Promise<StoredEntry> {
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('Invalid history ID')
    const entry = await json<StoredEntry>(this.storage, `${id}/entry.json`)
    if (!validEntry(entry, id)) throw new Error('Invalid history metadata')
    return entry
  }

  private async legacyBundle(id: string): Promise<EvidenceBundle> {
    const bundle = await json<unknown>(this.runs, `${id}/bundle.json`)
    assertEvidenceBundle(bundle)
    const report = bundle.reports.find((item) => item.moduleId === 'manipulation')
    if (!report || report.taskId !== id) throw new Error('Invalid legacy history identity')
    return bundle
  }

  async list(query: string, offset: number): Promise<HistoryPage> {
    const records = new Map<string, { entry: HistoryEntry; legacy: boolean }>()
    let skipped = 0
    for (const id of await directories(this.storage)) {
      try {
        records.set(id, { entry: await this.entry(id), legacy: false })
      } catch {
        skipped++
      }
    }
    for (const id of await directories(this.runs)) {
      if (records.has(id)) continue
      try {
        const file = await stat(join(this.runs, id, 'bundle.json'))
        const version = `${file.mtimeMs}:${file.size}`
        const cached = this.legacyIndex.get(id)
        if (cached?.version === version) {
          records.set(id, { entry: cached.entry, legacy: true })
          continue
        }
        this.legacyThumbnails.delete(id)
        const bundle = await this.legacyBundle(id)
        const report = bundle.reports.find((item) => item.moduleId === 'manipulation')!
        const original = bundle.artifacts.find(
          (item) => item.artifactId === bundle.image.originalArtifactId
        )
        if (!original || !suffixes[original.mediaType]) continue
        const status =
          report.extensions?.executionStatus ?? report.result?.executionStatus ?? 'completed'
        const entry: HistoryEntry = {
          id,
          name: `图像-${bundle.image.sha256.slice(0, 8)}.${suffixes[original.mediaType]}`,
          createdAt: report.createdAt,
          backend: 'workflow',
          mode: report.mode,
          status: status === 'partial' || status === 'failed' ? status : 'completed',
          width: bundle.image.width,
          height: bundle.image.height,
          thumbnailDataUrl: ''
        }
        records.set(id, { entry, legacy: true })
        this.legacyIndex.set(id, { version, entry })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped++
      }
    }
    const search = query.trim().toLocaleLowerCase()
    const matching = [...records.values()]
      .filter(({ entry }) => entry.name.toLocaleLowerCase().includes(search))
      .sort(
        (a, b) =>
          Date.parse(b.entry.createdAt) - Date.parse(a.entry.createdAt) ||
          b.entry.id.localeCompare(a.entry.id)
      )
    const page = matching.slice(offset, offset + 40)
    const entries: HistoryEntry[] = []
    for (let start = 0; start < page.length; start += 4) {
      const batch = await Promise.all(
        page.slice(start, start + 4).map(async ({ entry, legacy }) => {
          if (!legacy) return entry
          const cached = this.legacyThumbnails.get(entry.id)
          if (cached) return { ...entry, thumbnailDataUrl: cached }
          try {
            const bundle = await this.legacyBundle(entry.id)
            const artifact = bundle.artifacts.find(
              (item) => item.artifactId === bundle.image.originalArtifactId
            )!
            const bytes = await sourceBytes(this.runs, `${entry.id}/${artifact.uri}`)
            if (digest(bytes) !== artifact.sha256) throw new Error('Image integrity failed')
            const thumbnailDataUrl = await thumbnail(bytes)
            this.legacyThumbnails.set(entry.id, thumbnailDataUrl)
            if (this.legacyThumbnails.size > 80) {
              const oldest = this.legacyThumbnails.keys().next().value!
              this.legacyThumbnails.delete(oldest)
            }
            return { ...entry, thumbnailDataUrl }
          } catch {
            return entry
          }
        })
      )
      entries.push(...batch)
    }
    return { entries, total: matching.length, skipped }
  }

  async open(id: string): Promise<{ image: ImportedImage; report: AnalysisReport }> {
    if (!/^[\w-]{1,80}$/.test(id)) throw new AppError('INVALID_REQUEST', '记录编号无效。')
    try {
      let entry: StoredEntry
      try {
        entry = await this.entry(id)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return await this.openLegacy(id)
        throw error
      }
      await sourceBytes(this.storage, `${id}/original.${suffixes[entry.mimeType]}`)
      const image = await importImage(
        join(this.storage, id, `original.${suffixes[entry.mimeType]}`)
      )
      if (image.asset.sha256 !== entry.sha256) throw new Error('Original image integrity failed')
      image.asset.name = entry.name
      const report = await json<AnalysisReport>(this.storage, `${id}/report.json`)
      report.backend ??= entry.backend
      if (!validStoredReport(report, entry)) throw new Error('History report identity mismatch')
      if (report.workflow) {
        assertEvidenceBundle(report.workflow.bundle)
        const savedImage = report.workflow.bundle.image
        if (
          savedImage.imageId !== image.asset.id ||
          savedImage.sha256 !== image.asset.sha256 ||
          savedImage.width !== image.asset.width ||
          savedImage.height !== image.asset.height
        )
          throw new Error('History bundle image mismatch')
        if (
          report.explanation &&
          validateExplanationReport(report.explanation, report.workflow.bundle.reports).length
        )
          delete report.explanation
      }
      await this.attachExplanation(report, this.storage, `${id}/explanation.json`)
      if (!report.explanation)
        await this.attachExplanation(report, this.runs, `${id}/reports/explanation.json`)
      return { image, report }
    } catch (error) {
      console.warn('[history] cannot open record', id, error)
      throw new AppError('INVALID_REQUEST', '这条记录的图像或报告无法读取，文件可能已移动或损坏。')
    }
  }

  private async attachExplanation(
    report: AnalysisReport,
    directory: string,
    path: string
  ): Promise<void> {
    if (!report.workflow) return
    try {
      const explanation = await json<ExplanationReport>(directory, path)
      const bundle = report.workflow.bundle as unknown as EvidenceBundle
      if (
        explanation.taskId === report.id &&
        explanation.imageId === report.imageId &&
        validateExplanationReport(explanation, bundle.reports).length === 0
      )
        report.explanation = explanation
    } catch {
      /* Some older records were saved before an explanation was generated. */
    }
  }

  private async openLegacy(id: string): Promise<{ image: ImportedImage; report: AnalysisReport }> {
    const bundle = await this.legacyBundle(id)
    const source = bundle.reports.find((item) => item.moduleId === 'manipulation')!
    const original = bundle.artifacts.find(
      (item) => item.artifactId === bundle.image.originalArtifactId
    )!
    const bytes = await sourceBytes(this.runs, `${id}/${original.uri}`)
    if (digest(bytes) !== bundle.image.sha256 || original.sha256 !== bundle.image.sha256)
      throw new Error('Legacy image integrity failed')
    const image = await importImage(join(this.runs, id, original.uri))
    image.asset.name = `图像-${image.asset.sha256.slice(0, 8)}.${suffixes[image.asset.mimeType]}`
    const summary = await json<Record<string, unknown>>(this.runs, `${id}/analysis.json`)
    const saved = (source.result?.detectors ??
      source.extensions?.detectorExecutions) as LegacyDetector[]
    if (!Array.isArray(saved)) throw new Error('Legacy detector records missing')
    const detectors: DetectorResult[] = []
    for (const backend of backends) {
      const record = saved.find((item) => item.backend === backend)
      if (!record || record.status !== 'completed') {
        detectors.push({
          backend,
          status: record?.status ?? 'not_run',
          elapsedMs: 0,
          ...(record?.error ? { error: record.error } : {})
        })
        continue
      }
      const module = await json<ModuleReport>(this.runs, `${id}/detectors/${backend}/report.json`)
      if (module.imageId !== image.asset.id || module.status !== 'completed')
        throw new Error('Legacy detector identity mismatch')
      const owned = new Set(module.artifacts.map((artifact) => artifact.artifactId))
      const detectorBundle = {
        ...bundle,
        reports: [module],
        artifacts: bundle.artifacts.filter(
          (artifact) =>
            owned.has(artifact.artifactId) ||
            artifact.type === 'original' ||
            artifact.type === 'display'
        )
      }
      const common = {
        bundlePath: join(this.runs, id, 'bundle.json'),
        bundle: detectorBundle as unknown as Record<string, unknown>
      }
      const detector: DetectorResult = {
        backend,
        status: 'completed',
        elapsedMs: module.elapsedMs,
        reused: record.reused
      }
      if (backend === 'sica' && record.result?.classification && record.result.score) {
        detector.classification = {
          ...common,
          decision: record.result.classification.predictedClass,
          score: record.result.score.value,
          threshold: record.result.classification.threshold,
          checkpointVariant: 'full'
        }
      } else if (backend === 'aigc' && record.result?.aigc) {
        detector.aigc = { ...record.result.aigc, ...common }
      } else if (backend === 'rita' || backend === 'rise') {
        const mask = module.artifacts.find((artifact) => artifact.type === 'mask')
        if (!mask) throw new Error('Legacy localization mask missing')
        const maskBytes = await sourceBytes(this.runs, `${id}/${mask.uri}`)
        if (digest(maskBytes) !== mask.sha256) throw new Error('Legacy mask integrity failed')
        const base = Buffer.from(image.asset.dataUrl.split(',')[1], 'base64')
        const dimensions = await sharp(base).metadata()
        const pixels = await sharp(maskBytes)
          .resize(dimensions.width, dimensions.height, { kernel: 'nearest' })
          .greyscale()
          .raw()
          .toBuffer()
        const tint = Buffer.alloc(pixels.length * 4)
        for (let index = 0; index < pixels.length; index++) {
          tint[index * 4] = 238
          tint[index * 4 + 1] = 88
          tint[index * 4 + 2] = 82
          tint[index * 4 + 3] = pixels[index] > 0 ? 115 : 0
        }
        const overlay = await sharp(base)
          .composite([
            {
              input: tint,
              raw: { width: dimensions.width!, height: dimensions.height!, channels: 4 }
            }
          ])
          .png()
          .toBuffer()
        detector.localization = {
          ...common,
          decision: 'inconclusive',
          score: null,
          regionCount: record.result?.regionCount ?? 0,
          manipulatedAreaFraction: record.result?.areaFraction ?? 0,
          overlayDataUrl: `data:image/png;base64,${overlay.toString('base64')}`
        }
        detector.regionPreviews = []
        for (const region of (module.moduleId === 'manipulation'
          ? (module.result?.regions ?? [])
          : []
        ).slice(0, 20)) {
          const crop = bundle.artifacts.find(
            (artifact) => artifact.artifactId === region.cropArtifactId
          )
          if (!crop) continue
          const cropBytes = await sourceBytes(this.runs, `${id}/${crop.uri}`)
          if (digest(cropBytes) !== crop.sha256) throw new Error('Legacy crop integrity failed')
          detector.regionPreviews.push({
            regionId: region.regionId,
            bboxXYWH: region.bboxXYWH,
            areaPixels: typeof region.areaPixels === 'number' ? region.areaPixels : null,
            dataUrl: await thumbnail(cropBytes)
          })
        }
      }
      detectors.push(detector)
    }
    const contentType =
      source.result?.contentType === 'photo' || source.result?.contentType === 'document'
        ? source.result.contentType
        : 'unsure'
    const status = source.extensions?.executionStatus ?? source.result?.executionStatus
    const report: AnalysisReport = {
      id,
      imageId: image.asset.id,
      backend: 'workflow',
      mode: source.mode,
      createdAt: source.createdAt,
      elapsedMs: source.elapsedMs,
      title: '已保存的检测结果',
      summary: '',
      sections: [],
      disclaimer: source.limitations.join(' '),
      workflow: {
        contentType,
        primary: contentType === 'photo' ? 'rita' : contentType === 'document' ? 'rise' : null,
        status: status === 'partial' || status === 'failed' ? status : 'completed',
        detectors,
        flags: Array.isArray(source.result?.disagreements)
          ? (source.result.disagreements as string[])
          : [],
        bundlePath: join(this.runs, id, 'bundle.json'),
        bundle: bundle as unknown as Record<string, unknown>,
        summaryPath: join(this.runs, id, 'analysis.json'),
        summary,
        routing: source.result?.routing as WorkflowRouting | undefined
      }
    }
    await this.attachExplanation(report, this.runs, `${id}/reports/explanation.json`)
    return { image, report }
  }
}
