# 第四人解释模块的协议接入

本文件反映当前实现。早期版本曾写"尚未包含 `generateExplanation`、VLM 加载或解释 UI"，该描述已失效；实际代码已接入本地 Ollama VLM、IPC 通道和前端展示。协议类型与引用校验仍以 `src/shared/protocol.ts` 为准。

## 输入

第二人每个任务有两个 JSON 入口：

- `analysis.json`：精简的视觉检测摘要，便于阅读和选择证据，不是 `EvidenceBundle` 类型。
- `bundle.json`：符合 `schemas/report-bundle.schema.json` v1.0 的标准证据包，包含 `image`、`reports`、`artifacts`。第四人用此文件确定正式报告身份、证据引用和附件索引。

两者来自同一快照，`analysis.reportId` 对应 `bundle.reports[0].reportId`，摘要中的 `evidenceId` 沿用完整包中的 ID。不要把 `analysis.json` 强制转换为 `EvidenceBundle`，也不要为适配第四人而重编号已有 ID。

联合包包含独立的 `manipulation`、`provenance` 和 `aigc` 报告；第四人按 `moduleId` 查找，不依赖数组顺序。

## 当前实现：综合判断与用户解释

`generateExplanation(bundle, taskId, modelName?, host?)`保持原有本地/服务端入口；可选第五参数 `options.onProgress` 提供真实阶段进度及增量正文。当前把不同职责分开调用现有2B：

1. 位置对应：按原报告面积顺序，每个定位器选一处有证据引用的主要候选（最多3处），生成无填色的预测外轮廓图。轮廓按真实8连通组件与bbox/areaPixels匹配，内孔不描线；只用于对应候选位置，不用于得出编辑手法。其余候选保留在上游完整报告，选择策略与数量写入extensions.regionSelection，面积不代表可疑概率。
2. 内容观察：先读取未加线的原始局部。RiSE区域若有来源OCR框与定位区域的几何关系，先保留实际邻近文字，再用一次整图+局部请求只解释字段作用；没有几何文字时才请求整图确认记录/字段。RITA不执行文档字段对应。原始观察、record/field、nearbyText、上下文返回和可见原文均保留，不把数字编号当完整记录名，不凭空生成数字。自身任一边小于8像素的区域标记skipped，不放大后猜对象。
3. 原图判断：发送未标记整图和JSON中的实际模型任务、作用范围（SICA/FSD为整图，RITA/RiSE为局部）、评分/阈值、支持度、区域内容、来源及分歧。VLM给出定性倾向、简短reason与优先候选编号，解析后映射正式regionId；不采用上游标签强制覆盖VLM，也不将轮廓图作为原图证据。
4. 手法推测：VLM比较copy_move（图内重复对象）、splicing（外部内容拼接替换）、removal_inpainting（移除/修复填补）以及unknown；不能因局部同时出现在整图就判copy_move。不由高分或文字变化自动映射，失败时记录unknown。类型与理由保留在assessment及rawJudgements的operation_hypothesis，仍是模型推测。
5. 用户表述：将判断、上下文目标、实际模型结论/支持程度、局部定位和手法类别一起转成说明，正文为“重点位置”“分析依据”两个部分。不送人工标记或原始专业数值，保留SICA/FSD各自任务范围，不能将SICA伪造分数称作AI生成分数。支持度0.8/0.5以上表述为较强/中等，仅为显示措辞，不改变任何检测阈值；缺失不写成低分。正文不使用“候选区域”，以“疑似篡改的位置”“值得重点检查的位置”表达。手法仍为vlm_hypothesis，不写回检测器operationHints；后续可选引用提取失败不改变已有判断和手法记录。

不按专业词、文风、重复句或预期真假筛选正文。只检查必要JSON类型、枚举和引用，手法引用最多重试一次；完整正文留在extensions.rawNarratives，判断和提取响应在rawJudgements，局部观察在visualObservations，位置对应在visualGuidance，供表述的事实记录在narrationFacts。inputPresentation按阶段记录轮廓图、原图和无图表述的实际输入方式。连接中断或正文达到输出上限保留原始片段并明确失败；全部调用共享120秒总预算，不伪造推理或进度。

来源输入统一由`provenance-input.ts`生成：只列编辑工具/相机/日期、凭证生成者/AI声明/操作、单句验证摘要及实际水印候选文字/位置。省略空字段和常规未命中，无线索为`{}`；检查未完成只列项目名称。`visual-observation.ts`在RiSE区域有同一坐标的来源OCR文字时，使用几何关系生成`nearbyText`和`contextSource=ocr_geometry`，不再额外请求VLM猜记录/字段；没有相交文字时才保留整图+局部的VLM上下文请求。完整OCR与验证明细留原报告，图像判断和表述阶段消费同一份来源事实，不反复加入泛化限制。

最终 `ExplanationReport.result` 保持现有核心字段，并增加：

- `decisionSource=vlm/rule_fallback`：综合结论来源。
- `upstreamDecision`：上游原始判定，保留追溯，不固定VLM判断。
- `evidenceBalance`：面向用户的简短证据权衡。
- `primaryRegionId`：原图判断阶段选择的优先目标，映射回正式区域ID。
- `regionAnalyses`：位置、对象、理由、suspectedOperation及证据ID；operationSource=vlm_hypothesis明确来源。位置按bbox对应整图计算，不依赖模型把编号解释成位置。

`analysis` 为原始完整正文，`confidence` 仍为unavailable；技术claims/unresolved保留在原始记录。IPC将解释保存至任务目录 `reports/explanation.json`，不重写原始bundle。右侧在检测完成后自动请求解释；上方分析过程可展开各定位器已完成的预览（不必等待全流程），正文完成后自动收起过程。只将本任务的实时文字显示为正文，换图后忽略迟到事件。Markdown仅渲染文字、强调和列表，不执行HTML或加载外部资源。

呈现顺序为结论先行：用原图判断阶段实际返回的finalDecision显示高亮“综合判断”，重点目标使用上下文对应名称；原图判断的`reason`原样进入事实记录，最终正文可以引用但不改写为检测器事实。可疑/未发现明显异常/暂不能确定分别采用不同配色。正文先写一句完整结论，把对象/字段、位置、篡改倾向和可能方式连起来；后续用“补充依据”“手法判断”补充细节，将实际模型结论与手法推测合并解释，原始文字仍完整保存。

定位预览支持打开大图、按原始比例查看及Esc关闭；预览字节仅在单项完成时发送一次，后续进度复用本任务缓存。模型失败或回答不完整时，界面保留过程和重试入口，基础模板仅留在诊断记录，不作为最终VLM回答展示。

检测完成后ImagePanel默认用报告primary对应的定位图替换左侧显示，无primary时选择首个可用定位器；支持原图及各定位器独立切换，放大跟随当前选择。重新选图、开始新检测或切换模式时不沿用旧结果；部分失败只展示实际可用定位图。这个显示副本不会变成VLM原图输入。

## 类型与运行时校验

四人共用类型在 `src/shared/protocol.ts`，与界面 DTO `contracts.ts::AnalysisReport` 分开。

```typescript
import { validateExplanationReport } from '../shared/protocol'

const errors = validateExplanationReport(report, bundle.reports)
if (errors.length) throw new Error(errors.join('; '))
```

- `validateExplanationReport(report)` 只检查报告结构和自身一致性；显式传入上游数组才执行引用解析，`[]` 表示没有上游报告，不等于省略参数。
- `claims[].evidenceIds` 必须能追溯到 `inputReportIds` 所指向报告的证据；`inputReportIds` 不能自引用，上游 `imageId` 必须一致。
- 校验成功仅说明结构和引用可追溯，不证明文字陈述事实正确，也不允许把像素响应或 VLM 自评改写成校准概率。
- `confidence` 当前固定为 `unavailable`；协议虽预留 `vlm_self_assessment` 和 `calibrated_fusion`，但当前未实现校准融合。

## 测试与验证范围

```powershell
.\run.cmd run test:explanation
.\run.cmd run test:confidence
.\run.cmd run test:protocol
.\run.cmd run smoke:conversation
```

测试覆盖真实连通区域外轮廓、同bbox内其他组件排除、内孔/图像边缘/无效几何、非边界原像素保持、单张轮廓图及人工标记说明、独立结构提取、NDJSON拆包/中断与故障回退，以及真实Electron中的逐步预览、增量显示、自动请求、取消、换图和窄窗口布局。测试使用合成IPC/模型响应，不代表真实模型解释质量。

本轮还验证轮廓仅用于位置对应、原图判断收到未标记原始字节、文档观察遵守单请求图片上限、表述输入没有人工标记/专业数值、可选手法引用失败不改变已有判断。真实2B四例与桌面联调保存在work/evidence-role-20261106/run-1793967125195及desktop；鸟类输出已避免将青线当作编辑、复述0.9898，但文档内容识别仍不精确，真实对照仍有误判。本轮属于输入职责修正，不等于解释质量整体通过验收。

此前7个真实样例的运行数据属于旧的六段文本实现，不作为本版本模型质量验收。新版本已实测鸟类、票据、短信及真实对照快照；对象识别有改善，但手法猜测、理由编造与误判仍存在，未通过质量验收。完整对照在work/vlm-optimization-20261105，不能只挑选成功输出。模型支持度的定义见报告协议第10节，LPC保留在内部；图片和掩码空间对应本身不保证模型理解正确。

2026-11-06对照保存在work/vlm-conversation-20261106，使用既有真实检测快照，不重跑检测或注入真值。正文与结构拆分后，鸟类例可指出右侧水鸟，但2B模型仍会复述指标、误读文档内容和把预测掩码当作对比图；真实对照还出现输出达到上限。这一轮不能宣称已达到高质量解释验收。

## 配置（`config/explanation.example.json` / `.local.json`）

模型名、Ollama 地址、上下文参数和送图上限已从代码移到配置文件，换模型不需要改代码。

| 字段 | 含义 | 类型 | 默认值 |
|---|---|---|---|
| `model` | Ollama 模型名；默认是从 `Qwen/Qwen3-VL-2B-Instruct-GGUF` 导入的本地标签 | 非空字符串 | `srdp-qwen3-vl-2b` |
| `host` | Ollama 地址 | 合法 URL（无协议头时按 `http://` 补全） | `http://127.0.0.1:11434` |
| `numCtx` | 上下文窗口 `num_ctx` | 正整数 | `8192` |
| `numPredict` | 输出上限 `num_predict` | 正整数 | `1200` |
| `maxImages` | 送图上限 | 正整数，≥1 | `3` |

`temperature` **不配置化**，代码固定为 `0`：解释任务要求确定性，不属于环境相关参数。JSON 不支持注释，模板里的 `_comment` 字段仅作文档说明，加载时被忽略。

`numPredict=1200` 控制用户正文输出上限；判断和位置对应单次最多240token，手法引用最多160token。`maxImages=3` 保留为单次请求图片上限：位置对应1张轮廓图、原图判断1张原图、文档观察最多2张未标记原图与局部；表述阶段0张。检测掩码保留后台，不作为独立图片发送给VLM。

优先级链（高 → 低，逐字段覆盖）：

1. `generateExplanation` 的显式参数（`modelName`、`ollamaHost`）；显式传入可切换运行服务。
2. 环境变量 `OLLAMA_HOST`（只影响 `host`；模型不设环境变量，避免与 Ollama 自身变量混淆，换模型请改配置或走显式参数）。
3. `config/explanation.local.json`；若设置了 `SRDP_EXPLANATION_CONFIG`，则用它指定的路径替代该文件（语义与 `SRDP_RITA_CONFIG` 一致，不新增配置层）。
4. `config/explanation.example.json`。
5. 代码内置默认值。

### 本地 Qwen3-VL 配置

当前默认走本机 Ollama。先将 `Qwen/Qwen3-VL-2B-Instruct-GGUF` 导入 Ollama，并在 `ollama list` 中确认实际标签；如果使用 `srdp-qwen3-vl-2b`，可以运行：

```powershell
ollama serve
.\run.cmd run explanation:setup -- --model srdp-qwen3-vl-2b
```

`explanation:setup` 只创建 Git 忽略的 `config/explanation.local.json`，不会下载模型或连接远程服务。图片解释时 Electron 只请求 `http://127.0.0.1:11434/api/chat`。已有云端调用仍可使用：把 `host` 和 `model` 配置为原来的服务地址与模型，或通过 `generateExplanation` 的显式参数传入，不会被本地配置逻辑删除。

每次调用 `generateExplanation` 都会重新读文件，**改完 JSON 保存即可，下一次分析生效，不用重启应用**。文件缺失、JSON 非法或字段类型不对时逐级回退，只影响出错的那个字段，不抛错——这与 rita/sica/rise/aigc「local 缺失即 `MODEL_NOT_READY`」不同：解释模块是最后一步，配置不全也应能退化运行。例外是**显式参数**：传入 `null`、空串或非法 URL 会直接抛错，不做静默回退，避免掩盖调用方 bug。

用法示例：

```powershell
# 只改本机模型，不动代码
# config/explanation.local.json -> "model": "modelscope.cn/Qwen/Qwen3-VL-7B-Instruct-GGUF"

# 临时改 Ollama 地址（仅 host 支持环境变量；换模型请改配置或用 --model）
$env:OLLAMA_HOST = "127.0.0.1:11434"   # 无协议头会自动补 http://

# 临时指定另一份配置文件（替代 local，不新增层级）
$env:SRDP_EXPLANATION_CONFIG = "E:\temp\test-explanation.json"

# 显式参数优先级最高
# 调用方可显式传入 modelName 和 host，优先于本机配置。
```

启动日志会打印每个字段的实际来源，便于排查：

```
[explanation-config] model=... (explicit) host=... (config/explanation.local.json) numCtx=8192 (builtin) ...
[explanation-images] maxImages=3 sent=1
```
