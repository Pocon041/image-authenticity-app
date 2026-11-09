# image-authenticity-app

基于本地推理的图像真实性分析桌面应用。集成图像来源检查、AI 生成检测、照片与文档篡改定位，以及视觉语言模型解释，支持查看定位结果和导出结构化证据报告。

**当前版本 v0.2.2 · Windows x64 · Electron + React + TypeScript + Python**

[下载安装器](https://github.com/Pocon041/image-authenticity-app/releases/download/v0.2.2/SRDP-Setup-0.2.2-x64.exe) · [版本发布](https://github.com/Pocon041/image-authenticity-app/releases/tag/v0.2.2) · [安装说明](docs/INSTALLATION.md) · [开发配置](docs/DEVELOPMENT.md) · [报告协议](docs/REPORT_PROTOCOL_V1.md)

## 功能

- **来源分析** — 读取 EXIF、XMP、IPTC、C2PA 来源凭证，检查可见文字水印和已支持的隐形水印载荷。
- **真实性筛查** — SICA 提供通用整图真假分类，FSD 提供 AI 生成检测。
- **篡改定位** — RITA 处理普通照片，RiSE 处理文档、票据和截图，输出像素掩码、响应图和区域信息。
- **自动路由** — 根据内容选择定位器，支持手动指定和补充检查。
- **可解释输出** — 结合来源记录、检测结果、区域观察与证据关系，生成重点位置和自然语言说明。
- **结果回看** — 支持原图与定位结果切换、区域裁剪、真实进度、取消和部分失败处理。
- **报告导出** — 同时保留简明 JSON、完整证据包、模型原始结果和解释记录。

分析流程为 **导入图片 → 来源检查与规范化 → 内容路由 → FSD → SICA → RITA / RiSE → 证据汇总与解释**。SICA 未报警时仍继续定位，各定位器的结果独立保留。

## 安装

### 下载

下载 [Windows x64 安装器](https://github.com/Pocon041/image-authenticity-app/releases/download/v0.2.2/SRDP-Setup-0.2.2-x64.exe)，运行安装向导后，从桌面或开始菜单打开应用。校验文件位于 [v0.2.2 发布页](https://github.com/Pocon041/image-authenticity-app/releases/tag/v0.2.2)。

GitHub 提供的安装器约 125 MB，包含桌面应用、Electron 和本项目后端脚本。真实检测还需要 Python 推理环境、模型源码、权重及本地 VLM。已有环境可以直接接入，开发者也可以按[开发配置](docs/DEVELOPMENT.md)自行准备。

### 首次启动

1. 打开“本地运行环境”，选择模型与报告目录，例如 `D:\SRDP-Data`。
2. 如果安装包附带 `runtime-bundle`，保持它与安装器相邻。首次选择新数据目录后，应用会自动校验和展开资源、生成配置，并启动本地解释服务。
3. 如果已配置源码环境，直接选择项目根目录，复用已有配置与权重。
4. 选择图片，点击“开始分析”。

自动配置支持取消和重试。使用随包运行资源时，用户无需额外安装 Python、Node.js、Git 或 Ollama。资源压缩后约 10.23 GB，展开后约 16.41 GB，当前 GitHub Release 附件提供的是安装器，模型运行资源需另行取得或自行构建。

## 系统要求

以下为完整检测与本地解释流程的建议配置。

- **操作系统** — Windows 10/11 x64，建议使用已更新的系统版本。
- **处理器** — Intel 或 AMD x64 多核处理器。
- **内存** — 建议 16 GB 以上，推荐 32 GB。
- **显卡** — 推荐 NVIDIA GPU，8 GB 或更多显存。已在 RTX 4060 Laptop 8 GB 上完成检测、定位和本地 2B VLM 联调。
- **驱动** — GPU 路线需要兼容随包 PyTorch CUDA 12.6 的 NVIDIA 驱动。CUDA 运行库随 PyTorch 提供。
- **存储** — 建议使用 SSD。实际运行目录预留至少 25 GB。安装包、资源解压副本与运行目录放在同一磁盘时，首次安装建议预留 50 GB。
- **网络** — 下载软件、依赖和权重时需要网络。完整运行资源准备好后，默认本地流程可离线使用。
- **显示** — 应用最小窗口尺寸为 1060 × 740，建议使用 1920 × 1080 或更高分辨率。

无可用 CUDA 设备时，自动配置会为检测器选择 CPU 路线。CPU 端到端性能和其他显卡组合尚未系统评测。以上内存、显存为建议配置，图片尺寸和后台程序会影响实际占用。

## 使用

1. 导入 PNG、JPG、JPEG 或 WebP 图片。
2. 选择“自动识别”，或手动指定普通照片、文档、混合内容。
3. 查看来源检查、模型检测和解释生成进度。
4. 完成后在左侧切换原图与各定位器结果，在右侧查看结论、重点位置和解释。
5. 展开“检测详情与报告”查看模型分数，或打开报告文件夹。

当前每次处理一张图片，支持最大 20 MB、6000 万像素的输入。RiSE 默认最多处理 128 个图块，超限会提示错误。

本地解释使用 Qwen3-VL-2B-Instruct。自行配置的 Ollama 默认连接 `127.0.0.1:11434`，由应用管理的随包服务使用 `127.0.0.1:11435`。云端兼容接口可通过解释配置指定。

## 报告

每次联合分析写入所选运行目录下的 `work/analysis-runs/<taskId>/`。

```text
<taskId>/
├─ analysis.json              简明检测报告
├─ bundle.json                完整证据包与附件索引
├─ report.json                篡改检测汇总
├─ reports/
│  ├─ provenance.json         元数据、来源凭证与水印
│  └─ explanation.json        最终解释和模型调用记录
├─ images/                    原文件副本与规范显示图
└─ detectors/                 各模型报告、掩码、响应图与裁剪
```

原文件按字节保留，公共 `imageId` 由原文件 SHA-256 生成。全部区域坐标映射到 EXIF 方向校正、sRGB、未缩放的规范显示图。报告字段与引用约定见[报告协议](docs/REPORT_PROTOCOL_V1.md)。

## 开发

需要 Git 和 Node.js 22.12+，推荐 Node.js 24 LTS。

```powershell
git clone https://github.com/Pocon041/image-authenticity-app.git
cd image-authenticity-app
.\run.cmd ci
.\start.cmd
```

先在“开发与单模型调试”中选择模拟流程，可检查选图、IPC 和结果展示。接入真实模型的 Python 环境、权重下载及配置步骤见[开发配置](docs/DEVELOPMENT.md)。

主要检查命令如下。

```powershell
.\run.cmd run typecheck
.\run.cmd run build
.\run.cmd run test:workflow
.\run.cmd run test:protocol
.\run.cmd run test:confidence
.\run.cmd run test:explanation
.\run.cmd run test:evidence-links
.\run.cmd run smoke
```

`test:*` 和模拟 Smoke 主要检查工程行为。真实推理检查需要已就绪的模型环境，入口见[开发配置](docs/DEVELOPMENT.md#验证真实推理)。

### 构建安装包

```powershell
# 生成 Windows x64 安装器
.\run.cmd run package:win

# 生成可直接运行的应用目录
.\run.cmd run package:dir
```

产物位于 `dist/v<版本>/`，安装器旁附带 `SHA256SUMS.txt`。需要构建含运行资源的安装包时，按[安装说明](docs/INSTALLATION.md#构建含运行资源的安装包)准备构建机并收集资源。

### 项目结构

```text
src/main/       Electron 主进程、任务编排、模型适配与证据汇总
src/preload/    受控的桌面 IPC 桥接
src/renderer/   React 界面和交互状态
src/shared/     共享类型、协议与支持度计算
backend/        Python 推理与来源检查
config/         示例配置与本机配置入口
schemas/        JSON Schema
docs/           安装、开发和协议文档
scripts/        依赖准备、校验与打包
tests/          单元、协议和桌面 Smoke 检查
```

`main` 维护共享版本。协作前阅读 `AGENT.md`。权重、数据、生成结果和 `*.local.json` 保存在本地，提交前请检查文件范围。

## 常见问题

- **首次启动没有自动配置按钮** — 检查是否取得了配套运行资源，在“本地运行环境”中选择 `runtime-bundle` 文件夹。
- **模型未就绪** — 确认运行目录正确，并检查对应 `config/*.local.json` 的 Python、模型源码和权重路径。
- **本地解释服务不可用** — 随包服务可重新执行环境检查。自行配置时检查 Ollama 是否运行、模型标签和 `host` 是否正确。
- **检测较慢或显存不足** — 关闭其他 GPU 密集程序，确认驱动可用，并检查是否正在使用 CPU。高分辨率文档的图块数量也会影响耗时。
- **源码启动出现 `Electron uninstall`** — 执行 `.\run.cmd run runtime:ensure -- --repair`。
- **Windows 显示未知发布者** — 当前安装器未签名，可使用发布页的 SHA-256 校验文件核对下载内容。

## 模型与许可

项目代码采用 [MIT License](LICENSE)。模型来源包括 [SICA](https://github.com/venus-guangjian/SICA_OpenMMSec)、[RITA](https://github.com/scu-zjz/RITA)、[RiSE](https://github.com/KahimWong/RiSE)、[FSD](https://github.com/ductai199x/Forensic-Self-Descriptions-CVPR25) 和 [Qwen3-VL](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF)。第三方代码、权重和依赖按各自许可使用，其中 FSD 使用 CC BY-NC-SA 4.0，含非商业使用限制。

检测结果与解释用于辅助分析。当前分数尚未统一校准为正确率，定位可能误报，VLM 也可能误认目标或推测错误手法。样例联调通过与模型准确率评估分别记录。
