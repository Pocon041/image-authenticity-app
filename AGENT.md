# SRDP 项目开发约定

本文件维护四人共用的框架、接口、报告协议和协作约定。模块独有实现、测试与工作记录维护在各自分支的 `AGENTS.md`；共享内容对照 `main` 增量合并，不整份替换他人记录。用户的新要求优先于本文件已有约定。

## 1. 仓库与协作规则

- GitHub 仓库名：`image-authenticity-app`；中文项目名称：图像真实性分析桌面应用。
- 本地开发目录保留 `D:\SRDP`。
- 远程仓库：`https://github.com/Pocon041/image-authenticity-app`；主分支：`main`。
- 公共可运行版本维护在 `main`，各模块在自己的分支开发。
- 用户于 2026-10-29 授权将已验证的 `czh` 功能更新发布到 `main`；整合时保留其他成员更新，排除第二人专用 `AGENTS.md`，遇到冲突先告知用户并等待确认。
- 提交云端或发布前按用户要求先询问/确认；不擅自改写他人关键逻辑。
- 历史授权、已失效状态和模块详细验证记录统一折叠到“历史沿革”或模块文档，不继续堆入“当前状态”。

## 2. 项目目标与当前范围

开发基于本地推理的图像真实性分析桌面 APP。本项目侧重工程集成，不开发视觉取证算法。

当前为 v0.2.0 源码开发版：

- 选择本地图片 → 内容类型路由 → FSD AIGC 初步判断 → SICA 整图筛查与 RITA/RiSE 定位 → 简明 JSON 和完整证据包。
- 默认入口为联合分析；详细模型诊断折叠或留内部文件；HiFi-Net 不进入联合路由，运行入口已移除。
- 内容路由：普通照片运行 SICA + RITA；文档/票据截图运行 SICA + RiSE；不确定时按顺序运行 SICA + RITA + RiSE。
- 联合流程中 SICA 不作为定位硬门控；单模型失败不阻断后续模型，允许部分完成并保留错误。
- 模拟模式仅保留作工程验证，必须明确标记，不能冒充真实推理。
- 本阶段不训练模型、不接入 VLM 或远程推理服务。
- 来源模块仅获准使用 OCR 匹配可见水印文字，不扩展为第四阶段的通用内容 OCR 分析。
- FSD 为第三人 AIGC 初步接入，许可仅支持非商业用途；2026-10-29 最新授权后，联合流程先运行 FSD，再执行 SICA 整图筛查及 RITA/RiSE 定位。早期“FSD 不进入默认联合路由”为历史状态。
- 缺少权重时不得伪造真实报告或静默回退模拟。

## 3. 最新有效授权摘要

- RITA：允许预训练推理接入验证和独立本地真实推理路径；模拟模式继续保留；不训练新模型、不接 VLM。缺少权重必须明确报错。
- SICA：允许真实二分类接入及 CASIA v2 检查；允许独立 SICA 路径；仍不训练、不接 VLM。
- RiSE：用户提供 RiSE-9 RGB 权重并要求测试及接入 APP；允许新增独立 RiSE 本地定位模式和必要依赖；OCR 证据与 VLM 仍留给第四阶段。
- 联合工作流与 UI：批准联合工作流与 UI 新版本；界面简洁易用，JSON 有价值且不繁琐；HiFi 不进入联合路由。
- 第一人来源/预处理：在 `yht` 上完成 v0.1.0，包含图像规范化、EXIF/XMP/IPTC、C2PA、可见水印及可行的隐形水印；水印 OCR 限图库/水印文字候选，不转为通用 OCR/VLM。
- FSD：允许独立本地 AIGC 分析入口，并按最新授权进入联合流程先运行；来源归因可开启，原始标签与分数保留供审计；不训练、不接 VLM。
- 2026-10-29：授权将已验证 `czh` 功能发布到 `main`；整合版本已通过生产构建、工作流测试、协议测试和实际 `start.cmd` 启动检查；本轮未重跑模型准确率评测。

## 4. 架构与安全边界

- Electron 主进程：本地文件选择、图片检查、分析服务调用和应用生命周期。
- React + TypeScript 渲染进程：中文界面、预览、交互和结果展示。
- preload：通过 `contextBridge` 暴露最小范围的类型化 IPC 接口。
- 分析服务：统一接口隔离模拟、SICA、RITA、RiSE、FSD 适配器与联合调度，串行管理 GPU 子进程。
- `AnalysisSession` 管理当前图片、互斥任务和取消；模拟服务经回调报告任务进度。
- 主进程保留原始文件路径和原始字节快照；界面只接收预览 DTO。界面组件与 `useAnalysisWorkspace` 交互状态分开。
- 跨进程调用统一使用结果响应与稳定错误代码；进度携带任务 ID；监听器必须可取消订阅。
- Python 侧使用 `backend/rita/`、`sica/`、`rise/` 单图子进程；`backend/common/` 保存共享离线评测工具；不再保留 HiFi-Net 运行代码。
- 渲染进程禁止直接访问 Node.js、文件系统或任意 IPC。启用 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`。
- “打开报告文件夹”只允许打开当前最近任务的受控 `analysis-runs` 目录，不接收任意路径。

## 5. 目录职责

- `src/main/`：桌面主进程、文件导入和分析服务。
- `src/preload/`：桌面桥接白名单。
- `src/renderer/`：React 工作台与样式。
- `src/shared/`：跨进程数据协议。
- `src/shared/protocol.ts`：协议 v1.0 类型定义，对应 `schemas/report-bundle.schema.json`；四人报告交换共用。
- `src/shared/contracts.ts`：现有 UI 类型，与 `protocol.ts` 互相独立，通过 adapter 连接。
- `docs/REPORT_PROTOCOL_V1.md`：第一阶段四人报告协议初稿；公共字段和坐标含义不能由单模块自行改变。
- `docs/PROVENANCE_V01.md`：第一人来源报告结构、字段、安装和检测边界。
- `backend/provenance/`：EXIF/C2PA 解析及水印子进程，不共享或更改其他模型后端。
- `schemas/`：JSON Schema，模块报告与 VLM 证据包共用同一份字段定义。
- `examples/USAGE.md`、`examples/sample-selection.example.json`：样例使用说明与选择模板。
- `examples/stage1-materials/`、`examples/local-selection.json`：第一阶段材料包与实际选择清单，Git 忽略，不自动公开发布。
- `tests/`：真实 Electron 窗口的端到端 Smoke 验证。
- `scripts/`：运行时检查和安装；Windows 从官方发布地址下载 Electron，并按 npm 包提供的 SHA256 校验。
- `backend/rita/`：RITA 单图执行、掩码解码和测试；`config/rita.example.json` 为共享配置模板，`config/rita.local.json` 为 Git 忽略的本机配置。
- `weights/rita/rita_catnet.pth`：用户从官方分享下载的权重，整个 `weights/` 不提交 Git。
- `.tools/rita-upstream/rita.py`：下载并校验的固定版本源码，不随本项目仓库重新分发。
- `.tools/`：可选的项目本地 Node/Python 隔离环境，不提交。
- `work/`：生成的测试图、截图和临时文件，不提交。
- `out/`、`dist/`：构建产物，不提交。

## 6. 开发与验证

Windows 启动入口为 `start.cmd`；`run.cmd` 负责优先使用 `.tools/` 下的 Node。

- `run.cmd install`：首次安装依赖；有锁文件时优先用 `run.cmd ci`。
- `run.cmd run dev`：启动开发桌面窗口。
- `run.cmd run typecheck`：TypeScript 检查。
- `run.cmd run build`：构建主进程、preload 和渲染进程。
- `run.cmd run smoke`：构建并运行真实 Electron 端到端测试。
- `run.cmd run smoke:dev`：在本机 Vite 开发服务上验证相同的桌面交互。
- `run.cmd run smoke:startup`：实际调用 `start.cmd`，验证 npm 生命周期、electron-vite 和桌面界面。
- `run.cmd run runtime:ensure`：检查 Electron 可执行文件、版本与 `path.txt`，缺失时安装；`predev` 和 `prestart` 自动调用。
- `run.cmd run runtime:ensure -- --repair`：重新校验下载包并修复运行时，优先复用缓存。
- `run.cmd run package:dir`：生成 Windows 可直接运行的应用目录。
- `run.cmd run smoke:packaged`：打包并对 `dist/win-unpacked/SRDP.exe` 执行相同的 Smoke 验证。
- `run.cmd run format` / `format:check`：统一源码与文档格式。
- `run.cmd run examples:prepare`：按类型选择清单准备材料，默认输出 `examples/stage1-materials/`。
- `run.cmd run examples:validate`：校验全部材料的哈希、显示像素、标注尺寸，以及唯一 JSON 的 Schema 和证据引用；也支持 `-- --bundle <path>` 校验单个包。
- `run.cmd run rita:setup`：下载并校验固定官方模型源码；不下载权重、不训练。
- `run.cmd run rita:infer -- --image <path>`：按本机配置执行单图，结果保存到 `work/rita-cli/`。
- `run.cmd run smoke:rita`：真实 Electron 下验证独立 RITA 入口、缺失权重报错及模拟模式隔离。
- `run.cmd run smoke:rita:real`：已有本机配置和官方权重后验证真实推理、掩码展示、报告及实际子进程取消。
- `<配置的Python> -m unittest discover -s backend/rita -p test_*.py`：验证控制类别、几何、分数汇总和严格加载拒绝路径。
- `run.cmd run sica:setup`：准备并校验固定 SICA/CLIP 源码，不自动下载权重。
- `run.cmd run sica:infer -- --image <path>`：使用本机 `config/sica.local.json` 执行真实二分类，写出 v1.0 单模块证据包。
- `run.cmd run smoke:sica`：真实 Electron 中验证完整分类、缺权重、模式隔离和实际子进程取消。
- `run.cmd run rise:setup` / `rise:infer` / `smoke:rise`：RiSE 源码准备、真实单图与桌面检查。
- `run.cmd run provenance:setup`：在项目统一的 `.venv` 安装 C2PA、图像元数据、RapidOCR 与水印检测依赖。
- `run.cmd run test:workflow` / `smoke:workflow`：联合编排逻辑与真实桌面流程检查。
- `run.cmd run report:validate -- <analysis.json>`：简明报告 Schema、身份、相对路径与引用校验。
- `<配置的Python> backend/sica/evaluate.py --casia-root <划分清单目录> --output <目录>`：只读运行本地 CASIA 子集，阈值固定 0.5，记录每图预测和分组统计，不声称独立泛化。
- FSD 相关 worker、配置与验证入口见 `docs/AIGC_FSD.md`。

使用 `package-lock.json` 固定依赖。需要 Node 22.12+，推荐 Node 24 LTS。不要修改系统 Node 来满足本项目。

修改跨进程协议或核心交互后执行类型检查和主流程 Smoke 测试。Smoke 测试只模拟文件选择对话框，实际文件读取、解码、IPC、模拟分析和 React 展示均走真实应用路径。

Electron 45 延迟下载导致首次启动出现 `Electron uninstall` 的修复已完成；`predev` / `prestart` 安装钩子、官方包 SHA256 校验、缓存和修复命令保留。

## 7. 报告、坐标与样例约定

- 协议 v1.0 以原始文件完整 SHA256 构造 `imageId`。规范坐标基准是 EXIF 校正方向、sRGB、未缩放的显示副本；bbox 为整数像素 XYWH、左上原点、半开区间。
- 原文件保持原字节；预览、显示副本和模型输入分开管理。模型输出必须映射回规范显示坐标。
- 模块独立提交不可变报告，公共汇总器合并；模拟标记逐报告保存。VLM 输入仅含前三个模块，不包含预置的解释答案。
- 模拟矩形、模拟分数与真实文件哈希、尺寸分别标记。数据集真值与类别放独立文件，不进入 VLM 证据包。
- 数据集示例只作联调，不作为效果证明；来源报告逐个保留凭证和水印子检查的未运行/失败状态。
- 材料优先覆盖种类、每类少量取样，只交付一份给第四人的示例 JSON。数据目录仅保留 `vlm-input.example.json`；其余来源、类别和标注关系使用 `manifest.tsv`。Schema JSON 属于协议定义，不是额外样例报告。
- 本地 IMD2020 已核对为 Yu2018 生成式修复子集，不能宣传覆盖完整 IMD2020。真值掩码是原生 JPEG，应与模拟预测掩码分别标记。
- 当前 APP 图片 ID 使用原始字节 SHA256，重复导入保持一致；主进程保留原始字节快照。
- `bundle.json` 含独立 `manipulation` 和 `provenance` 报告；`analysis.json` 是简明篡改视图，不是 `EvidenceBundle`。
- 正式引用的 `reportId` / `evidenceId` 沿用完整包，按 `moduleId` 读取，不依赖报告排列顺序；交接见 `docs/EXPLANATION_HANDOFF.md`。
- 共用校验复用 Schema，校验 `status` / `result` / `error` 和 confidence 来源/校准状态；`validateExplanationReport(report)` 只校验结构，显式传入上游数组才校验引用，`[]` 不等于省略。引用校验不证明解释正确；当前未接入 VLM 或生成解释占位结果。
- 来源依赖在项目统一 `.venv` 安装；可见水印 OCR 只提供中英文关键词候选，SDXL 载荷仅覆盖公开固定配置。缺少元数据/凭证/水印不证明真假，未运行/失败状态不能写成未检出。

## 8. 当前状态摘要

### 已实现

- v0.2.0 统一入口、照片/文档/不确定三种内容路由、串行模型调度、补充定位复用与部分失败处理。
- 默认主报告为简明 `analysis.json`，完整 v1.0 证据包保留；公共任务目录为 `work/analysis-runs/<taskId>`。
- 桌面框架、类型化 IPC、图片导入和模板分析主流程已建立；界面组件、任务状态、主进程 IPC 路由与分析会话已拆分，具备进度、取消和主进程图片释放能力。
- 使用 `sharp` 做实际图片解码、EXIF 方向校正及最大边长 1800 像素的预览，不修改原始文件。
- README 已按 `image-authenticity-app` 重写，包含结构、协作边界、启动命令、从基础版增量升级步骤和后续接入位置。
- 第一阶段报告协议 v1.0 初稿、共享 JSON Schema、样例生成与校验脚本已补齐。
- 第一阶段材料已整理 12 张原文件，三份原生标注单独保存，唯一 `vlm-input.example.json` 面向 IMD2020 修复样本；材料通过文件级校验。
- 第四人解释模块已接入：提供 `generateExplanation` 服务，消费前三人证据包，支持本地 Ollama VLM（JSON Schema 约束）生成智能解释，并在 VLM 调用失败时降级为规则模板兜底；已打通 IPC 通道与前端界面展示。
- SICA 独立二分类模式、RITA 独立定位模式、RiSE-9 RGB 独立文档定位模式、FSD 独立 AIGC 分析入口均已接入；HiFi-Net 运行入口已移除，不参与联合流程。
- 联合流程已加入 FSD：在 SICA 整图筛查及 RITA/RiSE 定位前先运行 FSD；其判断、z-score、阈值、来源线索状态写入联合简明 JSON 和完整报告，界面先显示 AIGC 结果。
- 第一人来源模块 v0.1.0：完整联合包增加 `provenance` 报告及独立 `reports/provenance.json`；记录原文件 SHA-256、显示副本、EXIF/XMP/IPTC/GPS 摘要、C2PA 活动清单与签名验证状态、可见水印候选和 SDXL 固定 48 位 DWT-DCT 载荷。
- `provenance:setup` 使用项目统一 `.venv`，安装 C2PA 0.38.0、RapidOCR 3.10.0、ONNX Runtime 1.31.1、OpenCV headless 4.14.0.94、PyWavelets 1.10.0 和 invisible-watermark 0.2.0。
- 来源检查界面展示 C2PA `claim_generator_info.name`；旧报告回退展示 `claim_generator`。图片工作区“图像预览”支持大图查看、点击遮罩或 Esc 关闭。
- main 已整合已验证 `czh` 功能；整合版本通过生产构建（含类型检查）、9 组工作流测试、6 组协议测试，以及实际 `start.cmd` 启动 3 项检查。本轮未重跑模型准确率评测。
- 本地 `czh` 已包含远端 `main` 截至 `e1e59b4` 的 `yht` 来源模块，同时保留第四人的 `protocol.ts` 类型与本地共用校验适配。

### 实际验证摘要

- v0.2.0 联合流程：9 组编排测试、8 组真实 Electron 联合 Smoke、1400/1060 布局回归、默认 `start.cmd` 启动 3 项通过；报告 Schema、哈希、规范坐标、裁剪像素、相对路径和证据引用均通过校验。
- RITA：真实 Electron Smoke 6 项、Python 后处理与负向加载 7 项通过；本地 CASIA 479 张（96 真实 / 383 篡改）定位正类像素 F1=0.69467、IoU=0.61592、AUC=0.93300；拼接 F1=0.89959/AUC=0.99487，复制移动 F1=0.58938/AUC=0.90121；96 张真实图平均预测面积 14.80%；RITA 分数诊断 AUROC=0.46978，不能作为图像级分类器。
- SICA：真实 Electron Smoke 6 项通过；本地 CASIA 可用子集 479 张（96 真实、383 篡改），阈值固定 0.5：TP=307、TN=87、FP=9、FN=76；ACC=82.25%、balanced ACC=85.39%、Precision=97.15%、Recall=80.16%、F1=87.84%、AUROC=0.92390；拼接检出 118/130（90.77%），复制移动 189/253（74.70%）。该结果不是完整 CASIA v2，也不是独立泛化证明。
- RiSE：RiSE-9 RGB 真实权重 868 项 strict=True 加载；两张用户样例均在已知修改位置产生最大连通区域，真实 Electron Smoke 7 组通过；额外标记仍存在，不构成正式质量验收。
- FSD：固定上游提交，Python 3.13 隔离环境及推理依赖已准备；检测权重缓存完整，worker 已对 `sample-001` 实际执行成功（z-score `-2.6559`、默认阈值 `-2.0`，按 FSD 规则判为 `ai_generated`）；来源归因缓存长度校验与 HTTP Range 续传已加入，模型加载及真实图片推理通过。项目数据上的效果验证未做，联合流程真实 Smoke 尚待验证。
- Provenance：Python 语法编译、7 项 provenance 合成像素/词表测试、C2PA/Pillow 来源读取、8 项 C2PA 容器、EXIF/XMP/IPTC 元数据、3 项水印元数据检查及 TypeScript 检查通过。真实图片上的检出准确率/鲁棒性尚未验收；发布包尚未封装 Python 运行时。
- 既有模拟主流程、RITA 入口、SICA、RiSE 和联合流程 Smoke 已做过回归；具体项数和历史结果见对应模块文档/工作记录。

### 已知限制

- 尚无校准整图阈值时 `decision=inconclusive`；响应分数、距离、LPC confidence 等均不能冒充校准概率。
- SICA 的 `fake` 不等同局部篡改；RITA 真实图误报面积较高，图像级分类弱；RiSE 文档样例有额外标记，质量未验收；FSD 联合流程 Smoke 与项目数据效果验证未完成。
- HiFi-Net 已移除运行入口，不参与当前联合流程；历史评测仅作归档。
- 来源限制：OCR 线索不能证明文本是水印；当前 OCR 可能误报正文或装饰字，也可能漏掉不可识别内容；词表不穷尽所有服务，视觉特征不证明生成来源。SDXL 固定载荷可能被伪造，压缩/缩放/裁剪可造成漏检，超过 1200 万像素标为未运行；不支持 SynthID 和通用隐形水印。无元数据不推断被剥离；无 C2PA 标记不排除外部凭证；签名/本地信任状态不等于内容真实。
- 发布包 Python/权重分发、CPU 性能、整图阈值、大规模独立文档质量验收仍未完成；Windows 应用目录曾生成，但打包后隐藏窗口截图步骤曾超时，尚未通过发布验收。
- 当前优先搭建并跑通大框架；具体 Bug、打包截图和交付细节先记录，后续独立安排真实能力与发布验收。

## 9. 模块文档与交接入口

- 报告协议：`docs/REPORT_PROTOCOL_V1.md`
- 来源模块：`docs/PROVENANCE_V01.md`
- SICA：`docs/SICA_INTEGRATION.md`
- RiSE：`docs/RISE_INTEGRATION.md`、`docs/RISE_EVALUATION.md`
- FSD：`docs/AIGC_FSD.md`
- 联合工作流：`docs/WORKFLOW_V02.md`、`docs/MANIPULATION_WORKFLOW.md`
- 第四人交接：`docs/EXPLANATION_HANDOFF.md`
- HiFi 历史：`docs/HIFI_EVALUATION.md`（历史状态，不参与当前联合流程）
- RITA 详细接入与评测记录：见第二人分支 `AGENTS.md` 及现有工作记录；共用文件只保留当前摘要。

## 10. 历史沿革与已失效内容

以下仅保留入口和一行式状态，详细记录不再写入共用“当前状态”：

- HiFi-Net：曾完成 general 750001 与 loc 225000 测试和独立定位模式接入；后已移除前后端运行入口、`backend/hifi` 源码、配置模板、CLI、测试和过时接入说明。历史评测见 `docs/HIFI_EVALUATION.md`。HiFi general 750001 与 loc 225000 不可混用。
- RITA：早期“5 张联调图”观察已被 479 张全量观察修正；当前结论以第 8 节和模块记录为准。
- SICA：固定源码 SHA256 期望值曾与上游锁定提交实际文件不符，已按实际下载核对并更新 setup 脚本；详见 `docs/SICA_INTEGRATION.md`。
- README：此前“暂不更新 README”的约定已被 2026-10-28 更新授权取代，README 已更新。
- FSD：早期“不进入默认联合路由”为历史状态；2026-10-29 最新授权改为联合流程先运行 FSD，详见 `docs/AIGC_FSD.md`。
- 模拟基础框架：首次双击启动 `Electron uninstall` 修复、旧 15 项模拟 Smoke、旧打包截图超时、临时 scaffold/probe/UI 重写脚本、临时 worktree 和代理重试等，不再列入共用当前状态，详见对应工作记录。
- 2026-10-29 main 整合：以最新 `origin/main` 建立整合分支，补丁检查和应用无冲突，无文件删除；`main` 根目录 `AGENTS.md` 与整合前一致，未整体合并第二人个人记录。

## 11. 维护要求

- 本文件只维护四人共用的框架、接口、报告协议和协作约定；模块独有实现、测试与工作记录维护在各自分支 `AGENTS.md`。
- 每次交付前更新“当前状态”，记录已实现内容、实际验证结果和已知限制，不将计划记为完成。
- 共享内容对照 `main` 增量合并，不整份替换他人记录。
- 新要求优先于本文件已有约定；被新要求取代的旧条目折叠到“历史沿革”，不继续堆入当前状态。
- 涉及跨进程协议、核心交互、报告字段或坐标含义的变更，必须执行类型检查和主流程 Smoke 测试，并先告知用户。
- 遇到合并冲突、需要改写其他成员关键逻辑、或需要发布到 `main` 时，先告知用户并等待确认。