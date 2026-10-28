# v0.2.0：联合分析与简明报告

当前版本可从源码目录的 `start.cmd` 启动。日常界面只有选图、图片类型、开始分析与结果展示；单模型入口折叠在底部「开发与单模型调试」。HiFi-Net运行代码已移除，历史评测文档和本地结果保留。

## 使用

1. 选择本机PNG、JPEG或WebP图片。
2. 选择「普通照片」「文档 / 票据 / 截图」或「不确定 / 混合内容」。默认不确定；拍摄的小票也选择文档。
3. 点击开始分析。普通照片运行SICA和RITA；文档运行SICA和RiSE；不确定运行三个模型。模型依次使用GPU，SICA判真也继续定位。
4. 分别查看整图筛查与局部定位。两种定位均完成时可切换来源，或切换原图与叠加图；区域裁剪折叠展示。
5. 按类型只运行一种定位后，可点击补充检查。新任务复用上一轮完成的证据，只运行缺失或失败的模型，生成独立快照。更换图片或内容类型后需要重新分析。
6. 点击「打开报告文件夹」，读取 `analysis.json`；交接给后续分析时复制整个目录，保留它引用的图片、裁剪和掩码。

失败与未检出分开显示。某个模型失败时，其余模型继续执行并保留结果；所有模型都失败时，报告明确标记failed。取消会停止当前Python进程与后续调度，不生成该次任务的完成证据包；补充检查取消后，上一份结果仍可查看。

## 简明 JSON 的内容

`analysis.json` 是默认阅读及后续VLM输入的简明视图，Schema为 `schemas/manipulation-summary.schema.json`，`reportType=manipulation_summary`。它不替换现有v1.0机器证据包。

- `image`：原文件SHA256、统一imageId、显示尺寸与原图/显示副本的相对路径。公共坐标为EXIF校正、sRGB、未缩放的显示图像像素。
- `status`、`decision`：执行状态与尚未作出的整图判断。completed只表示计划检查结束；partial表示有模型失败；failed表示无模型成功。
- `screening`：SICA的模型版本、权重哈希、执行状态、fake/real分数和阈值，并明确未经校准。失败时只保存简短错误，详细路径和日志留在完整记录中。
- `localization`：各定位器版本与状态、区域数量、标记面积占比、独立掩码/响应图路径和证据ID。未安排项目标记not_run。
- `regions`：模型来源、区域ID、像素XYWH、面积（模型提供时）及原图裁剪路径。每个模型最多列出已有的20个最大区域；regionCount与listedRegionCount区分完整连通区域数量与已列出数量，完整掩码不截断。
- `evidence`：实际模型观察及附件引用。保留证据来源，不虚构具体编辑手段。
- `disagreements`、`limitations`：整图筛查与定位之间的分歧，以及解释时必须保留的能力限制。
- `audit`：固定指向同目录的 `bundle.json`，用于进一步校验与追溯。

简明报告不包含源码文件清单、逐块专家分数、训练优化器、运行时配置或base64图片。`score`仅保留SICA原始筛查分数；不生成平均分或综合篡改概率。RITA/RiSE的掩码独立保留，不取并集。无OCR或VLM语义分析，最终综合解释仍由第四阶段负责。

## 完整记录与目录

每次任务位于 `work/analysis-runs/<taskId>/`：

- `analysis.json`：简明入口。
- `bundle.json`、`report.json`：v1.0证据包与单一manipulation模块报告，含完整附件索引与哈希。
- `images/`：原文件副本及规范显示图。
- `detectors/<model>/`：该模型附件及原始报告，原始诊断信息保存在此处。
- `run.json`：任务执行状态，包括取消记录。

所有交接用附件路径都相对此任务目录，汇总时校验哈希并去重原图与显示副本。内部原始报告里的sourceReportId只用于追溯，不作为无法解析的上游inputReportIds。

加载VLM时，接入方需按路径实际读取图片并标注原图、裁剪、掩码类型；JSON里的路径本身不会自动成为视觉输入。保留区域和模型身份，避免将两个模型的重叠响应当成两份独立事实。

## 检查命令

```powershell
.\run.cmd run test:workflow
.\run.cmd run smoke:workflow -- --image <图片路径> --software-rendering
.\run.cmd run report:validate -- <任务目录>/analysis.json
.\run.cmd run examples:validate -- --bundle <任务目录>/bundle.json
```

联合Smoke调用真实模型；编排单元测试使用明确标注的合成适配器，只验证工程行为。`--software-rendering`仅对测试Electron禁用GPU渲染，模型仍使用CUDA，sandbox和contextIsolation保持开启。

模型配置沿用 `config/sica.local.json`、`rita.local.json`、`rise.local.json`。本版本仍使用源码开发环境，发布包的Python和权重分发不在本轮完成范围内。
