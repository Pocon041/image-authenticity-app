# 第四人解释模块的协议接入

本文件反映当前实现。早期版本曾写"尚未包含 `generateExplanation`、VLM 加载或解释 UI"，该描述已失效；实际代码已接入本地 Ollama VLM、IPC 通道和前端展示。协议类型与引用校验仍以 `src/shared/protocol.ts` 为准。

## 输入

第二人每个任务有两个 JSON 入口：

- `analysis.json`：精简的视觉检测摘要，便于阅读和选择证据，不是 `EvidenceBundle` 类型。
- `bundle.json`：符合 `schemas/report-bundle.schema.json` v1.0 的标准证据包，包含 `image`、`reports`、`artifacts`。第四人用此文件确定正式报告身份、证据引用和附件索引。

两者来自同一快照，`analysis.reportId` 对应 `bundle.reports[0].reportId`，摘要中的 `evidenceId` 沿用完整包中的 ID。不要把 `analysis.json` 强制转换为 `EvidenceBundle`，也不要为适配第四人而重编号已有 ID。

联合包包含独立的 `manipulation`、`provenance` 和 `aigc` 报告；第四人按 `moduleId` 查找，不依赖数组顺序。

## 当前实现：综合判断与用户解释

`generateExplanation(bundle, taskId, modelName?, host?)`保持原有本地/服务端入口，按两个阶段工作：

1. 区域观察：从预测bbox截取带20%上下文（至少16像素）的原始局部图，每次只发送一张，让模型描述内容。只裁剪，不着色、不锐化或重绘，最多观察3个有证据引用的主要区域。
2. 综合判断：继续发送完整待分析图和原尺寸预测掩码，附上精简JSON：检测结论、分数、阈值、支持度、区域观察、图片对应和实际分歧。类别real/non_ai转换为“整图未见明显异常”/“未检出AI生成线索”，并把支持度与它支持的结论绑定，减少跨任务混淆。

实际模型输出简化为5个字段：finalDecision、primaryRegionId、subject、suspectedOperation、explanation。选择最值得关注的目标；没有目标时primaryRegionId为null。候选手法支持复制移动、拼接、擦除、局部修复/重绘、文字修改、AI生成或暂不能区分。它是模型推测，不写回检测器的operationHints。

仅检查JSON可解析、必要字段类型、枚举及区域引用，不再按专业词、文风、重复句或预期真假筛选输出。结构不符时最多重试一次，原始模型响应保存到报告extensions.rawJudgements；区域观察保存到extensions.visualObservations。模型判断与描述照实保留，不能把结构通过当作内容正确。所有模型调用共享120秒总预算，区域调用各自最多60秒。

最终 `ExplanationReport.result` 保持现有核心字段，并增加：

- `decisionSource=vlm/rule_fallback`：综合结论来源。
- `upstreamDecision`：上游原始判定，保留追溯，不固定VLM判断。
- `evidenceBalance`：面向用户的简短证据权衡。
- `primaryRegionId`：模型选择的优先目标，映射回正式区域ID。
- `regionAnalyses`：位置、对象、理由、suspectedOperation及证据ID；operationSource=vlm_hypothesis明确来源。位置按bbox对应整图计算，不依赖模型把编号解释成位置。

`analysis` 为用户摘要，`confidence` 仍为unavailable；技术claims/unresolved保留在原始记录。IPC将成功返回的解释保存至任务目录 `reports/explanation.json`，不重写原始bundle。右侧对话界面在检测完成后自动请求解释，技术报告默认折叠；换图后不展示迟到的解释。

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

测试覆盖图片/掩码顺序、区域别名与证据映射、独立VLM判定、基础说明回退，以及真实Electron中的进度消息、自动请求、取消、换图和窄窗口布局。测试使用明确的合成IPC/模型响应，不代表真实模型解释质量。

此前7个真实样例的运行数据属于旧的六段文本实现，不作为本版本模型质量验收。新版本已实测鸟类、票据、短信及真实对照快照；对象识别有改善，但手法猜测、理由编造与误判仍存在，未通过质量验收。完整对照在work/vlm-optimization-20261105，不能只挑选成功输出。模型支持度的定义见报告协议第10节，LPC保留在内部；图片和掩码空间对应本身不保证模型理解正确。

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

`numPredict=1200` 为简短摘要、证据权衡和最多3个区域保留输出预算；扩展格式时需重新检查截断情况。默认 `maxImages=3`，加载顺序为整图和最多两个定位器的掩码，不发送裁剪图。较小显存可减少图片上限；JSON只列实际读取成功的图片及其顺序。

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
[explanation-images] maxImages=3 sent=2
```
