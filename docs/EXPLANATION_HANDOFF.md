# 第四人解释模块的协议接入

已合并 `yr_explanation` 分支截至 `e2793d5` 的提交。该分支目前提供四模块协议类型和 `validateExplanationReport`，尚未包含 `generateExplanation`、VLM加载、Python推理服务或解释UI。下面说明第二人现有报告如何与这些类型衔接，不将协议验证当作解释能力已实现。

## 输入

第二人每个任务有两个JSON入口：

- `analysis.json`：精简的视觉检测摘要，便于阅读和选择证据，不是 `EvidenceBundle` 类型。
- `bundle.json`：符合 `schemas/report-bundle.schema.json` v1.0 的标准证据包，包含 `image`、`reports`、`artifacts`。第四人用此文件确定正式报告身份、证据引用和附件索引。

两者来自同一快照，`analysis.reportId` 对应 `bundle.reports[0].reportId`，摘要中的 `evidenceId` 沿用完整包中的ID。不要把 `analysis.json` 强制转换为 `EvidenceBundle`，也不要为适配第四人而重编号已有ID。

当前联合包有独立的manipulation和provenance报告。`analysis.json`仍只是篡改摘要，不包含完整来源检查详情；第四人应从bundle.json按moduleId查找并引用两个报告。AIGC尚未整合，解释应明确缺失信息，不生成该模块的假结果。

## 类型与运行时校验

四人共用类型在 `src/shared/protocol.ts`，与界面DTO `contracts.ts::AnalysisReport` 分开。联合证据汇总已经使用 `ImageInfo`、`Artifact`、`Evidence`、`Region`、`ManipulationReport` 和 `EvidenceBundle` 类型，并在读入原始模型包和写出联合包时执行共享Schema校验。

```typescript
import { assertEvidenceBundle, validateExplanationReport } from '../shared/protocol'

const input: unknown = JSON.parse(bundleText)
assertEvidenceBundle(input) // 此后 input 为 EvidenceBundle

// candidate 由第四人的解释实现生成；本接入不提供模型推理。
const errors = validateExplanationReport(candidate, input.reports)
if (errors.length) throw new Error(errors.join('; '))
```

引用规则：`candidate.imageId` 与上游相同，`inputReportIds` 只列实际使用的正式报告ID。每条 `claims[].evidenceIds` 必须来自这些输入报告的 `evidence`。内部 `detectors/*/report.json` 的sourceReportId只用于追溯，不能将其直接填入不存在于包内的inputReportIds。

`validateExplanationReport(candidate)` 只检查报告结构和自身一致性；传入上游数组才执行引用解析。显式传入 `[]` 表示没有上游报告，存在输入引用或证据引用时会报错，不等于省略参数。

运行时校验复用现有Schema，覆盖status/result/error与confidence来源/校准状态的约束；非法JSON结构返回错误列表，不依赖TypeScript断言。上游身份重复、跨图引用、自引用或无法解析的证据ID会报错。

校验成功仅表明结构和引用可追溯，不证明文字陈述正确，也不允许把像素响应或VLM自评改写成校准概率。混合mock/local包继续按各报告来源记录，解释必须说明模拟证据的存在。

## 图片与输出

所有附件URI均相对于任务目录。根据 `artifactId` 查索引，再由主进程读取实际图片，按原图、显示图、裁剪、模型掩码等类型传给VLM；JSON路径本身不会成为视觉输入。保留SHA256、规范显示坐标、候选区域和模型分歧。

第四人的结果应为独立 `ExplanationReport`。当前接入未增加解释IPC、UI按钮或预置解释文字；这些仍由第四人的后续实现提供，不改动第二人的检测职责。

## 已验证范围

```powershell
.\run.cmd run test:protocol
# 可指定本机真实输出，追加验证报告ID及证据ID衔接
.\run.cmd run test:protocol -- --bundle <任务目录>/bundle.json
.\run.cmd run test:workflow
.\run.cmd run build
```

协议测试使用明确标注的测试解释引用现有检测证据，不调用VLM，不把测试文字当作产品结果。原有图片身份、坐标、JSON结构及工作流保持兼容。
