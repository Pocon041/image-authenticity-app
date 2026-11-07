import type { AigcReport, ProvenanceReport } from '../../shared/protocol'
import type { UserExplanation } from './user-explanation'
import { provenanceForVlm } from './provenance-input'

/** Present an explicit, file-bound source declaration as a record, not a detector vote. */
export function sourceConclusion(
  provenance: ProvenanceReport | undefined,
  aigc: AigcReport | undefined
): UserExplanation | null {
  const credential = verifiedAiCredential(provenance)
  if (!credential) return null
  const creation = credential.actions?.find(
    (item: Record<string, unknown>) => item.action === 'c2pa.created' && item.softwareAgent
  )
  const tool = creation
    ? [creation.softwareAgent, creation.version].filter(Boolean).join('/')
    : credential.claimGenerator
  return describeSource(tool, !!creation, aigc)
}

export function verifiedAiCredential(provenance: ProvenanceReport | undefined) {
  if (provenance?.mode !== 'local') return null
  const source = provenanceForVlm(provenance)
  const credential = source.credentials
  if (
    credential?.aiDeclaration !== 'declared_ai_generated_or_composited' ||
    credential.validation?.claimSignature !== 'passed' ||
    credential.validation?.contentBinding !== 'passed'
  )
    return null

  return credential
}

function describeSource(
  tool: string | undefined,
  creation: boolean,
  aigc: AigcReport | undefined
): UserExplanation {
  const declaration = tool
    ? `来源凭证明确声明使用了AI生成或合成，并记录了${tool}的${creation ? '创建操作' : '来源信息'}`
    : '来源凭证明确声明这张图像使用了AI生成或合成'
  const fsd = aigc?.mode === 'local' && aigc.status === 'completed' ? aigc.result : null
  const corroboration =
    fsd?.decision === 'ai_generated'
      ? 'FSD的图像检测也支持AI生成，两项证据相互印证。'
      : fsd?.decision === 'non_ai'
        ? 'FSD本轮未检出AI生成线索；来源凭证仍明确记录了AI生成或合成。'
        : '本次判断依据来源凭证中明确的生成声明。'
  const reason = `${declaration}；${corroboration}`
  return {
    finalDecision: 'suspicious',
    aiGeneration: 'supported',
    aiGenerationSource: 'credentials',
    localManipulation: 'uncertain',
    lead: reason,
    summary: [
      '### 补充依据',
      `- ${declaration}。`,
      `- ${corroboration}`,
      '',
      '### 来源检查',
      '凭证的声明签名与当前文件的内容绑定检查通过。'
    ].join('\n'),
    evidenceBalance: '',
    primaryRegionId: null,
    regions: [],
    assessment: {
      decision: 'suspicious',
      aiGeneration: 'supported',
      aiReason: reason,
      localManipulation: 'uncertain',
      focusIndex: null,
      targetDescription: '',
      operation: 'unknown',
      operationReason: '',
      operationEvidence: 'none'
    }
  }
}
