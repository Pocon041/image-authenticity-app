# 第四人解释模块的协议接入

本文件反映当前实现。早期版本曾写"尚未包含 `generateExplanation`、VLM 加载或解释 UI"，该描述已失效；实际代码已接入本地 Ollama VLM、IPC 通道和前端展示。协议类型与引用校验仍以 `src/shared/protocol.ts` 为准。

## 输入

第二人每个任务有两个 JSON 入口：

- `analysis.json`：精简的视觉检测摘要，便于阅读和选择证据，不是 `EvidenceBundle` 类型。
- `bundle.json`：符合 `schemas/report-bundle.schema.json` v1.0 的标准证据包，包含 `image`、`reports`、`artifacts`。第四人用此文件确定正式报告身份、证据引用和附件索引。

两者来自同一快照，`analysis.reportId` 对应 `bundle.reports[0].reportId`，摘要中的 `evidenceId` 沿用完整包中的 ID。不要把 `analysis.json` 强制转换为 `EvidenceBundle`，也不要为适配第四人而重编号已有 ID。

联合包包含独立的 `manipulation`、`provenance` 和 `aigc` 报告；第四人按 `moduleId` 查找，不依赖数组顺序。

## 当前实现：代码装配结构化字段 + VLM 写分区短句

`src/main/services/explanation.ts` 的 `generateExplanation(bundle, taskId, modelName?, host?)` 按以下职责划分生成解释：

1. **代码确定性装配**（不经过模型）：
   - `finalDecision`：取自 `manipulation.result.decision`；报告缺失或未完成时为 `inconclusive`。
   - `confidence`：固定 `{ value: null, source: "unavailable", calibrated: false }`。
   - `claims`：按 `evidence.kind` 与 `detector` 从上游证据逐类装配，每条只引用本类 `evidenceId`，从构造上避免跨类错配与重复。
   - `unresolved`：从检测器状态、未校准项、C2PA/水印限制、模块分歧派生。
2. **VLM 只写分析文本**：本地 Ollama（默认 Qwen3-VL-2B-Instruct-GGUF，`http://127.0.0.1:11434`）按分区事实生成 6 个字符串字段：`conclusion`、`aiGeneration`、`classification`、`localization`、`provenance`、`limitations`。JSON Schema 只含字符串字段，没有数组，避免 2B 模型在 `claims` 数组上循环。
3. **逐段校验与回填**：对每段检查最小长度、角色混用（如 RITA/RiSE 被写成 AI 生成分类器）、未校准置信度与绝对化表述；不通过的段落用规则文本回填，而不是整份降级。
4. **整体兜底**：JSON 解析失败、缺字段、超时或网络错误时，`analysis` 全部使用规则模板，`mode` 标记为 `mock`，`producer` 标记为 `template-fallback`，并在 `limitations` 记录原因。

`analysis` 最终由 6 段拼接为带标签的中文文本；`claims` 与 `analysis` 使用同一批上游事实，便于追溯。

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

## 测试

在项目根目录运行：

```powershell
npx tsx work/test-all-bundles.ts
npx tsx work/test-all-bundles.ts --limit 2          # 只跑前两个样本，控制时间
npx tsx work/test-all-bundles.ts --only 35a79651    # 只跑指定 taskId 前缀
npx tsx work/test-all-bundles.ts --model <name> --host <url>
```

脚本扫描 `work/analysis-runs` 下含 `bundle.json` 的任务，串行调用 `generateExplanation`，输出到 `work/explanation-results/`（每个任务的完整结果、`summary.json`、`summary.md`），并检查：

- `validateExplanationReport` 结构与引用校验；
- 重复 claim 文本；
- claim 关键词与引用证据类别是否匹配；
- 绝对化用语；
- 是否提及 SICA / RITA / RiSE / AIGC / 分歧 / 限制。

当前 7 个样本结果：7/7 `mode=local`、`done_reason=stop` 无截断；`claims=7`、重复 claim=0、跨类引用=0；`validateExplanationReport` 全部通过；单样本 8–16s，7 样本合计 72.5s（RTX 3050 Ti 4GB，Qwen3-VL-2B）。

## 已知限制

- 2B 模型主要能力是复述分区事实，跨模块综合与复杂推理有限；`analysis` 是辅助描述，不构成鉴定结论。
- 默认只向模型传 1 张显示图（`maxImages` 可调大，见下节）；裁剪图与掩码仅在 `maxImages > 1` 时按面积顺序补送。
- 未实现 calibrated fusion；`confidence` 不能作为概率使用。
- 单图 `decision=inconclusive` 时，解释必须保留不确定性，不得改写成确定结论。

## 配置（`config/explanation.example.json` / `.local.json`）

模型名、Ollama 地址、上下文参数和送图上限已从代码移到配置文件，换模型不需要改代码。

| 字段 | 含义 | 类型 | 默认值 |
|---|---|---|---|
| `model` | Ollama 模型名；默认是从 `Qwen/Qwen3-VL-2B-Instruct-GGUF` 导入的本地标签 | 非空字符串 | `srdp-qwen3-vl-2b` |
| `host` | Ollama 地址 | 合法 URL（无协议头时按 `http://` 补全） | `http://127.0.0.1:11434` |
| `numCtx` | 上下文窗口 `num_ctx` | 正整数 | `8192` |
| `numPredict` | 输出上限 `num_predict` | 正整数 | `1200` |
| `maxImages` | 送图上限 | 正整数，≥1 | `1` |

`temperature` **不配置化**，代码固定为 `0`：解释任务要求确定性，不属于环境相关参数。JSON 不支持注释，模板里的 `_comment` 字段仅作文档说明，加载时被忽略。

**`numPredict: 1200` 是"当前 schema 的合适值"，不是硬性上限。** 6 个 ≤140 字短字段实测 `eval_count` 约 300–700，1200 是留有余量的档位；一旦扩展 `EXPLANATION_SCHEMA`（新增字段、放宽段落长度），必须同步调大，否则输出会被 `num_predict` 截断并降级为模板。

**`maxImages > 1` 会增加视觉 token。** 加载顺序为 display（整图）→ mask（篡改区域，面积大者优先）→ crop（局部特写，面积大者优先）。实测 `maxImages: 3` 时同一张 256×384 样本的 `prompt_eval_count` 从 1901 涨到 4065，接近翻倍；4GB 显存下需同时留意 `num_ctx` 是否够用。

优先级链（高 → 低，逐字段覆盖）：

1. `generateExplanation` 的显式参数（`modelName`、`ollamaHost`）；测试脚本 `--model` / `--host` 走这层。
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
npx tsx work/test-all-bundles.ts --model <name> --host http://127.0.0.1:11434
```

启动日志会打印每个字段的实际来源，便于排查：

```
[explanation-config] model=... (explicit) host=... (config/explanation.local.json) numCtx=8192 (builtin) ...
[explanation-images] maxImages=1 sent=1
```
