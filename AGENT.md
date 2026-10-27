# SRDP 项目开发约定

GitHub 仓库名采用 `image-authenticity-app`，中文项目名称为“图像真实性分析桌面应用”。本地开发目录保留 `D:\SRDP`。
远程仓库为 `https://github.com/Pocon041/image-authenticity-app`，主分支为 `main`。
当前协议和联调工具的共享变更按用户要求在 `czh` 分支维护并推送，不直接修改远端 `main`。后续各模块的开发人员应创建独自的分支并提交

## 项目目标与当前范围

开发基于本地推理的图像真实性分析桌面 APP。本项目侧重工程集成，不开发视觉取证算法。

当前阶段只实现端到端 Smoke 闭环：选择本地图片 → 预览 → 模拟分析 → 显示模拟描述。
不接入检测模型、语言模型、远程 API 或真实推理。模拟内容必须始终明确标注，不能展示伪造的真实检测结论或置信度。

阶段更新：用户现已授权开始第二人模块的 RITA 预训练推理接入验证，允许独立的本地真实推理路径；原模拟模式继续保留。没有授权训练新模型或接入 VLM。缺少权重时不得伪造真实报告或静默回退模拟。
后续授权更新：用户提供 SICA 权重并要求真实二分类接入及 CASIA v2 检查；允许独立 SICA 路径，仍不训练、不接入 VLM。仅下载 HiFi-Net 文件不代表已经接入该模型。

## 维护要求

- 本文件是项目约定的唯一正文。每次改变框架、目录、运行命令、接口或阶段范围时，同步更新本文件。
- 每次交付前更新“当前状态”，记录已实现内容、实际验证结果和已知限制，不将计划记为完成。
- 用户的新要求优先于这里已有的约定。

## 架构

- Electron 主进程：本地文件选择、图片检查、分析服务调用和应用生命周期。
- React + TypeScript 渲染进程：中文界面、预览、交互和结果展示。
- preload：通过 contextBridge 暴露最小范围的类型化 IPC 接口。
- 分析服务：用统一接口隔离模拟实现；未来再替换为本地推理适配器。
- `AnalysisSession` 管理当前图片、互斥任务和取消；模拟服务经回调报告任务进度。
- 主进程保留原始文件路径，界面只接收预览 DTO。界面组件与 `useAnalysisWorkspace` 交互状态分开。
- 跨进程调用统一使用结果响应与稳定错误代码，进度携带任务 ID，监听器必须可取消订阅。
- RITA 接入前没有 Python 服务；当前按用户授权新增 `backend/rita/` 单图子进程，不提前添加其他模型或 VLM 后端。
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
- `<配置的Python> backend/sica/evaluate.py --casia-root <划分清单目录> --output <目录>`：只读运行本地 CASIA 子集，阈值固定 0.5，记录每图预测和分组统计，不声称独立泛化。

使用 `package-lock.json` 固定依赖。需要 Node 22.12+，推荐 Node 24 LTS。不要修改系统 Node 来满足本项目。
修改跨进程协议或核心交互后执行类型检查和主流程 Smoke 测试。Smoke 测试只模拟文件选择对话框，实际文件读取、解码、IPC、模拟分析和 React 展示均走真实应用路径。

用户明确要求当前优先搭建并跑通大框架；具体 Bug、打包截图和交付细节先记录，避免偏离主流程。后续独立安排真实能力与发布验收。

用户要求本轮暂不更新 README；继续保留其新用户安装与启动说明。报告协议和联调说明放独立文档，每次更新同步维护本文件。

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
