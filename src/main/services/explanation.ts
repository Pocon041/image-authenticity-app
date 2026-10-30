import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { 
  EvidenceBundle, 
  ExplanationReport, 
  ModuleReport, 
  ExplanationResult,
  ProvenanceReport,
  ManipulationReport,
  AigcReport
} from '../../shared/protocol'
import { validateExplanationReport } from '../../shared/protocol'

const DEFAULT_MODEL = 'modelscope.cn/Qwen/Qwen3-VL-2B-Instruct-GGUF'
const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'
const MAX_IMAGES = 4

/**
 * 第四人核心服务：消费证据包，调用 VLM 生成解释报告。
 * 包含 VLM 调用、多图加载、JSON Schema 约束、模板兜底。
 */
export async function generateExplanation(
  bundle: EvidenceBundle,
  taskId: string,
  modelName = DEFAULT_MODEL,
  ollamaHost = DEFAULT_OLLAMA_HOST
): Promise<ExplanationReport> {
  const host = ollamaHost
  const startTime = performance.now()
  
  // 拼接真实的任务目录
  const taskDirectory = join(process.cwd(), 'work/analysis-runs', taskId)

  // 1. 提取上游报告（使用类型谓词收窄类型）
  const upstreamReports = bundle.reports
  const provenanceReport = upstreamReports.find((r): r is ProvenanceReport => r.moduleId === 'provenance')
  const manipulationReport = upstreamReports.find((r): r is ManipulationReport => r.moduleId === 'manipulation')
  const aigcReport = upstreamReports.find((r): r is AigcReport => r.moduleId === 'aigc')

  // 2. 收集可用的 evidenceIds（用于后置校验）
  const availableEvidenceIds = new Set<string>()
  upstreamReports.forEach((r) => r.evidence.forEach((e) => availableEvidenceIds.add(e.evidenceId)))

  // 3. 准备图片（多图策略）
  const images = await prepareImages(bundle, taskDirectory)

  // 4. 构建 Prompt
  const prompt = buildPrompt(provenanceReport, manipulationReport, aigcReport, availableEvidenceIds)

  let finalResult: ExplanationResult | null = null
  let mode: 'local' | 'mock' = 'local'
  let producerName = `ollama:${modelName}`
  let errorMsg: string | null = null

  // 5. 调用 Ollama（Node 原生 fetch）
  try {
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: '你是一个图像鉴伪解释器。你的任务是根据提供的结构化检测报告，生成一段给用户看的中文解释。你必须严格遵循以下规则：\n1. 只能使用提供的 JSON 中的信息，不得编造任何外部知识。\n2. 判断结论必须基于上游模块的 decision。\n3. 如果引用了证据，必须使用提供的 evidenceIds 列表中的 ID。\n4. 不要编造置信度数值。'
          },
          { role: 'user', content: prompt, images: images }
        ],
        stream: false,
        format: EXPLANATION_SCHEMA,
        options: { temperature: 0, num_predict: 1024 }
      }),
      signal: AbortSignal.timeout(120000) // 2分钟超时
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
    }

    const data = await response.json()
    const content = data.message?.content
    if (!content) throw new Error('Ollama 返回为空')

    // 解析并校验
    const parsed = JSON.parse(content) as ExplanationResult
    finalResult = parsed

    // 校验引用是否合法（传入上游报告）
    const tempReport = buildReport(bundle, taskId, finalResult, modelName, 'local', startTime, upstreamReports)
    const errors = validateExplanationReport(tempReport, upstreamReports)
    
    // 如果引用了不存在的 evidence，或者格式有严重问题，抛出错误以触发兜底
    if (errors.length > 0) {
      throw new Error(`VLM 输出校验失败: ${errors.join('; ')}`)
    }

  } catch (error) {
    console.warn('VLM 调用或校验失败，降级为模板兜底:', error)
    mode = 'mock'
    producerName = 'template-fallback'
    errorMsg = error instanceof Error ? error.message : String(error)
    
    // 6. 模板兜底逻辑
    finalResult = generateTemplateExplanation(provenanceReport, manipulationReport, aigcReport)
  }

  // 7. 构建最终报告
  return buildReport(bundle, taskId, finalResult, producerName, mode, startTime, upstreamReports, errorMsg)
}

// --- 辅助函数 ---

function buildReport(
  bundle: EvidenceBundle,
  taskId: string,
  result: ExplanationResult,
  producerName: string,
  mode: 'local' | 'mock',
  startTime: number,
  inputReports: ModuleReport[],
  errorMsg: string | null = null
): ExplanationReport {
  // 只把实际参与推导的报告列入 inputReportIds
  const usedReportIds = inputReports
    .filter((r) => ['provenance', 'manipulation', 'aigc'].includes(r.moduleId))
    .map((r) => r.reportId)

  return {
    schemaVersion: '1.0',
    reportId: `explanation-${crypto.randomUUID()}`,
    imageId: bundle.image.imageId,
    taskId: taskId, // 使用传入的真实 taskId
    moduleId: 'explanation',
    mode,
    status: 'completed',
    producer: { name: producerName, version: '1.0.0' },
    createdAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startTime),
    inputReportIds: usedReportIds,
    result,
    evidence: [],
    artifacts: [],
    limitations: errorMsg ? [`VLM 失败降级为模板：${errorMsg}`] : [],
    error: null
  }
}

async function prepareImages(bundle: EvidenceBundle, taskDirectory: string): Promise<string[]> {
  const base64Images: string[] = []
  
  // 1. 必须有显示图
  const displayArtifact = bundle.artifacts.find((a) => a.artifactId === bundle.image.displayArtifactId)
  if (displayArtifact) {
    try {
      const buf = await readFile(join(taskDirectory, displayArtifact.uri))
      base64Images.push(buf.toString('base64'))
    } catch (err) {
      console.warn('读取 display 图片失败:', err)
    }
  }

  // 2. 提取 manipulation 区域（多图）
  const manipulationReport = bundle.reports.find((r): r is ManipulationReport => r.moduleId === 'manipulation')
  if (manipulationReport?.result && manipulationReport.result.regions) {
    const regions = manipulationReport.result.regions
    // 按面积排序
    regions.sort((a, b) => (b.bboxXYWH[2] * b.bboxXYWH[3]) - (a.bboxXYWH[2] * a.bboxXYWH[3]))
    
    for (const region of regions) {
      if (base64Images.length >= MAX_IMAGES) break
      
      // 尝试加载掩码
      if (region.maskArtifactId) {
        const maskArtifact = bundle.artifacts.find((a) => a.artifactId === region.maskArtifactId)
        if (maskArtifact) {
          try {
            const buf = await readFile(join(taskDirectory, maskArtifact.uri))
            base64Images.push(buf.toString('base64'))
          } catch (err) {
            console.warn('读取 mask 图片失败:', err)
          }
        }
      }
      
      // 尝试加载裁剪图
      if (base64Images.length >= MAX_IMAGES) break
      const cropArtifact = bundle.artifacts.find((a) => 
        a.type === 'crop' && a.bboxXYWH && region.bboxXYWH && 
        a.bboxXYWH[0] === region.bboxXYWH[0] && a.bboxXYWH[1] === region.bboxXYWH[1]
      )
      if (cropArtifact) {
        try {
          const buf = await readFile(join(taskDirectory, cropArtifact.uri))
          base64Images.push(buf.toString('base64'))
        } catch (err) {
          console.warn('读取 crop 图片失败:', err)
        }
      }
    }
  }

  return base64Images
}

function buildPrompt(
  provenance: ProvenanceReport | undefined,
  manipulation: ManipulationReport | undefined,
  aigc: AigcReport | undefined,
  evidenceIds: Set<string>
): string {
  let reportContext = ''

  // 提炼 Manipulation 核心信息
  if (!manipulation || manipulation.status === 'failed') {
    reportContext += `【篡改检测】状态：未完成（原因：${manipulation?.error?.message || '无报告'}）。\n`
  } else {
    reportContext += `【篡改检测】状态：完成，结论：${manipulation.result?.decision}，发现 ${manipulation.result?.regions?.length || 0} 个可疑区域。\n`
  }

  // 提炼 Provenance 核心信息（只提取关键线索）
  if (provenance && provenance.status === 'completed') {
    reportContext += `【来源分析】状态：完成。`
    const xmpDetails = provenance.result?.metadata?.details?.xmp as any
    const tool = xmpDetails?.fields?.['xmp:CreatorTool']?.[0]
    if (tool) {
      reportContext += `元数据中发现了编辑工具线索："${tool}"（证据ID引用请使用与该元数据相关的ID）。`
    } else {
      reportContext += `未发现明显的编辑工具元数据。`
    }
    
    const cred = provenance.result?.credentials?.details?.outcome
    if (cred === 'no_manifest_container_found') {
      reportContext += `未发现 C2PA 凭证。`
    }
    reportContext += `\n`
  }

  return `你是一个专业的图像鉴伪解释助手。请根据以下检测报告，生成一段直接给用户看的中文解释。
【硬性要求】
1. 直接输出解释结论，禁止输出“我应该如何分析”、“在分析中应指出”等内心戏。
2. 如果篡改检测未完成，最终结论必须是 "inconclusive"（无法确定）。
3. 如果来源分析发现了 "Photoshop" 等工具，可以作为“可能经过编辑”的线索，但必须说明这不等于伪造。
4. 如果提及证据，请在 claims 中引用对应的 evidenceId。

【检测报告】
${reportContext}

可用的证据ID列表（若引用必须来自此列表）：
${Array.from(evidenceIds).join('\n')}
`
}

function generateTemplateExplanation(
  provenance: ProvenanceReport | undefined,
  manipulation: ManipulationReport | undefined,
  aigc: AigcReport | undefined
): ExplanationResult {
  const unresolved: string[] = []
  let finalDecision: 'suspicious' | 'no_anomaly_detected' | 'inconclusive' = 'inconclusive'
  const claims: { text: string; evidenceIds: string[] }[] = []
  let analysis = '根据当前可用证据，'

  // 分析 Manipulation
  if (!manipulation || manipulation.status === 'failed') {
    unresolved.push(`局部篡改检测未完成：${manipulation?.error?.message || '缺少报告'}`)
  } else if (manipulation.result?.decision === 'suspicious') {
    finalDecision = 'suspicious'
    const regionCount = manipulation.result.regions?.length || 0
    analysis += `检测到 ${regionCount} 处可疑区域。`
    // 如果有证据，加一条 claim
    if (manipulation.evidence && manipulation.evidence.length > 0) {
      claims.push({
        text: `定位模块标记了可疑区域。`,
        evidenceIds: [manipulation.evidence[0].evidenceId]
      })
    }
  }

  // 分析 Provenance (如果有关键线索)
  if (provenance && provenance.status === 'completed') {
    const toolEvidence = provenance.evidence.find(e => e.kind === 'image_metadata_inventory')
    // 使用类型断言绕过 strict 的 Record<string, unknown> 检查
    const xmpDetails = provenance.result?.metadata?.details?.xmp as any
    if (xmpDetails?.fields?.['xmp:CreatorTool']?.[0]?.includes('Photoshop')) {
      analysis += `来源分析发现元数据中包含 Photoshop 编辑工具信息，提示图像可能经过后期处理。`
      if (toolEvidence) {
        claims.push({
          text: `元数据 CreatorTool 标记为 Photoshop。`,
          evidenceIds: [toolEvidence.evidenceId]
        })
      }
      if (finalDecision === 'inconclusive') finalDecision = 'suspicious'
    }
  }

  if (analysis === '根据当前可用证据，') {
    analysis += '所有核心检测模块均未提供有效结论，无法判断图像真伪。'
  }

  return {
    finalDecision,
    confidence: { value: null, source: 'unavailable', calibrated: false },
    analysis,
    claims,
    unresolved
  }
}

// Ollama 的 JSON Schema 约束
const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: {
    finalDecision: { type: 'string', enum: ['suspicious', 'no_anomaly_detected', 'inconclusive'] },
    confidence: {
      type: 'object',
      properties: {
        value: { type: 'null' },
        source: { type: 'string', enum: ['unavailable'] },
        calibrated: { type: 'boolean', enum: [false] }
      },
      required: ['value', 'source', 'calibrated']
    },
    analysis: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['text', 'evidenceIds']
      }
    },
    unresolved: { type: 'array', items: { type: 'string' } }
  },
  required: ['finalDecision', 'confidence', 'analysis', 'claims', 'unresolved']
}