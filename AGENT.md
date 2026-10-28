# SRDP 项目开发约定

GitHub 仓库名采用 `image-authenticity-app`，中文项目名称为“图像真实性分析桌面应用”。本地开发目录保留 `D:\SRDP`。
远程仓库为 `https://github.com/Pocon041/image-authenticity-app`，主分支为 `main`。
当前协议和联调工具的共享变更按用户要求在 `czh` 分支维护并推送，不直接修改远端 `main`。后续各模块的开发人员应创建独自的分支并提交

## 项目目标与当前范围

开发基于本地推理的图像真实性分析桌面 APP。本项目侧重工程集成，不开发视觉取证算法。

当前为v0.2.0源码开发版：选择本地图片 → 内容类型路由 → SICA整图筛查与RITA/RiSE定位 → 简明JSON和完整证据包。模拟模式仅保留作工程验证，必须明确标记，不能冒充真实推理。
本阶段不训练模型，不接入OCR、VLM或远程推理服务。以下阶段授权记录为历史沿革，新要求与下方最新交付记录优先。

阶段更新：用户现已授权开始第二人模块的 RITA 预训练推理接入验证，允许独立的本地真实推理路径；原模拟模式继续保留。没有授权训练新模型或接入 VLM。缺少权重时不得伪造真实报告或静默回退模拟。
后续授权更新：用户提供 SICA 权重并要求真实二分类接入及 CASIA v2 检查；允许独立 SICA 路径，仍不训练、不接入 VLM。仅下载 HiFi-Net 文件不代表已经接入该模型。
后续授权更新（2026-10-28）：用户提供 RiSE-9 RGB 权重并明确要求测试及接入 APP，允许新增独立 RiSE 本地定位模式和必要依赖；OCR 证据与 VLM 仍留给第四阶段，不训练新模型。
后续授权更新（2026-10-28）：用户批准联合工作流与UI新版本实现，并要求界面简洁易用、JSON有价值且不繁琐。当前默认入口为联合分析，详细模型诊断折叠/留内部文件；HiFi不进入联合路由。

## 维护要求

- 本文件是项目约定的唯一正文。每次改变框架、目录、运行命令、接口或阶段范围时，同步更新本文件。
- 每次交付前更新“当前状态”，记录已实现内容、实际验证结果和已知限制，不将计划记为完成。
- 用户的新要求优先于这里已有的约定。

## 架构

- Electron 主进程：本地文件选择、图片检查、分析服务调用和应用生命周期。
- React + TypeScript 渲染进程：中文界面、预览、交互和结果展示。
- preload：通过 contextBridge 暴露最小范围的类型化 IPC 接口。
- 分析服务：统一接口隔离模拟、SICA、RITA、RiSE适配器与联合调度，串行管理GPU子进程。
- `AnalysisSession` 管理当前图片、互斥任务和取消；模拟服务经回调报告任务进度。
- 主进程保留原始文件路径，界面只接收预览 DTO。界面组件与 `useAnalysisWorkspace` 交互状态分开。
- 跨进程调用统一使用结果响应与稳定错误代码，进度携带任务 ID，监听器必须可取消订阅。
- Python侧使用 `backend/rita/`、`sica/`、`rise/` 单图子进程；`backend/common/` 保存共享离线评测工具，不再保留HiFi-Net运行代码。
- 渲染进程禁止直接访问 Node.js、文件系统或任意 IPC。启用 contextIsolation 和 sandbox，关闭 nodeIntegration。

## 目录职责

- `src/main/`：桌面主进程、文件导入和分析服务。
- `src/preload/`：桌面桥接白名单。
- `src/renderer/`：React 工作台与样式。
- `src/shared/`：跨进程数据协议。
- `docs/REPORT_PROTOCOL_V1.md`：第一阶段四人报告协议初稿；公共字段和坐标含义不能由单模块自行改变。
- `schemas/`：JSON Schema，模块报告与 VLM 证据包共用同一份字段定义。
- `examples/USAGE.md`、`examples/sample-selection.example.json`：独立的样例使用说明与选择模板。
- `examples/stage1-materials/`、`examples/local-selection.json`：第一阶段材料包与实际选择清单，Git 忽略，不自动公开发布。`examples/local-data/` 为先前中间样例，不作为本轮交付目录。
- `tests/`：真实 Electron 窗口的端到端 Smoke 验证。
- `scripts/`：运行时检查和安装；Windows 从官方发布地址下载 Electron，并按 npm 包提供的 SHA256 校验。
- `backend/rita/`：RITA 单图执行、掩码解码和测试；`config/rita.example.json` 为共享配置模板，`config/rita.local.json` 为 Git 忽略的本机配置。
- `weights/rita/rita_catnet.pth`：用户从官方分享下载的权重，整个 `weights/` 不提交 Git。
- `.tools/rita-upstream/rita.py`：下载并校验的固定版本源码，不随本项目仓库重新分发。
- `.tools/`：可选的项目本地 Node 环境，不提交。
- `work/`：生成的测试图、截图和临时文件，不提交。
- `out/`、`dist/`：构建产物，不提交。

## 开发与验证

Windows 启动入口为 `start.cmd`；`run.cmd` 负责优先使用 `.tools/` 下的 Node。

- `run.cmd install`：首次安装依赖；有锁文件时优先用 `run.cmd ci`。
- `run.cmd run dev`：启动开发桌面窗口。
- `run.cmd run typecheck`：TypeScript 检查。
- `run.cmd run build`：构建主进程、preload 和渲染进程。
- `run.cmd run smoke`：构建并运行真实 Electron 端到端测试。
- `run.cmd run smoke:dev`：在本机 Vite 开发服务上验证相同的桌面交互。
- `run.cmd run smoke:startup`：实际调用 `start.cmd`，验证 npm 生命周期、electron-vite 和桌面界面；不以 Playwright 直接启动 Electron 来替代。
- `run.cmd run runtime:ensure`：检查 Electron 可执行文件、版本与 `path.txt`，缺失时安装；`predev` 和 `prestart` 自动调用。
- `run.cmd run runtime:ensure -- --repair`：重新校验下载包并修复运行时，优先复用缓存；安装子进程使用 Windows 自带 PowerShell 模块路径。
- `run.cmd run package:dir`：生成 Windows 可直接运行的应用目录。
- `run.cmd run smoke:packaged`：打包并对 `dist/win-unpacked/SRDP.exe` 执行相同的 Smoke 验证。
- `run.cmd run format` / `format:check`：统一源码与文档格式。
- `run.cmd run examples:prepare`：按类型选择清单准备材料，默认输出 `examples/stage1-materials/`；每类少量原文件、规范显示图、原生标注、TSV 清单，以及一份给第四人的 VLM JSON。不修改源数据集、不调用模型。
- `run.cmd run examples:validate`：校验全部材料的哈希、显示像素、标注尺寸，以及唯一 JSON 的 Schema 和证据引用；也支持 `-- --bundle <path>` 校验单个包。
- `run.cmd run rita:setup`：下载并校验固定官方模型源码；不下载权重、不训练。
- `run.cmd run rita:infer -- --image <path>`：按本机配置执行单图，结果保存到 `work/rita-cli/`。
- `run.cmd run smoke:rita`：真实 Electron 下验证独立 RITA 入口、缺失权重报错及模拟模式隔离。
- `run.cmd run smoke:rita:real`：已有本机配置和官方权重后验证真实推理、掩码展示、报告及实际子进程取消；默认使用本地材料的 CASIA 拼接样例，可用 `-- --image <path>` 更换。
- `<配置的Python> -m unittest discover -s backend/rita -p test_*.py`：验证控制类别、几何、分数汇总和严格加载拒绝路径。
- `run.cmd run sica:setup`：准备并校验固定 SICA/CLIP 源码，不自动下载权重。
- `run.cmd run sica:infer -- --image <path>`：使用本机 `config/sica.local.json` 执行真实二分类，写出 v1.0 单模块证据包。
- `run.cmd run smoke:sica`：真实 Electron 中验证完整分类、缺权重、模式隔离和实际子进程取消。
- `run.cmd run rise:setup` / `rise:infer` / `smoke:rise`：RiSE源码准备、真实单图与桌面检查。
- `run.cmd run test:workflow` / `smoke:workflow`：联合编排逻辑与真实桌面流程检查。
- `run.cmd run report:validate -- <analysis.json>`：简明报告Schema、身份、相对路径与引用校验。
- `<配置的Python> backend/sica/evaluate.py --casia-root <划分清单目录> --output <目录>`：只读运行本地 CASIA 子集，阈值固定 0.5，记录每图预测和分组统计，不声称独立泛化。

使用 `package-lock.json` 固定依赖。需要 Node 22.12+，推荐 Node 24 LTS。不要修改系统 Node 来满足本项目。
修改跨进程协议或核心交互后执行类型检查和主流程 Smoke 测试。Smoke 测试只模拟文件选择对话框，实际文件读取、解码、IPC、模拟分析和 React 展示均走真实应用路径。

用户明确要求当前优先搭建并跑通大框架；具体 Bug、打包截图和交付细节先记录，避免偏离主流程。后续独立安排真实能力与发布验收。

用户已于2026-10-28明确要求更新README：说明从已安装的基础框架增量升级到当前版本，并整理提交推送至czh。该授权取代之前暂不更新README的约定。

## 报告与样例约定

- 协议 v1.0 以原始文件完整 SHA256 构造 `imageId`。规范坐标基准是 EXIF 校正方向、sRGB、未缩放的显示副本；bbox 为整数像素 XYWH、左上原点、半开区间。
- 原文件保持原字节；预览、显示副本和模型输入分开管理。模型输出必须映射回规范显示坐标。
- 模块独立提交不可变报告，公共汇总器合并；模拟标记逐报告保存。VLM 输入仅含前三个模块，不包含预置的解释答案。
- 模拟矩形、模拟分数与真实文件哈希、尺寸分别标记。数据集真值与类别放独立文件，不进入 VLM 证据包。
- 数据集示例只作联调，不作为效果证明；没有执行的来源凭证和水印检查标记为 `not_run`。
- 用户要求材料优先覆盖种类、每类少量取样，并且只交付一份给第四人的示例 JSON。数据目录仅保留 `vlm-input.example.json`；其余来源、类别和标注关系使用 `manifest.tsv`。Schema JSON 属于协议定义，不是额外样例报告。
- 本地 IMD2020 已核对为 Yu2018 生成式修复子集，不能宣传覆盖完整 IMD2020。真值掩码是原生 JPEG，应与模拟预测掩码分别标记。
- 当前 APP 图片 ID 已改为原始字节 SHA256，重复导入保持一致；主进程保留原始字节快照。RITA 路径可生成 v1.0 manipulation 报告与证据包，原模拟报告仍使用旧展示类型。其他模块注册、公共报告汇总与 VLM 调用尚未实现。

## 当前状态

- v0.2.0已实现统一入口、照片/文档/不确定三种内容路由、串行模型调度、补充定位复用与部分失败处理。默认主报告为简明analysis.json，完整v1.0证据包保留；实际验证见下方联合版本记录。
- 已接入 RiSE-9 RGB 独立文档定位模式，两张用户样例均在已知修改位置产生最大连通区域，真实 Electron Smoke 及既有模式回归通过；额外标记仍存在，不构成正式质量验收。具体见下方2026-10-28接入记录。
- 桌面框架、类型化 IPC、图片导入和模板分析主流程已建立。
- 已拆分界面组件、界面任务状态、主进程 IPC 路由与分析会话，具备进度、取消和主进程图片释放能力。
- 当前版本已通过 TypeScript 检查、生产构建和 15 项真实 Electron Smoke 检查，包括取消后重试；没有观察到 HTTP 请求或 React 运行时异常。
- 已修复首次双击启动出现 `Electron uninstall`：Electron 45 延迟下载运行时，而 electron-vite 只检查 `path.txt`。已加入 `predev` / `prestart` 安装钩子、官方包 SHA256 校验、缓存和修复命令；已实际通过 npm 执行运行时修复，并通过真实 `start.cmd` 启动测试，确认界面和 preload 桥接就绪。
- 使用 sharp 做实际图片解码、EXIF 方向校正及最大边长 1800 像素的预览，不修改原始文件；这不属于取证算法。
- README 已按 `image-authenticity-app` 重写，包含结构、协作边界、启动命令和后续接入位置。
- README 的复现步骤以新电脑和全新克隆为准，包含 Git / Node 24 LTS 安装、克隆地址、`npm.cmd ci`、启动、手动验收、自动化检查和常见启动问题；不依赖开发者本机的 `.tools/`。
- 已补第一阶段报告协议 v1.0 初稿、共享 JSON Schema、样例生成与校验脚本，并保持 README 不变。
- 本轮 Git 提交范围为协议、Schema、四个脚本、配置模板、使用说明、依赖、忽略规则与本文件；目标分支为 `czh`。真实材料、数据集、本机选择清单和模型权重继续保留在本地，不随提交公开。
- 第一阶段材料已整理 12 张原文件：CASIA 原始照片、拼接、复制移动各 1 张；IMD2020 Yu2018 修复与配对原图各 1 张；GenImage-Tiny 的 BigGAN、ADM、GLIDE、VQDM、SD-v1.5、Wukong、Midjourney 各 1 张。CASIA 类型依据 Tp_D/Tp_S 命名和本地 source_ids，不是检测器预测。
- 三份原生标注单独保存。唯一的 `vlm-input.example.json` 面向 IMD2020 修复样本，只含前三个模块，定位矩形和检测分数均为模拟，不含真值或第四人的预置输出。
- 材料通过文件级校验：12 张原文件及显示副本哈希/像素、3 份标注尺寸，以及唯一 JSON 的 Schema、坐标、裁剪、掩码值和证据引用均通过。未运行 APP、检测模型或 VLM。
- Windows 应用目录已生成过，打包后测试曾在隐藏窗口截图步骤超时；暂未通过发布验收，本轮不继续追查此具体问题。
- 历史范围中模型接入不在 Smoke 原型内；用户现已授权第二人 RITA 接入，具体状态见下方。来源、AI 检测、VLM、历史记录和安装器仍未实现。

## 第二人模块：RITA 选型核对（2026-10-27）

- 用户明确本人的工作属于第二人：篡改图像级判断、像素定位、结构化报告和 APP 接入；先评估现有 RITA，暂未要求训练或执行模型。
- 已在线核对官方 `scu-zjz/RITA` 的 `README.md`、`rita.py`、`test.py`、`test.sh`、`train.py`、`balanced_data.py` 和论文 v3。仓库核对提交为 `b50efcd5b4c41b8bfc69b0b10ce6230dcb67b983`。
- README 虽仍把 Autoregressive inference code 列为待发布，`test.py` 实际已含 `AutoregressiveMaskGenerator`：迭代输出类别掩码并以 EOS/最大步数终止。因此不能仅根据 TODO 断言自回归推理循环完全不存在。
- 当前公开自然图像实现默认 `num_classes=4`；数据构造使用篡改/其余像素、EOS 和 padding，模型返回像素 logits，没有独立的整图二分类头，也不是四种编辑操作分类。需要核对权重与类别约定，并单独验证图像级分数汇总及阈值。
- 论文的传统定位协议与多步过程监督不同；传统协议权重不能未经核验就当作可恢复真实编辑顺序。论文附录的 23 类原子操作示例另用私有文档数据训练，不代表公开四类模型能直接输出这些操作名称。
- 官方 README 提供百度网盘权重/依赖文件入口；尚未下载、读取或严格加载权重，无法确认其完整性、训练协议和效果。根目录未见独立 LICENSE 或完整依赖锁定，后续复用需核对代码与权重使用条件。
- 官方评测入口为 NCCL/torchrun、多 GPU、固定 512 输入和硬编码本地路径，模型初始化还硬编码 SegFormer 预训练文件。桌面接入应抽取单图单进程推理、配置路径，并恢复到协议规定的规范显示坐标，不直接运行数据集评测脚本。
- 候选接入目标：模型真实像素输出 → 掩码/区域/裁剪/响应统计 → v1.0 manipulation 报告 → Electron 调用。`operationHints` 可为空；响应分数不自动视为校准概率，图像真实性结论允许 inconclusive。
- 下一步应先核实可用权重和单图加载，再用现有多类型材料检查接口与几何；若进入质量评测，另用更充分且独立的带标注样本，检查真实图误报、拼接、复制移动和修复表现。现有 12 张联调材料不能证明泛化或确定阈值。
- 本轮仅静态代码和论文核对，未安装 Python 推理环境、未执行检测、未训练，README 不变。本条记录尚未提交推送；选型仍为候选，不能记为已集成。

## RITA 接入开发进展（2026-10-27）

- 开发分支为 `feature/rita-manipulation`，从 `czh` 建立。保留用户已有的分支说明，不修改 README。
- 官方分享已正常通过提取码访问，确认文件名 `rita_catnet.pth`；自动下载接口返回错误，随后由用户下载并放到 `D:\SRDP\weights\rita\rita_catnet.pth`。文件大小 221987263 字节，SHA256 为 `50da42c81508dd3d0f150af4245f47af8c8c0b554a392527635b7e2245aa3299`，已固定到 Git 忽略的本机配置中。该哈希用于本地一致性记录，不冒充作者发布的校验值。
- 本机配置已准备，使用现有 EIT Python（PyTorch 2.7.0+cu126、timm 1.0.21），不修改其已安装依赖。配置不提交。源码检查和单图执行独立于其他项目的代码。
- 实现固定源码 SHA256 校验、去除骨干硬编码初始化路径后完整 strict=True 权重加载、单进程 FP32 自回归、超时及取消、像素类别解码、规范显示坐标恢复、区域裁剪与 v1.0 报告保存。
- 只接收四类任务权重；class0=篡改，class1=其余，class2=EOS，class3=padding。按首个 EOS 主导步骤之前的最后有效输出定位，控制类别不会被自动算成篡改。默认整图阈值为空，结果为 inconclusive，响应分数不作已校准概率。
- 桌面新增独立 RITA 模式，真实调用 Python，不因缺失模型而回退模拟。可展示预测叠加及 JSON；结果保存于 `work/rita-runs/<taskId>/`。发布包的 Python/权重分发尚未配置。
- 已通过类型检查、构建、既有 15 项模拟 Smoke 和 5 项 RITA 入口检查（重复导入 SHA256、真实 IPC、无权重明确报错、不安全任务 ID、模式隔离）。7 项 Python 后处理与负向加载测试全部通过，包括首个 EOS 边界、padding、缩放、分数分辨率不变、缺权重和不完整权重 strict 拒绝。
- 已执行随机初始化网络结构的单次 CUDA 前向检查，输出 [1,4,512,512] 且有限。这只证明当前计算环境和网络形状可运行，没有加载预训练权重、没有评估定位效果；不得作为检测成功或性能结果。
- 官方权重已通过完整 strict=True 加载。5 张联调图片（CASIA 真实/拼接/复制移动、IMD2020 原图/修复）均完成真实 CUDA 推理，全部 v1.0 证据包通过 Schema、哈希、坐标、裁剪和引用校验；输出位于 `work/rita-verification/`，没有读取真值作为模型输入。
- 已通过 `smoke:rita:real` 的 6 项真实 Electron 检查：原生选图到 IPC/Python/官方权重、真实掩码和报告展示、进度、保留 inconclusive、实际子进程取消且不产生完成报告、无界面异常和 HTTP 请求。记录与截图在 `work/rita-real-smoke/`。
- 质量观察仅针对这 5 张联调图，不是独立基准：CASIA 拼接像素 F1=0.94593，复制移动=0.90202；IMD2020 Yu2018 修复=0.09474。两张真实图被标记像素占比分别约 30.21% 和 24.85%。CASIA 样例可能与权重训练来源重叠，高分不能视为泛化证据。
- 原始 top-1% 响应在真实图与修复图上均接近 1，当前汇总分数未展示可靠的图像级区分能力。默认阈值继续为 null，不能把这一数值展示成真实性置信度，未使用这几张图拟合或选择阈值。
- CLI 记录的 3 步纯模型推理约 407–839 ms，含导入、加载、解码与保存的单次 worker 约 4.8–12.7 s；PyTorch 峰值 allocated 显存 413640192 字节。它不包含完整桌面进程显存或总系统占用，时间不是稳定吞吐基准。
- 当前结论为“真实定位链路已跑通，部分样例表现可用，但整图分类、修复表现与真实图误报尚未通过质量验收”。未训练，未做阈值校准；需要进一步验证适配与权重的适用范围，再决定是否保留为唯一定位方法。
- 用户指出成功定位后显示“整图判断：证据不足”容易被理解为否定定位。已核对其截图对应报告：1 个区域，bbox=[482,152,158,94]，top-1% 响应约 0.9999977，decision=inconclusive 的原因是未配置整图阈值，不是该区域被判为无篡改。
- 界面文案现分开显示“模型标记的可疑区域”“像素响应统计（非整图置信度）”和“图像级分类未输出结论（阈值未配置）”。保留原始 JSON decision 与计算规则，不为消除文案矛盾临时设阈值。历史已保存报告的摘要不会自动重写，重新运行后使用新摘要。
- 篡改手法识别仍未实现。当前权重输出定位/控制类别，不输出拼接、复制移动或修复语义；后续可独立接入有证据的操作候选分析，不能用数据集文件名、真值或 VLM 猜测冒充检测结果。

## 跨领域与可解释模型候选核对（2026-10-27）

- 用户进一步明确需求为多领域图像篡改、解释能力和公开权重，不限文档。此轮只核对公开实现与权重入口，未下载大模型、未替换 RITA、未修改 README。
- FakeShield：官方 `zhipeixu/FakeShield` 明确支持真假分析、解释和掩码；HF `zhipeixu/fakeshield-v1-22b` 公开、非 gated，已看到 DTE-FDM / MFLM / DTG 权重文件，目录约 44.2 GB，另需 SAM。覆盖证据主要是 Photoshop、FaceAPP/DeepFake 与 AIGC 局部编辑，不能把它直接视为经验证的文档通用模型。论文部分场景像素 F1 仍低，解释存在不等于定位稳定或解释忠实。
- SICA：官方 `venus-guangjian/SICA_OpenMMSec` 提供四域（DeepFake/AIGC/IMDL/Doc）统一分类和公开权重。已访问其当前 README 实际链接目标 Google Drive 文件夹，见 `sica_weight_train.pth`、`sica_weight_full.pth`；README 明确 full 使用含验证和测试的完整数据，评测应优先 train。当前 inference.py 返回 pred_label，不能冒充现成像素定位或自然语言解释模型。
- TruFor：官方 `grip-unina/TruFor` 推理文档提供最终任务权重直链 `https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip` 与 MD5，并定义 anomaly map / confidence map / image score / 可选 Noiseprint++。它适合作为更丰富的检测证据候选，不自动提供语义操作名称或自然语言理由，文档等跨领域适用性仍需实测。本轮没有下载验证该 ZIP。
- ForgerySleuth：当前官方 README 中完整 Assistant 仍为 TODO；公开数据引擎 ForgeryAnalyst 接收已知掩码和操作类型以生成标注文本，不能把这个权重当成已证实的端到端未知图像检测器。
- 选型建议保留区分：解释/定位一体重点看 FakeShield，四域整图分类重点看 SICA，当前本地工程证据输出可比较 TruFor。没有已核实的单模型同时满足全部领域高质量、像素定位、操作解释与 8 GB 显存直接部署。

## SICA + FakeShield 组合方案讨论（2026-10-27）

- 用户提出先用 SICA 做图像级二分类，再用 FakeShield 做解释；当前作为候选架构讨论，尚未授权/执行这两个模型的下载、环境安装和接入，不提前移除现有 RITA。
- 建议 SICA 输出独立的图像级分数与标签，FakeShield 基于原图进行自身分析，并按需要运行定位模块；FakeShield 完整能力包含 DTE-FDM 的分析/解释以及 MFLM 的掩码，不应误认为一个只读任意 JSON 的通用解释器。
- 避免把 SICA 分类当作不可更改的事实，或用“已确定为假”强制 FakeShield 找理由。两者的报告和来源分别保存，结果不一致时呈现冲突；SICA 分数不直接充当解释置信度。
- 第一轮联调应执行两条分析以观察冲突和漏检；效率路由以后验证，不能默认 SICA 判真便跳过所有定位/解释。SICA 的二分类结果也不能自动用作 Photoshop/文档/DeepFake 等域标签。
- SICA 用于开发与验证时优先 train 权重，避免 full 权重使用过 OpenMMSec 验证与测试的问题。FakeShield 文档等场景的表现及解释忠实性单独验证。
- 8 GB 显存上按需加载可以缓解并发占用，但不能保证 FakeShield 单阶段本身能装入；需要先核验官方模块、量化/卸载兼容性和实际内存。未承诺当前电脑可完整运行该组合。

## SICA 公开状态复核与措辞修正（2026-10-27）

- 用户质疑 SICA 是否开源，已重新读取官方仓库 API、完整 model.py、inference.py、README 和权重目录。准确表述改为“公开推理代码及权重入口”，不直接宣称完整、已验证的开源复现方案。
- `https://github.com/scu-zjz/SICA_OpenMMSec` 当前 API 404；可访问地址为 `https://github.com/venus-guangjian/SICA_OpenMMSec`。仓库公开包含 model.py / inference.py / requirements.txt，但主仓库中没有完整训练和评测入口。
- 官方 README 的权重链接显示文字与实际 href 不同。实际可访问目录为 `https://drive.google.com/drive/folders/1HQ2tj_1aeeoWP7meAf01fqVHmsAcEGPU`，本次 HTTP 200 并再次看到 train/full 两份命名权重；尚未下载并验证 state_dict、加载或效果。
- inference.py 构造 CLIP_LORA_PURE，使用 strict=False 加载，不能只凭脚本运行成功就认定分类头和 LoRA 权重全部正确装载。后续若接入要核对 keys、形状与缺失项。
- README 引导通过 ForensicHub 和配套 starter 做训练，starter 自称近似复现且披露评测协议推断等限制，不作为论文全部实现已逐项核对的证据。
- 主仓库没有独立 LICENSE，GitHub API license=null；README 的 CC BY-NC 4.0 明确说明的是数据集，不能据此替代码、权重推断明确许可。公开可读、可下载和开放许可分别核对。

## FakeShield 在现有四人框架中的职责讨论（2026-10-27）

- 用户准备下载 SICA 权重，询问 FakeShield 在框架中的具体作用。此轮仍为职责设计，没有执行新模型下载或接入。
- SICA 提供独立图像级真假分数/判断；FakeShield 提供基于原图的模型分析文字及可选像素定位。DTE-FDM 生成分析与判断，MFLM 消费其文字与图片生成掩码，完整定位不能仅下载解释模块或直接跳过其文字条件。
- FakeShield 原生文字作为带来源的模型观察保存，可包含可疑对象、位置和候选线索；不能自动当作已证实的篡改操作，也不能让它为 SICA 的标签强行辩护。
- 当前四人分工下，第二人可封装 FakeShield 的分析/定位服务并返回原生输出、掩码、裁剪与结构化报告；第四人消费这些结果及来源、AI 检测报告，负责证据引用、冲突处理和最终用户报告。复用现有输出，避免无目的地重复调用同一个大模型。
- FakeShield 官方入口不是通用的任意证据 JSON 综合器；若要求它直接消费我方完整 JSON，需要额外适配并验证，不把这种能力记为现成支持。
- 先观察 SICA 与 FakeShield 各自输出再做路由。全图生成、文档及其他未验证类型不能仅凭 SICA 二分类标签就认为 FakeShield 已有对应可靠定位能力。

## 分工边界修正与 RITA 替代候选（2026-10-27）

- 用户明确 VLM 分析应在最后由第四人负责。此前把 FakeShield 完整分析/定位服务放到第二人的建议与该约束冲突，以上讨论以本条修正为准。
- 第二人负责不依赖 VLM 的图像级篡改检测、像素定位和结构化证据；FakeShield 可留作第四人的候选分析工具，但其完整定位链路依赖语言模块，不能删除语言模块后视为现成的第二人纯视觉替代。
- 再次核对官方 TruFor 推理说明：提供最终任务权重直链、map/conf/score/可选 Noiseprint++，且有专门图像级检测与可靠性估计训练阶段。因此更接近第二人的核心工程需求；不等于已有语义操作识别或文档/新型生成编辑的全面质量保证。尚未下载或运行本项目的 TruFor。
- 新核对 HiFi-Net（CHELSEA234/HiFi_IFDL）：官方提供 detect/localize API、传统定位与 general-forgery 两组权重目录；已访问两个目录均 HTTP 200，但未下载或验证文件内容。论文任务包含分层伪造属性，源码有多级分类输出；默认便捷 API 只返回二分类及掩码。若要输出手法候选，需核对标签映射、选择正确权重并额外封装，不承诺任意操作识别。
- HiFi-Net 的公开环境较旧（官方列 Python 3.7 / PyTorch 1.11），迁移成本与跨领域效果需实测。当前选型建议：优先对比 TruFor 的整图检测/定位/可靠性；如强需求为方法属性线索，再评估 HiFi-Net。两者都不能仅凭论文声称强于本地 RITA。
- 本轮仅重新核对与建议，未移除 RITA、未下载新模型、未改变 APP 或 README。

## HiFi-Net 模型公开状态与可交付能力复核（2026-10-27）

- 已读取官方 CHELSEA234/HiFi_IFDL 的 README、HiFi_Net.py、models/NLCDetection_api.py、utils/load_data.py、utils/custom_loss.py 和 LICENSE。代码许可证为 MIT；本轮未下载权重或执行模型，不把源码阅读当成已验证可用。
- 官方 general-forgery 权重目录 `https://drive.google.com/drive/folders/1v07aJ2hKmSmboceVwOhPvjebFMJFHyhm` 的 HRNet/NLCDetection 子目录均已访问 HTTP 200，看到实际 `750001.pth`；定位目录 `https://drive.google.com/drive/folders/1cxCoE2hjcDj4lLrJmGEbskzPRJfoDIMJ` 两个子目录实际文件为 `225000.pth`，不能混用迭代号或参数组。
- 已确认现成 detect/localize 入口与多级分类头。NLCDetection_api 包含 3/5/7/14 维的层级输出；load_data 中存在 splice/inpainting/copy-move、人脸编辑和多种生成模型的类别定义。便捷接口会折叠成真假标签，不直接返回完整属性路径，接入时须核对训练类别映射和相应权重。
- 可计划提供图像级判断、原始分数、像素掩码/距离响应、结构化区域和有限类别的属性候选；不依赖 VLM，适合第二人。距离响应和 softmax 分数不能直接声称是校准后的可信概率。
- 本轮核对的是 CVPR2023 HiFi-Net 公开实现，不将 IJCV 语言引导扩展 HiFi-Net++ 的能力直接算入当前权重。文档、最新生成编辑、未知类别和编辑历史还原未验证，不承诺跨领域全面效果或任意编辑手法识别。
- 原官方单图代码固定 256×256 与 cuda:0/DataParallel，依赖旧版环境和额外 center/radius；工程接入需设备/路径配置、完整参数加载核验和坐标恢复。未在本轮开始实施替换。

## SICA 接入与 CASIA 本地观察（2026-10-27）

- 用户已下载 `weights/sica/sica_weight_full.pth`，要求接入，并明确先检查本地 CASIA v2。工作分支为 `feature/sica-classification`，基于现有 RITA 功能分支，保留先前 AGENT 记录与用户的分支说明。
- 当前文件 1725248247 字节，SHA256 为 `edec757f9def0c5d18907087dd97e7dddbc673c804f7ff93b2d65130b3c813b9`，epoch=9。固定到 Git 忽略的 `config/sica.local.json`；这是实际文件身份记录，不是作者公布的数字签名。
- SICA 源码固定提交 `def6e344ca3f18a2313adb6be3bd1f8fb8d27e7d`，model.py SHA256 `c82d71ddb0664a74c7e0b056cf661b3b55c815342bc842bce3ab8629ee05a87c`；CLIP 固定提交 `d05afc436d78f1c48dc0dbf8e5980a9d471f35f6`。代码位于 `.tools/`，不重新分发上游源码，不修改现有 EIT 的已安装包。
- 从完整权重构造 CLIP 骨干，再加载所有任务参数；568 个状态项 strict=True 全匹配，48 个 LoRA 模块及 fc 分类头完整，missing/unexpected 均为空。torch.load 仅为 argparse.Namespace 添加显式类型许可，保持 weights_only=True；FP32 执行。
- APP 已有单独“SICA 图像二分类”模式，模拟与 RITA 模式保留。新增 Python worker、通用子进程控制、配置模板、单图 CLI 和 JSON；SICA 不提供像素掩码，也不执行 VLM。
- 报告复用第二人 manipulation 外层，通过 classification.scope 明确其 general image authenticity 范围，fake 不能自动解释为局部篡改；regions=[]、localization.status=not_run，positiveClass=fake，calibrated=false。官方 CLIP 短边缩放 + 中心裁剪 224，边缘篡改可能不在视野内；本轮没有挑选其他预处理或拟合阈值。
- 已执行本地 CASIA 可用子集全部 479 张（96 真实、383 篡改），无读取失败；阈值固定 0.5。TP=307、TN=87、FP=9、FN=76；ACC=82.25%、balanced ACC=85.39%、Precision=97.15%、Recall=80.16%、F1=87.84%、AUROC=0.92390。
- 按本地命名标签分组：拼接 130 张检出 118（90.77%），复制移动 253 张检出 189（74.70%）。这不是完整 CASIA v2；观察输入包含本地 train/validation/test 清单，而且 full 权重可能已见过相关来源，不能当成独立测试或跨域泛化证明。
- 每图 CSV、清单哈希与统计保存于 `work/sica-casia-observation/`。模型只读取图片，不读取类别或真值；分类评价在推理输出后计算，没有训练或调阈值。
- 单图 CLI 输出已通过 v1.0 Schema、原始文件哈希、规范显示图与引用校验；4 项分类头/LoRA 缺失或形状不符拒绝测试通过。已通过真实 Electron 的 6 项 SICA Smoke：缺权重明确报错、完整模型执行、分类头/LoRA/严格加载核验、无伪造定位、实际进程取消、无渲染异常或 HTTP 请求。
- SICA 增加后，既有 15 项模拟主流程 Smoke 再次通过，类型检查与生产构建通过；没有用测试失败来触发模拟回退。新增代码与文档保持 README 无差异。
- 使用说明为 `docs/SICA_INTEGRATION.md`；README 保持不变。SICA、RITA 发布包的 Python/权重分发均未配置。本轮新功能尚未推送 GitHub。
- 用户另已下载 HiFi-Net general 两个 750001.pth，路径位于 weights/hifi/general/HRNet 与 NLCDetection；已创建对应目录并核对文件存在。官方配套 center/radius（18 维中心及标量半径，543 字节）已保存 `.tools/hifi-upstream/center/radius_center.pth`；暂不需要 weights_loc，不混用 225000 权重。HiFi-Net 尚未执行或接入。

## HiFi-Net 二分类与定位测试（2026-10-27）

- 用户授权测试 HiFi-Net 的分类与定位。分支 `feature/hifi-evaluation` 从当前 SICA 分支建立，未训练、未调整阈值、未替换 APP 默认模型或修改 README。
- 固定官方源码提交 `0ca70d651087bb09959dec583947031c47d30209`，位于 `.tools/hifi-official/`。两份 general 750001 权重严格加载：HRNet 699 状态项、NLCDetection 66 状态项，无缺失/多余；哈希分别为 `be21278afb4e657bdafdf581d8d8bc6bc09f3b4507b10502ce98f1ae7ef1c5c1`、`7615fcb054e7cbd0b25d647d72655a690424232668abbc911551648e84b5f8fc`。
- 使用相同源码中的 center/radius，SHA256 `e41e09256e65bcff9ba43e72f08701bf4d3904ccdb749f2d32a008af92c2483b`，radius≈1.24048。源码 np.int 通过模块内代理兼容；yacs 0.1.8 隔离安装到 `.tools/hifi-deps/`，未修改 EIT 包版本或官方源码。
- 保持官方单图 API 256×256 bicubic、RGB/255、无 ImageNet 归一化，FP32/cuda:0。分类主口径为 14 类 argmax 折叠真假，额外记录 score>=0.5 口径；定位使用原始特征距离>=2.3，不把距离当概率。
- 本地 CASIA 479 张全部读取成功：原生分类 TP=60/TN=87/FP=9/FN=323，ACC=30.69%、F1=26.55%、AUROC=0.44895；0.5 口径 ACC=30.90%，与原生有 1 张不同。
- 全部 383 张篡改图原尺寸定位 macro pixel F1=0.002413、IoU=0.001409、AUC=0.47545；368 张预测为空。没有用分类结果筛掉定位失败，没有真值驱动反转、阈值拟合或边界剔除。原生标注随 EXIF 进行对应变换，源数据只读。
- 同环境抽查两个样例与原始官方 HiFi_Net 类方法：标签/分数相同，掩码逐像素一致。记录为 `work/hifi-casia-observation/api-parity.json`，它排查适配改写偏差，不证明旧环境的精确复现。
- 结果保存在 `work/hifi-casia-observation/`，单图原始输出在 `work/hifi-verification/`。现有通用组合未达到可用效果；不能据此否定专用 weights_loc。若后续测试 225000，必须配套 NLCDetection_loc/CE 分支，不沿用当前通用距离规则。
- 新增 backend/hifi/、config/hifi.example.json、本机忽略配置及 hifi:evaluate/hifi:infer；说明在 docs/HIFI_EVALUATION.md。单图 inspection.json 为诊断记录，不冒充 v1.0 证据包；尚未接入 HiFi APP 模式或 VLM。
- 当前分类效果对比只适用于同一本地子集上的不同模型/预处理配置，非控制训练数据的公平算法基准；不宣传独立泛化或支持全部篡改类型。
- 用户进一步询问当前权重是否只该二分类：SICA 确实只做分类，未用它生成掩码；HiFi general 750001 的官方 README/HiFi_Net.py 同时提供 detect/localize，但它不是 weights_loc 的专用传统定位权重。此次定位指标应视为该通用 API 路径的诊断，不冒充专用定位版本的基准结论。
- 对同一轮 479 张结果复核二分类分数分布：真实与篡改分数几乎完全重叠（中位数 2.17e-4 vs 7.92e-5，真实图中位数反而更高），AUROC 0.449 低于随机反转；47 张篡改图 score 恰为 0（FP32 下 P(real)=1）；410/479 张的 14 类 argmax 落在 real，其中 323 张是篡改图。命中的非 real 叶子多为 latent_diffusion/stargan_v2/ddpm/inpainting，而本 CASIA 子集不含这些内容，进一步说明 general 权重类别体系与该数据域不匹配。原生与 0.5 口径仅 1 张差异（copy_move，score=0.5202）。以上为对既有结果的复核拆解，未重跑、未改阈值。
- 已核对论文 arXiv 2303.17111（CVPR2023）评测协议：7 个基准为 Columbia、COVERAGE、CASIA、NIST16、IMD2020、HiFi-IFDL、DFFD。HiFi-IFDL 上检测 AUC/F1=96.8/94.1、定位 95.3/96.9，其中 CNN 生成图子集最高（检测 97.0/96.1、定位 98.4/97.0），图像编辑子集为 91.5/85.9 与 93.0/90.1；DFFD 人脸检测 AUC 99.45。经典编辑数据集用 weights_loc 预训练时定位 AUC 83.4–98.4（均值 89.6），微调后 Coverage/CASIA/NIST16 的 F1 为 80.1/61.6/85.0，CASIA 检测 AUC/F1=99.5/97.4。
- 关键区分：论文中 CASIA 的 99.5 AUC / 97.4 F1 来自 weights_loc（225000）定位模型路径，不是本轮测的 general 750001，两者不可直接比较。本地 750001 在 CASIA v2 子集上的 0.449 不能用来否定论文数字，论文数字也不能当作本地已验证结论；要对照必须安装 225000 并走 NLCDetection_loc/CE 分支。`load_data.py` 显示 18 类构成：真实 5 类（LSUN/CelebAHQ/FFHQ/AFHQ/YouTube），伪造 13 类（splice、inpainting、copy_move、FaShifter、STGAN、StarGANv2、HiSD、StyleGAN2/3、DDPM、DDIM、LDM、GLIDE），经典篡改仅占 3 类。
- 已核对 225000 定位权重的前置条件（本地源码 `HiFi_Net_loc.py`、`utils/load_edata.py`）：代码走 `models/NLCDetection_loc.py`，与 general 的 `NLCDetection_api` 不是同一模块；`--loss_type` 默认 `ce`，二值掩码按 `mask_binary > 0.5` 生成，不能沿用 2.3 距离阈值；配套 `center_loc/radius_center.pth` 已在本地（1063 字节，与 general 的 543 字节不同）。官方评测清单在 `data_dir/`（CASIA1/CASIA2/Coverage/NIST16/IMD2020/columbia，仓库内为占位清单，完整图包需论文 data.tar.gz）。下载地址为 README 的 localization_weights_link（`1cxCoE2hjcDj4lLrJmGEbskzPRJfoDIMJ`），两个子目录分别为 HRNet/225000.pth、NLCDetection/225000.pth；代码里 315000 是备选迭代号，不混用。
- 论文 CASIA 数字与本地 750001 结果差异的归因：①权重集不同（loc 225000 vs general 750001）；②指标不同（像素定位 AUC 86.6 / 检测 AUC 99.5、F1 97.4 vs 二分类 AUROC 0.449）；③数据不同（官方 CASIA2 评测清单 vs 本地 479 张 pilot 子集，后者含 train/val/test 划分）；④协议不同（crop_size 256 + CE 掩码 0.5 vs 全图缩放 + 距离 2.3）。API parity 抽查已排除适配改写偏差，故差距不能归因于实现 bug。
- 已接入官方定位权重 225000（CE 分支）：新增 `backend/hifi/model_loader_loc.py`、`backend/hifi/evaluate_loc.py`、`backend/hifi/evaluate_loc_official.py`、`config/hifi.loc.example.json` 与 `hifi:loc:evaluate` / `hifi:loc:official` 命令；HRNet 699 项、NLCDetection_loc 106 项 strict=True 全匹配；掩码按 `mask_binary>=0.5`，不沿用 2.3 距离阈值；`center_loc/radius_center.pth` 仅审计、不参与 CE 推理。权重位于 `weights/hifi/weight_loc/`，哈希已记录在 docs/HIFI_EVALUATION.md。
- 已修正一次实质性预处理偏差：初版适配器沿用了 general API 的 PIL bicubic 256 预缩放，但官方 `HiFi_Net_loc.py`/`load_edata.py` 是把**原分辨率**图像送入 HRNet，仅掩码分支在模型内部 bilinear 缩到 256，GT 用 BICUBIC 缩到 256 后 `>0.5`。修正后 `predict(native=True)`，`evaluate_loc.py --input` 默认 `native`；初版结果保留在 `work/hifi-loc-casia-observation/` 作为偏差记录，不再作为结论。
- 本地 CASIA 479 张定位结果（修正后，原尺寸、正类像素、无真值翻转）：F1=0.34055、IoU=0.28028、AUC=0.86711；拼接 F1=0.3147/AUC=0.8335，复制移动 F1=0.3538/AUC=0.8844；91 张空预测；真实图平均预测面积 0.22%。初版 bicubic256 口径为 F1=0.14273/AUC=0.72638，已作废。
- 精确官方协议复现（`hifi:loc:official`：原图输入、GT BICUBIC 256+0.5、逐图 max(F1,F1_flip)/max(AUC,1-AUC)、无 EXIF、batch=1）：macro F1=0.64750、macro AUC=0.88540（无翻转 0.64638/0.86674；翻转选择 7/27 张）；拼接 F1=0.62641/AUC=0.85957，复制移动 F1=0.65834/AUC=0.89868。与论文 CASIA 预训练 AUC 86.6、微调 F1 61.6 同量级且略高；但本地 479 张 pilot 子集与本地修正掩码不等于官方 CASIA1+CASIA2 清单，仍不能称为论文复现。项目脚本 `officialProtocolDiagnostic` 与独立 official 脚本交叉验证到 1e-4 以内（0.64747/0.88533 vs 0.64750/0.88540）。
- 二分类头修正后不再坍缩但仍弱：native 输入下 leaf 分布 real 333、inpainting 80、stgan 35、copy_move 19、splicing 12；balanced ACC=59.29%、AUROC=0.62285。该权重仍不适合承担图像级判断，SICA 继续作为分类候选。初版「从不预测 real」是预处理偏差导致，不是权重本身缺陷。
- 通用 750001 适配器不受影响：官方 general API（`HiFi_Net.py::_transform_image`）本身就是 PIL bicubic 256，已完成 API parity；两套权重的官方入口预处理不同，不能混用。README 未改动。

## HiFi-Net 定位模式接入（2026-10-27）

- APP 新增独立模式 `hifi`（界面「HiFi-Net 本地定位」），使用官方 225000 CE 定位权重；模拟、RITA、SICA 模式保留。新增 `backend/hifi/worker.py`、`src/main/services/hifi.ts`、`tests/hifi-smoke.mjs`、`config/hifi.loc.example.json`（含 timeoutMs），本机配置 `config/hifi.loc.local.json` 已加入 `.gitignore`。
- 协议层：`AnalysisBackend` 增加 `hifi`，`AnalysisReport` 增加可选 `backend` 字段，IPC 白名单放行 `hifi`；preload 接口不变。渲染层新增模式按钮、步骤/提示文案与 `hifi-overlay`/`hifi-bundle` 测试 ID，SICA/RITA 原有测试 ID 保持不变。
- 报告：`producer.name=HiFi-Net-loc-225000`，`extensions.variant=localization_225000_ce`，记录 HRNet 699 项与 NLCDetection_loc 106 项 strict 加载、两份权重 SHA256；`result.decision` 固定 `inconclusive`，输出掩码、区域、面积占比与叠加图，`classificationHints` 只记录叶子类别，不伪造图像级结论。
- 验证：`smoke:hifi` 6 项通过（缺权重明确报错且不回退、真实 Electron→IPC→Python 严格加载、CE 掩码 0.5、叠加与区域展示、实际子进程取消且无完成报告、无渲染异常与 HTTP）。既有 15 项模拟 smoke、5 项 RITA 入口 smoke 与 6 项 SICA smoke 同时通过。
- 环境注记：本机在默认 Electron 参数下出现 GPU 进程崩溃（`exit_code=-1073741819`）导致渲染进程无法加载，基线 mock smoke 同样复现，与本次改动无关。验证时使用 `work/` 下带 `--no-sandbox --disable-gpu` 的测试副本；仓库内测试文件未修改，正式测试仍按原参数运行。
- 说明文档为 `docs/HIFI_INTEGRATION.md`；README 未改动。发布包 Python/权重分发、CPU 路径与整图阈值仍未实现。

## 模型选型复核：是否还有更优选择（2026-10-27 第二轮）

- 现状证据：SICA 在本地 479 张 CASIA 上 AUROC=0.924（图像级）；HiFi loc 225000 官方口径 F1=0.6475、AUC=0.8854（定位）；RITA 已补齐 479 张全量（见下方专节）：正类像素 F1=0.6947、AUC=0.9330，但真实图平均误标 14.80%。三者都不能单独同时满足「可靠图像级分数 + 低误报定位 + 跨域」。
- IMDL-BenCo（NeurIPS 2024 Spotlight，`scu-zjz/IMDLBenCo`）提供统一代码库与 model zoo 权重，覆盖 trufor、object_former、pscc_net、mvss_net、span、cat_net、mesorch、sparse_vit、iml_vit、mscdi_net、apsc_net、mantra_net；权重在百度网盘/Google Drive。需注意其 balanced_dataset.json 的 CAT 协议与原版 CAT-Net 不同（省略部分真实数据），不能把其数字直接当原论文复现；v0.1.27 曾修复图像级指标 bug，须用最新版。
- TruFor（CVPR 2023，`grip-unina/TruFor`）公开推理与训练代码、公开权重；输出 anomaly map、整图 integrity score 和 reliability map，直接对应「图像级分数 + 低误报」缺口；许可为仅信息与非商业用途，接入前必须记录。尚未在本地数据验证。
- ForensicHub（NeurIPS 2025，`scu-zjz/ForensicHub`）是评测框架而非单一模型：同时支持图像级检测（AIGC/Deepfake 主任务）与像素级定位（IMDL/Doc 主任务），由 `if_predict_label` / `if_predict_mask` 配置；评测器覆盖 image-level 与 pixel-level 指标。官方排行榜以各域 AUC 平均排名，训练仅用 OpenMMSec 且不微调，IMDL 域用 IMD2020 + Autosplice（不含 CASIA）。适合跨域横评，但不能替代我们在 CASIA 上的本地验证。RITA 上游已被 CVPR 2026 Findings 接收，现有接入不算过时。
- ForensicHub 许可与权重：代码为 CC-BY-4.0；权重公开下载但无独立许可声明——IFF-Protocol 检查点在百度网盘与 OneDrive，Doc/AIGC 基准检查点在百度网盘与 Google Drive，另有 Doc 骨干权重；无 HuggingFace 托管，按基准打包而非逐模型清单。SICA 与 RITA 权重不在 ForensicHub 托管（各自独立仓库）。使用其权重前需逐个核对上游模型许可（如 TruFor 为非商业），不能仅凭代码许可推断权重可商用或可再分发。
- IFF-Protocol 的确切含义（论文 v3）：四域联合训练——Deepfake 用 FF++、**IMDL 用 CASIAv2**、AIGC 用 GenImage、Doc 用 OSTF/RealTextManipulation/T-SROIE/Tampered-IC13，每 epoch 等量采样、上限 12,641（CASIAv2 规模）、256×256、20 epochs；测试跨四域且不微调。**因此 IFF-Protocol 检查点在训练时见过 CASIAv2，用我们的本地 CASIA 479 评测存在训练重叠，不能当作干净基准或用来宣称优于未见过 CASIA 的模型。** Doc/AIGC 检查点分别是 DocTamper / DiffusionForensics 域内训练；Doc 骨干权重只是初始化，不是检测器；同名模型在不同包中可能是不同权重，不能混用。
- 下载入口（2026-10-27 核对官方 README）：ForensicHub 仓库 `github.com/scu-zjz/ForensicHub`；IFF-Protocol 检查点 `pan.baidu.com/s/1gER6MYt30ghrKQT0Nu182g?pwd=brir`（OneDrive 镜像 `1drv.ms/f/c/090693aab65eb63b/Eo6tl6ktl4BLkQjqjwqXRhYB5nNt_Sni5Nx6KMC4DDJPnw?e=vayq2E`）；Doc 基准 `pan.baidu.com/s/13ViyJebu12I0GN3BucBQrg?pwd=npkx` / Google Drive `1RZZxwYIX5e-lHKDw1CD45FwFC0QqJ7im`；AIGC 基准 `pan.baidu.com/s/11Jr2wjp6lAz9IBNWnbHlVg?pwd=kzhf` / Google Drive `1M-qe5xOblVZgKiBQ9j1Q-GQ4ao5VJMHZ`；Doc 骨干 `pan.baidu.com/s/1lsArVWzcJiADUcYYeqyClw?pwd=4gf4` / Google Drive `1NiHeRAcG2VkoN-JFgV5O_4YynQFiQWUw`。IMDL-BenCo 检查点 `pan.baidu.com/s/1DtkOwLCTunvI3d_GAAj2Dg?pwd=bchm` / Google Drive `1DCqc016-N4YvoMKKA87bFtrCdPVIDxAp`；TruFor 官方权重 `grip.unina.it/download/prog/TruFor/TruFor_weights.zip`。
- IFF-Protocol 网盘包实际是**文件夹**（用户截图显示 42 个文件），每个 `.pth` 是一个独立 checkpoint，不是单个模型；命名形如 `<模型>_<低层特征>.pth`（none/bayer/dct/qt/sobel），另有 capsule、dtd、dualnet 等单文件模型。可按需单选下载，整包体积大。包内是 IFF-Protocol 训练版，不是各模型官方权重（如包内 trufor.pth 不等于 TruFor 官方权重），且训练含 CASIAv2，不能用于本地 CASIA 基准。
- 建议顺序：①先用现有 479 张框架评测 TruFor（同一口径，先看真实图误报与 CASIA F1/AUC）；②若 TruFor 达标，作为主定位模型，HiFi loc 保留为第二意见，RITA 降级为对照；③再用 IMDL-BenCo 对 ObjectFormer/PSCC-Net/MVSS-Net/CAT-Net 做同协议横评，避免逐个接入；④SICA 继续承担图像级分类；⑤FakeShield 仍归第四人 VLM 候选。
- 红线不变：不训练、不调阈值；不拿论文数字当本地结论；跨模型比较必须同数据同协议；非商业许可（TruFor）在交付前单独核对。

## RITA 479 张全量观察与组合对比（2026-10-27）

- 新增 `backend/rita/evaluate.py`（批量评测，模型只加载一次；源码 SHA256 与权重哈希校验、strict 加载 631 项、512×512 + ImageNet 归一化、maxSteps=10、首个 EOS 前最后有效步解码）。命令：`<配置的Python> backend/rita/evaluate.py --casia-root <清单目录> --output <目录>`。
- 本地 479 张（96 真实 / 383 篡改）定位结果：正类像素 F1=0.69467、IoU=0.61592、AUC=0.93300；拼接 F1=0.89959/AUC=0.99487，复制移动 F1=0.58938/AUC=0.90121；383 张篡改图无空预测；**96 张真实图平均预测面积 14.80%**。RITA 分数诊断 AUROC=0.46978，不能作为图像级分类器。
- 与 HiFi loc 225000（native 输入）同数据对比：RITA 的定位精度显著更高（F1 0.695 vs 0.341，AUC 0.933 vs 0.867，空预测 0 vs 91），但真实图误标面积高约 67 倍（14.80% vs 0.22%）。**单模型定位精度：RITA 胜；真实图误报控制：HiFi 胜。**
- 组合分析（仅用两模型既有输出，未调阈值）：以 SICA 固定 0.5 判定作门控，SICA 判真则跳过 RITA 定位——正类像素 F1=0.6072、真实图平均误标面积降至 1.68%；代价是 SICA 漏检的 76/383 张篡改图被跳过，96 张真实图中 87 张被拦截。**这是目前本地数据上最可用的组合：精度接近 RITA，误报接近 HiFi。**
- 结论修正：RITA 不是「只有 5 张图、无法判断」，它在 CASIA 子集上是当前最强定位器，但单独部署不可用；此前「优先用 TruFor 替换 RITA」的判断需调整为「先解决 RITA 的误报（门控/可靠性过滤），TruFor 官方权重作为下一候选做同口径对比」。IFF-Protocol 包内的 trufor.pth 因训练含 CASIAv2，不能用于该对比。

## 漏检诊断与下一候选复核（2026-10-28）

- 用户询问 SICA+RITA 仍漏检时更合适的公开模型。先只审阅现有输出与官方材料，不启动新模型安装或推理，不覆盖当前工作区其他未提交的 HiFi loc/界面改动。
- 对 479 张既有 CSV 按路径一一关联：SICA 漏检 76 张（复制移动 64、拼接 12）；RITA 在这 76 张上的平均像素 F1=0.44061、中位数=0.39942，其中 32 张 F1>=0.5、17 张>=0.8。说明一部分漏检来自分类门控丢弃已经可用的定位，不应仅寻找更强定位器。
- 已复核无门控 RITA macro F1=0.69467；SICA 0.5 门控后=0.60724，真实图平均误标面积从14.80%降到1.675%。即使后续定位器完美，当前硬门控图像级召回上限仍为307/383=80.16%。这些是已有子集的诊断，不据此拟合阈值或制定测试集路由。
- 推荐下一轮优先评估 TruFor 官方模型作为独立检测/定位/可靠性第二意见，保留 RITA。官方权重直链本次 HEAD HTTP200，Content-Length=260878690，未下载；README 明确输出 map/conf/score，专门检测头通过可靠性加权定位统计计算整图结果。可靠性图属于 TruFor 自身输出，不能未经训练/验证直接当作 RITA 的置信度过滤器。
- 修正一项潜在误解：不只是 IFF-Protocol 再训练版，官方 TruFor 的 `trufor_ph3.yaml` 也列 TRAIN=[IMD,FR,CA,COCO,RAISE]，官方 README 关联 CASIA2；因此选官方权重并不能自动使 CASIA/IMD 成为独立测试。CASIA 可用于工程对比，更强泛化结论需要核对训练曝光后另选来源。
- 对生成式局部修复/新编辑器的第二候选为 DetectiveSAM（ICLR2026），官方 Gertlek/DetectiveSAM 的推理代码及 Hugging Face 权重文件已核对，两个任务 checkpoint 各约297MB，另需 SAM2 base-plus 权重。它是无 VLM 的单图定位方案，不提供现成的可靠整图分类或任意操作识别，8GB 显存适用性尚未实测，不保证优于当前 RITA。
- 已进一步阅读 DetectiveSAM dataset/runtime：送入模型的是目标图与由目标图产生的扰动流，source 图主要保存展示；可只传目标图。后续若评测必须在未知图像模式下构造输入，不能向检测器提供真值或把成对原图演示当作真实单图输入条件。SOTA/适配权重与论文基线版本需分开记录。
- 其他候选排序：MVSS-Net++ 官方公开权重与整图/定位输出可作为额外对照，但其官方表格不显示对所有域稳定优于其他方法；BusterNet 可提供复制移动源/目标区域，但官方依赖TF1/Keras2，当前纯工程优先级较低，不作为零成本通用替换承诺。
- 建议路线为“消除单一硬否决的漏检放大 → 以现有框架比较 TruFor 的独立补漏与误报 → 若生成式修复仍弱，再测 DetectiveSAM”。用独立验证数据确定阈值/路由，在冻结后的评估数据上比较固定误报率下召回、正类像素F1/IoU/AUC、真实图误标面积、耗时/显存及漏检互补。禁止用两模型分数简单平均、盲目 OR 合并或新增 VLM 到第二人模块。
- 诊断脚本及结果位于 `work/model-selection-20261028/`；未训练、未安装候选、未修改 README。常规 research-lookup CLI 因账户额度不足失败，本次转用已连接网页搜索与官方仓库读取，不视为检索无结果。

## 票据擦除与短信时间替换样例选型（2026-10-28）

- 用户提供桌面 `1.png`（PNG/RGB/1280×1706，SHA256=2179f113e765c1dc0767ecbc8e3948bbd3cd5ede53480ecef907f95e758034c5）与 `f30c1199153e913bfcfb3ebfc19a0b5e.png`（PNG/RGB/1170×1205，SHA256=02caf55d01da67b3af38f471675b6272a427a802e543e4a2549397774cd0f3da）。用户说明第一张订单号后部被涂抹，第二张第二条短信正文时间改为21:16；用户报告第一张 SICA 判可疑、RITA 未能定位。本轮只读核对文件和官方材料，未重跑模型，不把用户观察记作本轮推理结果。传播/重拍链路未确认，不从 PNG 扩展名推断历史。
- 两种任务需区分：第一张是擦除/遮盖（异常可能位于无字背景），第二张是文字替换。只在现存文字框内分析会漏掉擦除；不能因为换成文档专用检测器就承诺同时解决。
- 优先测试文档专用候选 DTD（qcf-568/DocTamper）：官方 `models/Readme.md` 提供 DocTamper 与 T-SROIE 任务权重网盘入口；`models/tsroie/Readme.md` 与 `infer_sroie.py` 明确票据版 `dtd_sroie.pth`，通用示例 `dtd_doctamper.pth`。构造还需 `swin_imagenet.pt` / `vph_imagenet.pt`，不把骨干当成最终任务模型。下载入口已核对，权重未下载或加载。官方数据集不覆盖 AIGC 文字篡改，不宣传任意文档与编辑工具泛化。
- DTD 输入包含图像、JPEG DCT 和量化表；票据官方入口按原分辨率512块处理，不把整张长票据直接挤到512方图。两张用户文件为PNG，没有原生JPEG量化表；后续若重编码为JPEG，仅作为记录参数的模型输入副本，不能冒充恢复原始压缩证据，也不覆盖原文件。原图与派生副本/坐标变换分别记录。先不做美化、超分辨率或强锐化。
- 针对擦除区域，建议对 RITA 做保留分辨率的分块/上下文对照，并将 TruFor 作为独立视觉取证候选，不能仅裁现存文字框。针对文字替换优先比较 DTD 文档版/票据版；真正效果需由人工标注位置及未改原图对照确认。
- 补充候选 DAF（qcf-568/OSTF，AAAI2025）：官方 README 提供 ModelScope DanceText/DAF 与百度网盘任务权重（pths/dfpn/srnet.pth、pths/cascade/srnet.pth 等）及推理说明，覆盖多种场景文字编辑器；属于区域检测路线，不能把文本框直接称为逐像素篡改掩码。对无字擦除区域与银行短信截图未验证。未安装其MMDetection环境。
- 第二张上方18:50与正文21:16可作为OCR后时序疑点，但缺年份、消息来源与系统时间上下文，不能仅据此确认改图，更不能反推视觉模型已定位。原先余额6692.53与入账4293.08合计10985.61，金额一致不说明时间未修改。OCR/规则是独立证据，VLM仍归第四人。
- 本轮仅更新选型记录，未改APP/README、未下载权重、未训练或调阈值。research-lookup CLI再次额度不足，转用已连接GitHub官方资源读取；网页搜索工具返回空错误，不当作无候选证据。

## 比 DTD 更新的文档定位候选复核（2026-10-28）

- 用户明确 OCR 证据留给第四阶段，本轮第二人选型集中于视觉定位，不新增 OCR 内容规则或 VLM。术语区分：DocTamper 是数据集，DTD 是其对应检测模型。
- 新优先候选为 RiSE（论文 arXiv:2610.24480，2026-10-17 公开；官方 KahimWong/RiSE）。已读取 README、infer.py、rise/data.py、rise/checkpoint.py、模型与 rise9 配置。无OCR/VLM依赖的RGB版本采用DINOv3 ViT-L/16，RGB loader可读PNG，但要求预先裁成512×512；DCT版本另要求JPEG及量化表范围[0,63]。不把整图缩放Demo当作高分辨率自动定位方案。
- 已通过HF API核对 Jason37437/RiSE 实际文件：RiSE-1.pth=1359017491 bytes，RiSE-3.pth=1369658451，RiSE-9.pth=1401582675，RiSE-9-DCT.pth=1457021663，并有各JSON配置与checksums.json。仅列目录，未下载。源码提供strict加载和独立单图掩码/响应/专家选择输出，源码检查不等于本地加载成功。
- RiSE论文Table2同一Doc协议（训练DocTamper，跨域T-SROIE/OSTF/TPIC-13/RTM）的AvgC像素F1：DTD=.247，FFDN=.300，ADCD-Net=.450，RiSE-1=.542，RiSE-9 RGB=.611，RiSE-9-DCT=.616；RiSE-9 RGB RTM=.175，DCT=.218，仍然很低。以上是作者对比结果，不是本项目实测，不与CASIA现有数值跨协议比较；主表LPC选择不使用真值，附图另有oracle上界不能混用。域内FFDN高于RiSE，不能说RiSE所有数据集都最优。
- RiSE论文明确手工擦除/物理编辑覆盖不足、专门打印扫描鲁棒性未评估；第一张用户票据擦除正处于其薄弱范围。九专家并行测量为RTX4090占21691 MiB，本机8GB不能照搬；官方CLI提供sequential，但单专家或顺序模式本机显存/速度未测。建议先验证RiSE-1 RGB可运行，再比较RiSE-9顺序模式；LPC confidence是专家选择量，不作为图像真实性校准概率。
- ADCD-Net（ICCV2025，KahimWong/ADCD-Net）官方已公开ADCDNet.pth/docres.pkl下载入口，关注DCT错位与内容干扰，作为备选；官方实现还需PaddleOCR生成字符mask，需与用户OCR阶段边界说明，不把它描述为完全无OCR依赖。Doc协议跳过真实图，因此论文定位数值不能证明部署时真实文档误报率。
- DiffNet（ECCV2026/arXiv:2606.22285，Mohamed-Dhouib/DiffNet）论文在跨域/人工篡改上报告更强结果，但本次官方README仅写Code and pretrained weights will be released soon，不能列为当前可直接接入的公开权重模型。
- 其他近期工作：TAFE-Net（AAAI2026）论文可访问，但本轮未核实其官方任务权重；DCLNet有官方权重入口，针对区分脱敏与恶意篡改的任务，不直接套用到要求检出所有擦除的目标。未将这些论文宣传为已验证通用替换。
- 本轮修正网页工具调用字段为system2_search_query，已正常检索；此前空错误是调用字段错误，不能归因为服务无资料。未安装新模型、未改APP/README、未运行样例推理；只维护选型记录。

## RiSE-9 RGB 测试与 APP 接入（2026-10-28）

- 用户提供 `D:\SRDP\weights\RiSE\RiSE-9.pth` 并授权测试与接入。新建 `feature/rise-integration`，保留先前未提交的HiFi/界面/评测变更；未将这些历史改动重置或打包提交。未推送远端。
- 权重1401582675字节，SHA256=`dd7f28ffb9c68080bc26553b725140996315627ea43d711a94e8e522d10e282e`，与作者HF `checksums.json`一致。868项模型状态strict=True完整加载，无missing/unexpected；显式weights_only=True读取完整任务检查点，不跳过分类/掩码/专家参数。
- 官方源码固定 `83c1c2fc86eeb31ee2c50155e09826bdb780be1f`，位于 `.tools/rise-official`；`backend/rise/source-lock.json` 固定运行源码及rise9配置的LF归一化SHA256，兼容Git在Windows上的CRLF。`rise:setup`校验固定源码，不下载模型或依赖。Git首次克隆遇到本机失效127.0.0.1:10810代理，以该次命令的http.proxy空配置重试成功，未更改全局Git配置。
- 新增 `backend/rise/adapter.py`、`worker.py`、几何回归测试与 `backbone/config.json`，新增 `config/rise.example.json` / 本机忽略配置、`src/main/services/rise.ts`、setup与CLI脚本及 `tests/rise-smoke.mjs`。共享协议增加backend=rise，IPC白名单/路由、模式按钮、进度取消、叠加图/JSON展示均已接通；原有模式保留。
- 上游当前要求transformers5.7.0，本机EIT原4.51.3不改动；专用包隔离在 `.tools/rise-deps-v5`：transformers5.7.0、huggingface-hub1.7.2、tokenizers0.22.2、regex2026.4.4、efficientnet-pytorch0.7.1。宿主Python3.13.2、torch2.7.0+cu126、torchvision0.22.0、timm1.0.21，与上游原环境不完全相同，不称论文复现。准备期间曾在未使用的 `.tools/rise-deps` 下载4.57.6，实际worker仅指向rise-deps-v5。
- Meta HF架构配置直链要求登录（401）；本项目不下载受限骨干权重。依据Meta公开 `dinov3/hub/backbones.py::dinov3_vitl16` 与Transformers配置类保存离线架构参数（1024/24层/16头/4register/patch16/RoPE100等），由完整任务权重覆盖全部模型状态。HF_HUB_OFFLINE与TRANSFORMERS_OFFLINE开启，本地推理无远端服务。
- 输入保持原字节与统一SHA256，规范显示图为EXIF校正/sRGB/不缩放PNG。原分辨率512块、步长384、边界补齐，过小方向用边缘像素向右/下填充。官方九专家sequential、CUDAFP16autocast+FP32ADF、ghOrder5、noiseVariance0.5、LPC无真值选择。重叠像素均值后阈值0.5；这是工程分块策略，不冒充论文预裁剪协议。默认maxTiles128/超时600000ms，超限明确报错、不跳过像素。
- 输出包含原尺寸mask/response/overlay、完整float32响应、最多20个连通区域裁剪与v1.0报告；报告记录tile bbox、专家选择分数、来源/权重/依赖/精度/覆盖情况。像素统计和LPCconfidence均非整图真实性概率，decision=inconclusive、operationHints为空，不运行OCR/VLM/SICA门控。
- 两张用户图均真实执行，未将用户修改说明、标注或位置提供给模型。票据15块：worker56.412s、推理32.849s、15个连通区域、标记面积0.3444%；最大区域 `[570,447,161,44]`、5890像素，人工查看叠加图与订单号后涂抹相符。短信9块：worker40.535s、推理20.305s、5个区域、标记面积0.5990%；最大区域 `[466,716,128,47]`、5466像素，与第二条正文21:16相符。均有其他字符/UI上的额外标记，缺少完整像素真值及未修改对照，不算F1/IoU、准确率或跨域泛化结论。
- 两图峰值CUDA allocated均3013948928bytes≈2.81GiB；不含全部CUDA保留内存、Electron及其他进程。结果在 `work/rise-verification/receipt` / `sms`；两份证据包均通过现有校验器的Schema、文件哈希、像素尺寸、坐标与引用检查。源文件哈希保持不变。
- 工程验证：3项几何测试（全边界覆盖/像素坐标与填充/超限拒绝）、TypeScript检查、生产构建通过。真实RiSE APP Smoke7组检查通过：缺权重、哈希错误拒绝、868项严格真实推理、全图坐标与附件、非伪造整图分类、第一块实际推理后取消且无完成bundle、sandbox/contextIsolation保持且无React异常/HTTP。
- 回归：既有模拟15项、RITA入口5项、SICA6项、HiFi6项全部通过。此轮Electron测试使用仅disable-gpu的软件渲染参数，未使用no-sandbox；CUDA模型仍启用。旧测试的临时参数副本位于work/rise-regression，原有测试文件未改。正式start.cmd参数未修改。
- 新命令：`run.cmd run rise:setup`、`rise:infer -- --image <path>`、`smoke:rise -- --image <path>`（测试可追加--software-rendering）。说明及结果见 `docs/RISE_INTEGRATION.md`、`docs/RISE_EVALUATION.md`；README保持不变。发布包Python/权重分发、CPU性能、整图阈值与更大独立文档质量评测尚未验证。

## 篡改模块合并工作流规划（2026-10-28）

- 用户希望整合现有模型并认为HiFi-Net可以退出。已形成 `docs/MANIPULATION_WORKFLOW.md`，本轮为方案设计，未将APP切换为联合模式，也未删除HiFi代码、权重或历史结果；README不变。
- 推荐一个用户分析入口：内容类型可选普通照片/文档票据截图/不确定，初版默认不确定，不新增自动域分类器。SICA负责独立通用整图筛查，普通照片主要定位RITA、文档主要定位RiSE，不确定按顺序运行两者并保留各自结果。
- SICA阴性不否决定位；GPU模型串行加载释放，模型失败与正常未检出分开，允许保留部分完成证据。按类型分析后可补充运行另一定位器，形成新快照，路由有效性后续独立验证。
- 统一证据汇总而非分数/掩码融合：各模型独立分数、区域和来源可追溯，不强制OR/平均，不把两模型重叠当作两份独立事实。展示定位状态与整图判断分开，尚无校准依据时顶层score=null/decision=inconclusive。
- 对第四人提供单一manipulation报告及附件，内部保留原始模型报告；公共任务根目录下重写附件URI并去重原图，证据引用需全部可解析。OCR与VLM仍在第四阶段，AIGC分类由第三人独立负责，SICA的fake标签不能等同局部篡改。
- 建议实施顺序为统一任务编排、证据汇总、单入口界面、联合Smoke与独立质量评测。本轮未执行新的推理或功能测试；现有独立模式的通过记录不冒充联合流程验证。

## v0.2.0 联合流程与简明 UI / JSON（2026-10-28）

- 用户批准按方案实现新版，后续明确UI只需简洁易操作，报告有价值但不繁琐。工作分支 `feature/unified-workflow`；版本与package-lock同步为0.2.0。保留此前未提交的模型接入/评测变更，未重置、未推送远端。README按既有要求保持不变。
- 默认backend=workflow，内容选择为下拉框：photo运行SICA+RITA，document运行SICA+RiSE，unsure（默认）运行SICA+RITA+RiSE。SICA不作定位门控；GPU子进程按序执行并等待退出。HiFi仅保留历史调试入口，不参与联合流程。
- 新增 `workflow.ts` / `workflow-policy.ts` / `evidence-bundle.ts` / `manipulation-summary.ts`；扩展类型化IPC第四参数WorkflowOptions，主进程白名单核验类型与补充任务ID。AnalysisSession保存最近结果，拒绝跨图、跨内容类型或失效的补充引用。补充任务只执行未完成模型，复用完成证据，写入独立新快照。
- 单模型失败不阻断后续模型；返回completed/partial/failed并保留错误。所有模型失败时不伪装未检出，v1.0报告status=failed/result=null。取消杀死当前子进程、停止队列，run.json记录cancelled；清除该次完成report/bundle/analysis文件，保留可追溯中间产物。补充取消不替换上一报告。
- 公共任务目录为 `work/analysis-runs/<taskId>`。保留一次原始字节和规范显示图；汇总时核对每个模型的imageId/哈希/尺寸及文件哈希，重写附件URI并去重公共图片。原始模型报告位于detectors/<model>/report.json，完整掩码与区域来源独立，不做分数平均/掩码并集。已完成原始模型子任务仍按既有目录保存。
- `bundle.json` / `report.json`继续遵循v1.0，顶层只有一个manipulation模块报告，decision=inconclusive/score=null。detectors只放简要模型状态与结果，源码文件清单、逐块专家分数等只保留在内部原始报告；不将原始追溯ID写成不能解析的inputReportIds。
- 新增默认轻量视图 `analysis.json`、`schemas/manipulation-summary.schema.json` 和 `report:validate`。保留图片身份/坐标、筛查分数及校准状态、模型版本与权重哈希、定位状态/掩码/响应/区域裁剪、证据引用、分歧、简短限制与audit指向。排除base64图片、源码清单、逐块专家分数和运行路径日志。短信样例主报告3833字节，补充RITA后6995字节（非压缩；对应完整bundle为19413/39500字节），不是对所有图片体积的保证。
- UI已简化：移除无实际导航用途的侧栏、联合模式的重复步骤条和模型工具栏；图片区内选择内容类型后开始分析。结果分整图筛查与局部定位，完成定位来源可切换，原图/叠加图可切换，裁剪/检测详情/JSON默认折叠。单模型入口收到底部开发调试。新增「打开报告文件夹」按钮；IPC只允许打开当前最近任务的受控analysis-runs目录，不接收任意路径。
- 新组件 `WorkflowReport.tsx` 默认展示简明JSON。原始筛查分数与完整路径留在检测详情，避免把未经校准分数当作确定结论。未运行OCR/VLM、第三人AIGC或来源凭证模块；最终综合判断仍待第四阶段。
- 工程测试9组通过（合成适配器，只验证编排）：SICA阴性仍定位、部分失败、串行调度/单模块与附件去重、轻量报告无诊断杂项/内嵌图片、补充只跑缺失模型、全失败状态、取消停止队列与不生成完成包、附件损坏拒绝、失效补充引用拒绝。
- 真实Electron联合Smoke8组通过：默认入口、SICA+RiSE文档路由、补充只跑RITA并复用前两者、非法选项/失效引用拒绝、缺SICA仍保留RITA、真实SICA阴性篡改样例仍RITA定位并提示分歧、真实RiSE首块后取消且无完成包、最小窗口及sandbox/contextIsolation/无渲染异常与HTTP。报告Schema、哈希、规范坐标、裁剪像素、相对路径和证据引用均通过校验。真实样例使用用户短信图及既有CASIA拼接图，不用于调阈值或宣称泛化。
- 已修正一次可视回归发现的预览溢出：为规范图片预览设定容器内尺寸，1400与1060宽度均验证无横向溢出、图片不覆盖文件信息。`workflow-layout.mjs`回放已验证的真实证据进行纯展示回归，未冒充重新推理。
- 既有回归：模拟15项、RITA入口5项、SICA6项、HiFi历史6项通过；独立入口测试已适配折叠调试区。Windows测试使用--disable-gpu的软件渲染参数，未关闭sandbox；模型仍用CUDA。源码类型检查与生产构建通过。
- 说明为 `docs/WORKFLOW_V02.md`，计划文档状态已更新。当前交付是可由start.cmd运行的源码开发版，发布包Python/权重分发、CPU性能与大规模独立文档质量验收仍不在已完成项中。
- 最终默认 `start.cmd` 启动测试3项通过（未追加disable-gpu）：npm predev运行时准备、electron-vite真实桌面进程启动、React工作台与preload就绪。最终UI构建及1400/1060布局回归再次通过；README无差异。

## v0.2.0 发布整理与增量升级说明（2026-10-28）

- 用户明确授权更新README、整理提交推送、删除无用内容。本轮沿用既有远端 `origin/czh` 目标，不修改main。发布整理在 `feature/unified-workflow` 完成后快进整合至czh。
- README已从旧的“全模拟基础框架”说明改为v0.2.0，重点提供从基础版增量升级：fetch/switch/pull、npm ci、可复用Python环境、项目.venv方案、隔离RiSE依赖、三个setup命令、官方权重入口、只创建缺失本机配置和启动/校验步骤。也说明无.git/仅exe用户需要克隆源码目录，不能直接替换asar。
- 新增 `backend/requirements-app.txt` / `requirements-evaluation.txt`，区分APP公共依赖与可选离线评测依赖；.venv加入Git忽略。权重、私有配置、图片、生成结果、外部模型源码与npm包不纳入提交。
- 根据用户清理要求，已移除HiFi-Net前后端运行入口、backend/hifi源码、配置模板、CLI、测试和过时接入说明；保留 `docs/HIFI_EVALUATION.md` 并标记历史状态。未提交的旧HiFi源码先归档到Git忽略的 `work/cleanup-20261028/retired-hifi-source.zip`，可供回查。
- RITA离线评测依赖的二分类指标和EXIF标注转换移入 `backend/common/evaluation.py`；3项公共评测测试通过，RITA evaluate --help可用，不再依赖HiFi代码。当前APP只含workflow/mock/sica/rita/rise入口。
- 已删除本轮产生且已被正式实现替代的scaffold/probe/UI重写脚本与临时回归脚本。清理前检查固定绝对路径处于D:\SRDP并记录16个权重/配置/结果保护文件的哈希，清理后逐一核验一致；所有权重及数据、正式测试结果保留。
- 未使用的 `.tools/rise-deps`（4.57.6，约115MB）递归删除被自动审批策略拒绝，保持原位并继续Git忽略；实际运行配置指向 `.tools/rise-deps-v5`，不受影响。未通过其他方式绕过删除限制。
- 清理后类型检查、生产构建、9组联合编排测试、RITA7项/SICA4项/RiSE3项Python测试通过；公共依赖清单pip dry-run可解析，未修改本机EIT包。联合Smoke已调整为无需输入图像必须存在可疑区域，取消测试使用明确的多图块工程测试图。
- 发布提交 `764ac72` 已快进整合至本地czh并成功push至origin/czh，远端ls-remote核对SHA为 `764ac7259491bc14e6223cd7964a2e6caacd0e44`，main未修改。首次GitHub直连超时，使用本机现有Git代理配置重试成功，未改写用户全局代理。
- 增量复现已在独立临时worktree验证：从基础版 `091d906` 安装npm依赖，快进到 `764ac72` 后再次npm ci，类型检查、9组编排测试、构建与真实start.cmd启动均通过。配置生成命令仅创建缺失项、保留已有项的行为已核对；未重装或修改本机模型Python环境。结果存于 `work/cleanup-20261028/upgrade-verification.json`，临时worktree在保存结果后通过git worktree remove移除。
- 清理后的真实联合Smoke8组、1400/1060布局检查、模拟15项和默认start.cmd启动3项通过。当前仓库工作区已整理为可提交源码，权重、图片、本机配置、运行结果均保持Git忽略。本条收尾文档单独提交并同步到czh。
