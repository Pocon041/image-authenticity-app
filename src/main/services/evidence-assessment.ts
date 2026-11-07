import type { ExplanationConfig } from './explanation'
import type { FinalDecision } from '../../shared/protocol'
import { BOUNDARY_NOTE } from './visual-boundary'

type RawReply = { message?: { content?: string }; done_reason?: string; [key: string]: unknown }
const LABELS: Record<string, FinalDecision> = {
  存在可疑线索: 'suspicious',
  未发现明显异常: 'no_anomaly_detected',
  暂不能确定: 'inconclusive'
}
export const OPERATION_NAMES = {
  copy_move: '复制移动',
  splicing: '拼接',
  removal_inpainting: '移除或修复填补',
  unknown: '暂不能区分'
} as const
export interface EvidenceAssessment {
  decision: FinalDecision
  focusIndex: number | null
  targetDescription: string
  operation: keyof typeof OPERATION_NAMES
  operationReason: string
  operationEvidence: 'duplicate_internal' | 'external_boundary' | 'erased_filled' | 'none'
}

async function request(
  config: ExplanationConfig,
  messages: unknown[],
  format: unknown,
  signal: AbortSignal
) {
  const response = await fetch(`${config.host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      format,
      options: { temperature: 0, num_ctx: config.numCtx, num_predict: 480 }
    }),
    signal
  })
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
  return (await response.json()) as RawReply
}

export async function locateCandidates(args: {
  images: string[]
  count: number
  regions: number[][]
  config: ExplanationConfig
  signal: AbortSignal
}) {
  if (!args.images.length || !args.count) return { status: 'skipped', focusIndex: null, raw: null }
  let raw: RawReply | undefined
  try {
    raw = await request(
      args.config,
      [
        { role: 'system', content: `${BOUNDARY_NOTE}只对应候选位置，不判断真假或编辑方式。` },
        {
          role: 'user',
          content: JSON.stringify({
            task: '对应轮廓与候选编号，选择优先查看的一处，没有明确对象可填null',
            candidates: args.regions.map((bboxXYWH, i) => ({ index: i + 1, bboxXYWH }))
          }),
          images: args.images
        }
      ],
      {
        type: 'object',
        properties: {
          focusIndex: { enum: [...Array.from({ length: args.count }, (_, i) => i + 1), null] }
        },
        required: ['focusIndex']
      },
      args.signal
    )
    const v = JSON.parse(raw.message?.content ?? '')
    if (
      raw.done_reason === 'length' ||
      (v.focusIndex !== null &&
        (!Number.isInteger(v.focusIndex) || v.focusIndex < 1 || v.focusIndex > args.count))
    )
      throw new Error('位置对应返回无效')
    return { status: 'completed', focusIndex: v.focusIndex as number | null, raw }
  } catch (error) {
    return { status: 'failed', focusIndex: null, raw, error: String(error) }
  }
}

export async function assessOriginal(args: {
  original?: Buffer
  evidence: unknown
  count: number
  config: ExplanationConfig
  signal: AbortSignal
  rawJudgements: unknown[]
}): Promise<EvidenceAssessment> {
  const raw = await request(
    args.config,
    [
      {
        role: 'system',
        content:
          '这是未添加系统标记的待分析原图。依据原图与各检测器结果作初步判断：存在可疑线索表示值得核查，并不表示已证实；未发现明显异常表示没有值得关注的检测线索；暂不能确定表示检查结果矛盾。整图筛查与AI生成检测是不同任务，未报警不排除局部修改。定位响应不是正确率。选择优先核查的位置编号，没有可对应对象则null。'
      },
      {
        role: 'user',
        content: JSON.stringify(args.evidence),
        ...(args.original ? { images: [args.original.toString('base64')] } : {})
      }
    ],
    {
      type: 'object',
      properties: {
        decision: { enum: Object.keys(LABELS) },
        focusIndex: { enum: [...Array.from({ length: args.count }, (_, i) => i + 1), null] }
      },
      required: ['decision', 'focusIndex']
    },
    args.signal
  )
  args.rawJudgements.push({ stage: 'original_assessment', ...raw })
  const value = JSON.parse(raw.message?.content ?? '')
  if (
    raw.done_reason === 'length' ||
    typeof value.decision !== 'string' ||
    !Object.hasOwn(LABELS, value.decision) ||
    (value.focusIndex !== null &&
      (!Number.isInteger(value.focusIndex) ||
        value.focusIndex < 1 ||
        value.focusIndex > args.count))
  )
    throw new Error('原图判断的JSON结构无效')
  return {
    decision: LABELS[value.decision],
    focusIndex: value.focusIndex,
    targetDescription: '',
    operation: 'unknown',
    operationReason: '',
    operationEvidence: 'none'
  }
}

export async function inferOperation(args: {
  original?: Buffer
  target: string
  hasDuplicateEvidence?: boolean
  config: ExplanationConfig
  signal: AbortSignal
  rawJudgements: unknown[]
}): Promise<Pick<EvidenceAssessment, 'operation' | 'operationReason' | 'operationEvidence'>> {
  try {
    const images = [args.original]
      .filter((b): b is Buffer => !!b)
      .slice(0, args.config.maxImages)
      .map((b) => b.toString('base64'))
    const raw = await request(
      args.config,
      [
        {
          role: 'system',
          content:
            '推测重点位置最可能的编辑方式，并同时选择证据类型。copy_move只有发现同一图像中两个相同/重复对象及其对应关系时才考虑，证据类型duplicate_internal；不能因为局部裁剪内容也出现在整图就判定复制移动。splicing只有发现外部内容与周围边界/纹理/光照不协调时才考虑，证据类型external_boundary。removal_inpainting只有发现擦除、填补、修复或重绘痕迹时才考虑，证据类型erased_filled；没有清楚证据选unknown和none。图像就是待分析原图，没有修改前图，不虚构前后差异。reason只简述可见线索，分数高低不能区分手法。'
        },
        {
          role: 'user',
          content: JSON.stringify({
            target: args.target,
            imageRoles: images.length > 1 ? ['整图', '原始局部'] : ['整图'],
            task: '只推测重点位置可能涉及哪类编辑，不判断整图真假'
          }),
          images
        }
      ],
      {
        type: 'object',
        properties: {
          operation: { enum: ['unknown', 'copy_move', 'splicing', 'removal_inpainting'] },
          reason: { type: 'string', maxLength: 90 },
          evidenceType: {
            enum: ['duplicate_internal', 'external_boundary', 'erased_filled', 'none']
          }
        },
        required: ['operation', 'reason', 'evidenceType']
      },
      args.signal
    )
    args.rawJudgements.push({ stage: 'operation_hypothesis', ...raw })
    const value = JSON.parse(raw.message?.content ?? '')
    if (
      raw.done_reason === 'length' ||
      typeof value.operation !== 'string' ||
      !Object.hasOwn(OPERATION_NAMES, value.operation) ||
      typeof value.reason !== 'string' ||
      typeof value.evidenceType !== 'string' ||
      !['duplicate_internal', 'external_boundary', 'erased_filled', 'none'].includes(
        value.evidenceType
      )
    )
      throw new Error('手法分析结构无效')
    const supported =
      (value.operation === 'copy_move' &&
        value.evidenceType === 'duplicate_internal' &&
        args.hasDuplicateEvidence === true) ||
      (value.operation === 'splicing' && value.evidenceType === 'external_boundary') ||
      (value.operation === 'removal_inpainting' && value.evidenceType === 'erased_filled')
    return {
      operation: supported ? value.operation : 'unknown',
      operationReason: supported ? value.reason : '现有图像线索不足以区分具体手法',
      operationEvidence: supported ? value.evidenceType : 'none'
    }
  } catch (error) {
    args.rawJudgements.push({ stage: 'operation_hypothesis', error: String(error) })
    return {
      operation: 'unknown',
      operationReason: '本次未获得完整的手法分析结果',
      operationEvidence: 'none'
    }
  }
}
