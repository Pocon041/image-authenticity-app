# 第一阶段报告协议 v1.0（联调初稿）

这份协议用于四人独立开发和结果汇总。前三个模块分别提交报告，第四个模块消费证据包。当前第二人已接入真实视觉检测；早期联调示例中的分析输出仍为明确标记的模拟数据。

机器可读定义为 `schemas/report-bundle.schema.json`。独立模块报告的入口是 `schemas/module-report.schema.json`；使用它时应同时加载证据包 Schema，因为两者共享同一份字段定义。

## 1. 本轮固定什么

固定图片身份、坐标、报告外层、状态、附件、证据引用和四类结果的最小字段。模块负责人可以在自己的 `result` 中增加字段，也可以使用报告的 `extensions`；公共字段、已约定字段的名称、类型或含义发生变化时需共同确认。

新增可选字段可以保持版本兼容。删除、改名或改变语义属于不兼容变更，应同步升级协议版本、校验器和样例。

四模块交换类型为 `src/shared/protocol.ts`，与 `schemas/report-bundle.schema.json` 对齐。APP已采用原文件SHA256身份，并通过主进程适配写出v1.0证据包；界面 `contracts.ts::AnalysisReport` 仍是独立DTO，不能直接当作标准证据包。第四人接入与引用校验说明见 [EXPLANATION_HANDOFF.md](./EXPLANATION_HANDOFF.md)。

## 2. 原文件和图片身份

- 原文件只读使用。准备样例时按字节复制，不覆盖数据集，不重编码原文件。
- SHA256 对原文件完整字节计算，采用 64 位小写十六进制。
- `imageId` 固定为 `sha256:<完整SHA256>`，不截断。相同原文件重复导入仍使用相同 ID。
- 文件名不参与身份计算。两张视觉相同但编码、元数据或原始字节不同的图片可以具有不同 ID。
- 每次运行的 `taskId` 和 `reportId` 独立生成，不用图片 ID 代替任务 ID。
- 来源凭证、元数据和水印分析读取原文件。检测方法如需缩放、归一化或裁剪，自行产生输入副本，并保留回到公共坐标的变换关系。

## 3. 唯一的显示坐标基准

为原文件生成一张规范显示副本：按 EXIF orientation 校正方向、转换为 sRGB PNG、**不缩放**。其尺寸记为 `image.width`、`image.height`。原文件编码尺寸另记为 `encodedWidth`、`encodedHeight`。

- 公共坐标名称：`display_image_pixels`。
- 原点位于规范显示副本左上角，x 向右，y 向下。
- `bboxXYWH = [x, y, width, height]`，全部为整数，单位为像素。
- 区域采用半开区间 `[x, x + width) × [y, y + height)`；宽高必须大于 0，区域不能越过图片边界。
- 先把模型输出映射回规范显示副本，再写入报告。模型的 letterbox、裁剪、缩放等信息可以保存在模块的扩展结果中。
- APP 中为了节约传输而缩小的预览图不作为报告坐标基准。界面在展示时依据规范尺寸计算缩放比例。
- 原文件附件使用 `encoded_file_pixels`。如果 EXIF 方向不是 1，原文件编码坐标与规范显示坐标可能不同。

掩码采用全尺寸 8 位 PNG，尺寸必须与规范显示副本一致，0 表示未标记，255 表示标记区域。二值掩码恢复尺寸时使用最近邻插值；连续响应图可以使用适合的连续插值，但须说明数值含义和阈值。

热图不默认代表概率。范围、数值方向及必要的阈值由证据的 `data` 或模块结果声明。当前示例热图只是 0/200 的灰度演示响应。

裁剪图使用 `region_local_pixels`；附件的 `bboxXYWH` 仍表示它在规范显示副本中的位置，`sourceArtifactId` 指向规范显示附件。裁剪图宽高与 bbox 宽高一致。

## 4. 单模块报告

公共必填字段如下：

- `schemaVersion`：当前为 `1.0`。
- `reportId`、`imageId`、`taskId`：报告、图片和任务身份。
- `moduleId`：固定为 `provenance`、`manipulation`、`aigc` 或 `explanation`。
- `mode`：`mock` 或 `local`。模拟标记逐报告保存，允许汇总时存在不同来源。
- `status`：`completed`、`failed`、`unsupported` 或 `not_run`。
- `producer`：实现或模型的名称和版本。
- `createdAt`：RFC 3339 时间；示例使用 UTC。`elapsedMs`：非负整数毫秒。
- `inputReportIds`：本次消费的上游报告 ID。前三人第一阶段可为空。
- `result`：模块专属结果；未完成时为 `null`。
- `evidence`、`artifacts`、`limitations`：分别为证据、该模块生成的附件和限制说明，缺少时使用空数组。
- `error`：无错误时为 `null`；`failed` 时必须含稳定错误代码和可展示的描述。

`completed` 只表示这次模块执行结束，不代表图片真实、模型判断正确或每一种内部检查均执行。来源分析中的凭证、水印等子项分别保留执行状态。

每次执行生成新报告。模块不轮流修改同一个 JSON 文件。公共汇总器负责将独立报告组成不可变的证据快照。

### provenance：来源信息与预处理

最小结果为 `preprocessing`、`metadata`、`credentials`、`watermark`。后三项各自含 `status` 和 `details`。

`preprocessing.details` 记录原文件完整 SHA256、编码尺寸、显示尺寸、EXIF 方向处理、sRGB PNG 格式。原文件副本位于 `images/original.<ext>`，无缩放的显示副本位于 `images/display.png`；显示图采用 8 位像素、左上角原点的 `display_image_pixels` 坐标基准。

`metadata.details` 保存格式、尺寸、方向、色彩空间、EXIF、GPS、XMP、IPTC 字段和解析状态。字段不存在或元数据区段缺失时，`strippingAssessment` 必须保持 `unknown`，不能推断被剥离或伪造。

`credentials.details` 分开记录容器标记扫描结果、C2PA Reader 的活动清单、签发信息、声明动作、数字来源类型、签名验证和验证状态。读不到清单、容器格式不支持、清单解析失败和未发现清单是不同状态。离线 Reader 不获取远程清单或 OCSP 信息；验证结果不能简化成来源绝对可信。

`watermark.details.detectors` 将元数据关键词、可见文字 OCR 和隐形载荷解码分开。可见文字仅报告图库/水印词的候选和显示坐标框；隐形检查目前只比对 Stable Diffusion XL 公开的固定 48 位 DWT-DCT 载荷。未匹配不代表不存在其他水印；SynthID 和通用隐形载荷不在支持范围内。每项候选都应带局限说明，OCR 文字不能证明其为后期水印。

子检查未运行或失败必须分别保留状态，不能写成未检出。`docs/PROVENANCE_V01.md` 记录第一人模块字段、安装方式和现有检测边界。

### manipulation：篡改分类与定位

最小结果为 `decision`、`score`、`regions`、`operationHints`。

- `decision`：`suspicious`、`no_anomaly_detected` 或 `inconclusive`。
- `score`：原始检测分数，或 `null`。非空时须标明分数名称、数值、正类和是否校准。
- `regions`：每项包含唯一 `regionId`、公共坐标 bbox 和可选的 `maskArtifactId`。
- `operationHints`：可选的操作线索列表，未知时为空。不从一张异常图直接推断具体编辑操作。

### aigc：图像级 AI 生成检测

最小结果为 `decision`、`score`、`clues`。

- `decision`：`ai_generated`、`non_ai` 或 `inconclusive`。
- 分数要求同上。`non_ai` 不代表图片没有局部篡改。
- `clues` 为方法实际支持的解释线索，没有时为空。注意力或显著性图应准确说明含义，不能直接称为篡改真值。

### explanation：综合解释

最小结果为 `finalDecision`、`confidence`、`analysis`、`claims`、`unresolved`。

- 总体判断为 `suspicious`、`no_anomaly_detected` 或 `inconclusive`，AI 与篡改两条原始判断继续保存在各自报告里。
- `analysis` 是最终展示的自然语言。
- 每条 `claims` 保存文字及非空的 `evidenceIds`，引用必须来自它的 `inputReportIds`。
- `confidence.source` 区分 `unavailable`、`vlm_self_assessment`、`calibrated_fusion`。未提供时数值为 `null`；VLM 自评值不能标为已校准。
- 如果将来使用校准融合值，应另行记录校准方法、版本和验证依据；当前没有实现这一能力。
- 输入有模拟分析时，输出需说明这一事实。本轮只提供前三个模块的输入，不预置解释答案；实际接入时可返回 `inconclusive` 和空置信度，保留证据不足的状态。

F1、IoU、AUROC 等离线评测指标不充当待测图片的单图证据。方法评测信息单独维护。

## 5. 证据与附件

证据至少记录 `evidenceId`、`kind`、`origin`、`description`、`regionId`、`artifactIds`、`data`、`limitation`。ID 在同一证据包中唯一；建议以所属 `reportId` 作为前缀。`origin` 区分真实读取或测量的 `measured` 和编造的 `mock`。

模块产生的文件记录在它的 `artifacts` 中。每个附件都有 `artifactId`、类型、`uri`、媒体类型、文件 SHA256、宽高、坐标空间、bbox、父附件和来源类型。

- `uri` 相对于**整个样例或任务目录**，不是相对于 `reports/` 子目录。
- 只使用 `/` 分隔的相对路径，不写盘符、绝对路径或 `..`。
- 原文件 `origin=original`，实际生成的副本或裁剪 `origin=derived`，编造的掩码或热图 `origin=mock`。
- 汇总器把公共图片附件与各报告附件合并为证据包的全局 `artifacts` 索引。相同附件 ID 的元信息必须完全一致。
- 模块结果、证据和结论通过 ID 引用，引用必须能解析。

## 6. 汇总包与 VLM 输入

证据包外层为 `schemaVersion`、`bundleId`、`purpose`、`createdAt`、`image`、`reports`、`artifacts`。其中 `purpose=integration_fixture` 明确表示联调用例。

正式运行时可以保存包含四个模块的完整记录。本轮材料包只提供一份 `vlm-input.example.json`，仅含前三个模块，留给第四个人实际生成输出，不预置第四人的答案。它不包含数据集标签、真值掩码或来源清单。

VLM 调用层根据 `artifactId` 加载实际图片。JSON 文件中的路径或编号不会自动变成模型可以看到的图像。可按任务选择原图、规范显示图、局部裁剪和掩码，并保留附件类型标签。

本轮的 `manifest.tsv` 保存样本类别、来源、原文件哈希和真值附件引用；`annotations/` 保存数据集原生掩码。这两部分只用于核对样例或离线评测，不进入 VLM 上下文，也不能冒充检测器输出。

## 7. 第一阶段接入顺序

用这些样例校验报告解析、附件加载和 VLM 输入组织。模块报告保持独立；公共汇总器将报告组成不可变快照，后续模块应向 `bundle.json` 的约定结构提供报告，不应修改其他模块实现。

本次新增脚本只准备并校验样例，不调用模型、不生成检测结论，也不代表 APP 已完成四模块接入。

## 8. 必须保持的边界

文件 SHA256、图片尺寸和副本变换是实际测量；来源检查、分类分数、模拟定位矩形和模板解释不应混成同等可靠的证据。模拟报告必须保留标记，即使使用的原图来自真实数据集。

第一阶段联调允许失败、不支持和信息缺失；这些状态应完整传递，不能用“真实”或 0 分替代。
