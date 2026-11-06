import type { ExplanationConfig } from './explanation'
import type { FinalDecision } from '../../shared/protocol'
import { BOUNDARY_NOTE } from './visual-boundary'

type RawReply = { message?: { content?: string }; done_reason?: string; [key: string]: unknown }
const LABELS: Record<string, FinalDecision> = {
  存在可疑线索: 'suspicious',
  未发现明显异常: 'no_anomaly_detected',
  暂不能确定: 'inconclusive'
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
      options: { temperature: 0, num_ctx: config.numCtx, num_predict: 240 }
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
}): Promise<{ decision: FinalDecision; focusIndex: number | null }> {
  const raw = await request(
    args.config,
    [
      {
        role: 'system',
        content:
          '这是未添加系统标记的待分析原图。综合原图与各任务的真实检测结果给出初步倾向：存在可疑线索表示值得核查，不是已证实；未发现异常表示本次检查没有明确异常线索；暂不能确定表示结果有分歧。整图筛查未报警与AI生成未检出都不能排除局部编辑。定位响应强度不是正确率。选择优先候选编号，没有可对应对象则null。'
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
  return { decision: LABELS[value.decision], focusIndex: value.focusIndex }
}
