# 项目共用约定

项目：image-authenticity-app（图像真实性分析桌面应用）。本机目录 `D:\SRDP`；仓库 `https://github.com/Pocon041/image-authenticity-app`。

## 文档分工与维护

- `AGENT.md`：四人共用的目标、协作边界、接口、报告协议、坐标、共享架构与联调状态。
- `AGENTS.md`：每个模块个人维护的状态。

## 项目目标和四人职责

本项目侧重本地推理桌面APP工程集成，不开发或训练视觉取证新算法。

1. 来源与预处理：保留原文件，建立规范副本与图片身份，分析元数据、凭证、水印。
2. 篡改模块：视觉篡改筛查、像素定位、模型可追溯的结构化证据和APP接入；当前基线为SICA/RITA/RiSE。
3. AIGC模块：图像级AI生成检测与方法实际支持的线索。
4. 综合解释：消费前三人证据与实际图片，负责OCR内容分析、VLM最终判断和有证据引用的自然语言输出。

第二阶段的视频、统一路由与对话功能属于后续计划。模拟结果必须逐报告标记，模型缺失或失败不能静默回退模拟，不虚构未执行模块结果。

## 共享架构

- Electron主进程管理文件、IPC、任务、子进程和附件；React渲染进程只通过preload类型化白名单调用功能，不直接读取文件或执行Python。
- 保持contextIsolation与sandbox开启、nodeIntegration关闭。进度带taskId/imageId，支持任务互斥、取消和监听释放。
- `src/shared/contracts.ts` 是APP界面DTO，`src/shared/protocol.ts` 是四人正式报告交换类型，二者通过主进程适配。
- `schemas/report-bundle.schema.json` 是v1.0标准证据包定义；`schemas/module-report.schema.json`引用同一报告定义，不存在schemas/bundle.schema.json。
- `schemas/manipulation-summary.schema.json` 定义第二人精简视图analysis.json；它不是EvidenceBundle，完整身份/证据引用以bundle.json为准。
- 依赖、源码、权重准备见README；成员可使用不同数据/环境/权重路径，本机配置不覆盖共享模板，不把个人盘符强制给其他成员。

## 图片身份、坐标与附件

- 原文件按原始字节只读使用/复制。完整SHA256生成 `imageId=sha256:<hash>`，同一原文件重复导入身份一致。
- 规范显示副本：EXIF方向校正、sRGB PNG、不缩放。公共坐标为 `display_image_pixels`；界面缩略图不是坐标基准。
- `bboxXYWH=[x,y,width,height]`：左上原点，整数像素，半开区间，宽高大于0且不越界。
- 原始编码尺寸单独保存；模型缩放/裁剪/填充自行记录并映射回规范坐标。
- 掩码为全尺寸8位PNG，0未标记、255标记；响应值不默认是概率。裁剪带规范图上的bbox，像素应对应原图内容。
- 附件URI相对于任务/证据包目录，用/分隔，不含绝对路径或..；artifactId唯一，记录哈希与父附件。
- 图片、权重、数据、本机配置、work、外部源码、node_modules、构建产物不提交Git；真实数据/原生GT不自动公开发布。

## 报告与解释引用

- 四模块固定为provenance/manipulation/aigc/explanation，每次生成不可变报告，公共汇总器组合快照，成员不轮流修改一个JSON。
- schemaVersion、reportId、imageId、taskId、mode、status、producer、createdAt、elapsedMs、inputReportIds、result、evidence、artifacts、limitations、error含义一致。
- completed表示执行结束，不表示结论正确；failed/unsupported/not_run与未检出分开。失败或未执行项目不填0分或“真实”。
- 公共字段删除、改名或改变语义需协调并升级协议；模块可扩展result/extensions，不擅改共用字段。
- explanation引用实际使用的inputReportIds；claims的非空evidenceIds来自这些上游报告。imageId一致，保持已有ID，不引用包外内部诊断报告ID。
- confidence区分unavailable、vlm_self_assessment、calibrated_fusion；VLM自评或像素响应不标为已校准。结构/引用校验不证明解释事实正确。
- 模拟与真实来源逐报告保留；解释中说明模拟证据。数据集标签、GT、来源清单和离线F1/AUC不作为待测图片证据输入。
- VLM适配层按artifactId实际加载原图/裁剪/掩码，并标注图片类型；JSON路径本身不会成为视觉输入。

## 共享开发和验证

Windows从start.cmd启动源码APP；run.cmd优先使用可选本地Node，否则系统Node。最低Node22.12，推荐24LTS。不要为项目修改系统Node或覆盖其他成员Python环境。

- `run.cmd ci` / `run.cmd run dev`：依赖安装与开发启动。
- `run.cmd run typecheck` / `build`：跨模块类型与构建检查。
- `run.cmd run smoke:startup` / `smoke`：真实启动与模拟工程主流程。
- `run.cmd run test:protocol`：共用协议及解释引用验证。
- 各模块质量与模型测试由对应模块说明维护，Smoke不能替代准确率验收。

修改共享IPC/类型或核心交互后检查类型与相关主流程。测试使用的软件渲染选项不应关闭sandbox，不把临时测试参数改为用户运行默认参数。

## 当前联调状态（2026-10-28）

- v0.2.0本地视觉工作流可运行，默认输出analysis.json和标准bundle.json；来源/AIGC/解释后端尚未统一接入。模块详细验证移至AGENTS.md。
- 第一阶段材料包按类型少量准备，唯一的vlm-input.example.json为显式模拟联调输入；实际数据及GT继续Git忽略，成员自行配置数据路径。
- 已拉取并合并yr_explanation截至 `e2793d5`（上游先合并czh的e435a03）；实际新增protocol.ts与共用记录，无generateExplanation/VLM/解释UI。保留第二人既有检测能力与本机配置。
- 共用类型与现有Schema名称已对齐；运行时使用同一Schema校验报告结构、confidence联动及引用。`validateExplanationReport(report)`只做结构检查，显式传上游数组才解析引用，空数组不等于省略。
- 交接方式见 `docs/EXPLANATION_HANDOFF.md`。已有真实检测包与明确标注的测试解释引用兼容，不代表已运行VLM。
- 本轮7组协议兼容检查通过，覆盖畸形输入、confidence联动、空/缺失/跨图引用和既有真实输出的证据ID衔接。未改变公共JSON字段或新增解释占位结果；本地整合到czh，原yr_explanation分支不改写。

## Git协作

共享整合目标为czh，main不直接修改。模块在独立分支开发，先合并并验证再更新整合分支；不强推或覆盖他人未提交修改。
README说明基础版到当前源码版本的增量升级；发布包Python/权重分发尚未验收。远端第三方分支的功能以实际代码为准，不依据分支名称宣称已完成模型能力。

## 第四人借鉴 FakeShield 的边界（2026-10-28）

- 用户询问FakeShield思路能否用于第四人。本轮复核官方README与scripts/cli_demo.sh：原生DTE-FDM+DTG处理图片并生成解释，MFLM消费解释输出定位；官方入口没有直接接收我方analysis.json的现成接口。仅核对，不下载/接入或训练。
- 可以借鉴其领域提示、图像观察和解释组织思路；现有四人框架宜由前三人的报告、原图/候选裁剪及标记清楚的模型掩码约束第四人的解释，不必重新运行完整MFLM定位。该适配不等于复现FakeShield，也不保证通用VLM通过提示即可获得其训练能力。
- 第四人输出按claims引用evidenceId，区分模型检测证据、自身视觉观察和推测；保留冲突与未解决项。ID/格式校验只能保证可追溯，不能证明陈述正确。文档文字替换/擦除泛化和8GB本地部署均需实测，不凭公开权重或包名承诺。
