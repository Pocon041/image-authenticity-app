# image-authenticity-app

基于本地推理的图像真实性分析桌面应用。当前源码版本为 **v0.2.0**：在之前发布的 Electron 基础框架上，增加了 **SICA 整图筛查、RITA 图像定位、RiSE 文档定位，以及统一 JSON 报告**。

正常使用流程：**选择图片 → 选择图片类型 → 开始分析 → 查看可疑区域与报告**。

- 普通照片：SICA + RITA。
- 文档、票据和截图：SICA + RiSE，包括拍摄的小票。
- 不确定或混合内容：依次运行 SICA、RITA、RiSE，保留各模型的独立结果。

SICA 判真也继续定位；某个模型失败时保留其他模型的结果。支持取消、补充检查、原图/叠加切换及区域裁剪。HiFi-Net 已退出当前应用代码，历史效果记录保留在 [HIFI_EVALUATION.md](docs/HIFI_EVALUATION.md)。

本阶段负责视觉检测与工程接入；OCR、来源凭证、AI 生成专用模块和最后的 VLM 综合解释尚未整合。模型标记是待核查线索，不能直接视为已证实篡改，当前不输出未经验证的综合真假概率。

## 已安装基础版：如何增量升级

以下步骤针对 **Windows 10/11 x64 源码版**。原来的 Node.js、Git 和 Electron 框架可以继续使用；从基础版升级主要增加模型源码、Python 环境、权重和本机配置。

### 1. 更新代码与前端依赖

关闭旧 APP 及其开发终端，在原项目目录打开 PowerShell：

```powershell
cd D:\SRDP  # 改为你自己的项目目录
git status --short
git fetch origin
git switch czh
git pull --ff-only origin czh
.\run.cmd ci
```

当前可复现的新版本在 **`czh` 分支**，不要求更新 `main`。如果 `git status` 显示你修改过源码，先保存或提交自己的工作，再切换/更新分支；不要用 `git reset --hard` 或 `git clean` 强行覆盖。

`run.cmd ci` 按锁文件更新 npm 依赖，不会删除 `weights/`、`config/*.local.json`、`.tools/` 或 `work/`。Electron 运行时若需补齐，会在启动前自动准备，并可复用本机缓存。

如果原来使用的是 ZIP 或单独的 `SRDP.exe`，没有 `.git`，请将新版源码克隆到新目录，不要直接替换旧程序的 `app.asar`：

```powershell
git clone --branch czh https://github.com/Pocon041/image-authenticity-app.git image-authenticity-app-v02
cd image-authenticity-app-v02
.\run.cmd ci
```

已有权重可以在配置中填写其原来的绝对路径，无须再下载或复制。已有 Python 环境也可以复用；已有本机配置不要覆盖。当前交付是源码运行版，尚未把 Python 和权重打进安装包。

### 2. 准备 Python 推理环境

如果已经配置过本项目三个模型，直接沿用现有环境，确认配置路径仍正确；只安装缺少的包并继续下面的源码检查。只有基础版、尚无 Python 环境的用户，可以安装 [Python 3.13 x64](https://www.python.org/downloads/windows/)，然后在项目根目录创建本地环境：

```powershell
py -3.13 -m venv .venv
$modelPython = (Resolve-Path .venv\Scripts\python.exe).Path
& $modelPython -m pip install --upgrade pip
& $modelPython -m pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cu126
& $modelPython -m pip install -r backend/requirements-app.txt
& $modelPython -m pip install --no-deps --target .tools/rise-deps-v5 -r backend/rise/requirements-isolated.txt
```

该组合面向 NVIDIA CUDA 显卡。请安装兼容的显卡驱动；PyTorch wheel 自带 CUDA 运行库，通常不必另外安装完整 CUDA Toolkit。实测为 RTX 4060 Laptop 8 GB，Python 3.13.2、torch 2.7.0+cu126、torchvision 0.22.0。CPU 性能与其他显卡尚未完成验收；这也不是作者论文环境的逐项复现。

RiSE 使用的 Transformers 5.7.0 等专用包隔离在 `.tools/rise-deps-v5/`，不会替换其他模型环境中的 Transformers。这里的 `--no-deps` 依赖前一条命令已装好的公共包，两步都需要执行。若本机已有此隔离目录且工作正常，不需要重复安装。

检查 PyTorch 能否使用显卡：

```powershell
& $modelPython -c "import torch; print(torch.__version__); print('CUDA:', torch.cuda.is_available())"
```

只有运行离线数据集评测时，才需要额外安装 `backend/requirements-evaluation.txt`。APP 单图分析不要求下载 CASIA、IMD2020 或任何训练数据集。

### 3. 增量准备固定版本的模型源码

```powershell
.\run.cmd run rita:setup
.\run.cmd run sica:setup
.\run.cmd run rise:setup
```

这些命令只准备并校验固定版本源码；已有正确文件会复用，**不会自动下载任务权重或安装 Python 包**。首次执行需要访问 GitHub。运行推理时不需要调用云端模型服务。

### 4. 放置权重

从各模型官方入口下载，按下列位置放置；已下载过的文件直接复用：

```text
weights/
├─ rita/rita_catnet.pth
├─ sica/sica_weight_train.pth
└─ RiSE/RiSE-9.pth
```

- **RITA**：[官方仓库](https://github.com/scu-zjz/RITA)，[官方权重分享](https://pan.baidu.com/s/1W1HC4_mn044ub2NLJLSeQQ?pwd=43nn)，提取码 `43nn`，选择 `rita_catnet.pth`。
- **SICA**：[官方仓库](https://github.com/venus-guangjian/SICA_OpenMMSec)，[权重目录](https://drive.google.com/drive/folders/1HQ2tj_1aeeoWP7meAf01fqVHmsAcEGPU)。配置模板默认 `sica_weight_train.pth`。若使用 `sica_weight_full.pth`，请同时设置配置里的 `checkpointPath` 和 `checkpointVariant="full"`。full 使用过完整训练/验证/测试数据，相关数据上的结果不作为独立泛化证据。
- **RiSE**：[官方仓库](https://github.com/KahimWong/RiSE)，[官方任务权重](https://huggingface.co/Jason37437/RiSE/tree/main)，选择 **`RiSE-9.pth`，RGB 版**。不要换成 `RiSE-9-DCT.pth`；两者输入和配置不同。模板内已经固定作者公布的 RiSE-9 校验值。

本仓库不分发模型权重。第三方代码、权重和数据按各自的许可使用，本项目许可证不自动覆盖它们。

### 5. 生成或调整本机配置

如果采用上面的 `.venv`，可以运行以下命令，仅创建不存在的配置，保留现有成员的本机设置：

```powershell
foreach ($modelName in @('rita', 'sica', 'rise')) {
    $localConfig = "config/$modelName.local.json"
    if (-not (Test-Path -LiteralPath $localConfig)) {
        $modelConfig = Get-Content "config/$modelName.example.json" -Raw | ConvertFrom-Json
        $modelConfig.pythonPath = '.venv/Scripts/python.exe'
        $modelConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $localConfig -Encoding utf8
    }
}
```

如复用其他 Python 环境，将三个文件的 `pythonPath` 改为该环境的完整 `python.exe` 路径。这样双击启动也能找到它，无需先激活终端环境。权重也可以放在其他盘，在 `checkpointPath` 中填写实际路径。相对路径均相对于项目根目录。

本机配置、Python 环境、权重与结果均被 Git 忽略；不要将个人盘符路径写入共享的 `*.example.json`。

### 6. 启动并验证

```powershell
.\start.cmd
```

之后直接双击同一个 `start.cmd` 即可。选择图片与内容类型，点击开始分析。首次分析包含导入 Python 和加载权重的时间；模型依次运行，避免争抢显存。

只想确认框架启动、暂时没有权重时，打开底部「开发与单模型调试」选择「模拟流程」。模拟输出始终明确标注，不会冒充真实检测；联合模式缺少模型时会报告失败或部分完成。

## 报告在哪里

联合任务保存在 `work/analysis-runs/<taskId>/`，APP 中可点击「打开报告文件夹」。

- **`analysis.json`**：默认阅读及后续综合分析的简明报告，包含图片身份、模型来源、状态、分数、区域、掩码/裁剪路径、证据引用、分歧和限制。
- **`bundle.json` / `report.json`**：兼容 v1.0 的完整证据包与单一篡改模块报告。
- **`images/`、`detectors/`**：原文件副本、规范显示图、掩码、裁剪、浮点响应及内部诊断。

源码清单、逐块专家分数和运行日志不塞入简明报告。交给第四阶段时保留整个目录；JSON 中的图片路径需要实际加载才能成为 VLM 的视觉输入。

更多字段与工作流说明：[WORKFLOW_V02.md](docs/WORKFLOW_V02.md)、[报告协议](docs/REPORT_PROTOCOL_V1.md)。

## 从零安装

先安装 [Git for Windows](https://git-scm.com/downloads/win) 和 [Node.js 24 LTS](https://nodejs.org/en/download)，确认 `git --version`、`node --version` 可用，然后按上文克隆 `czh` 分支并完成 Python、源码、权重与配置步骤。Node 最低要求 22.12；新机器不依赖开发者私有的 `.tools/` 内容。

首次 npm 安装和 Electron 准备需要网络；配置完成后的图片检测在本机进行。开发模式的 `127.0.0.1:5173` 仅是桌面界面的本机 Vite 服务，使用入口是 Electron 窗口。

## 检查与排错

```powershell
.\run.cmd run typecheck
.\run.cmd run build
.\run.cmd run smoke:startup
.\run.cmd run test:workflow
.\run.cmd run smoke:workflow -- --image C:\path\to\image.png --software-rendering
.\run.cmd run report:validate -- C:\path\to\task\analysis.json
```

`test:workflow` 使用合成适配器验证工程逻辑；`smoke:workflow` 需要真实权重和本机 Python。`--software-rendering` 只影响测试窗口的渲染，模型仍使用 CUDA，不关闭 sandbox。测试与样例不证明检测准确率或跨域泛化。

- **`Electron uninstall`**：运行 `.\run.cmd run runtime:ensure -- --repair` 后重新启动。
- **`npm.ps1` 被执行策略拦截**：使用 `run.cmd` 或 `npm.cmd`，不必修改系统执行策略。
- **模型未就绪/缺权重**：检查对应 `config/*.local.json` 的 Python、源码和权重路径；Git 更新不会替你下载权重。
- **RiSE 依赖报错**：确认专用包安装到 `.tools/rise-deps-v5`，配置的 `dependencyPath` 指向同一目录。
- **5173 端口占用**：用 Ctrl+C 关闭上一次开发终端，再启动。

图片保持原始字节，定位坐标采用 EXIF 校正、sRGB、未缩放的显示图。当前一次处理一张图片，最大 20 MB、6000 万像素；RiSE 默认最多128个图块，超限会明确报错。

## 工程结构与协作

- `src/main/`：文件读取、IPC、统一任务编排、Python 子进程与证据汇总。
- `src/preload/`、`src/shared/`：最小桌面桥接、跨进程类型。
- `src/renderer/`：React 工作台。
- `backend/rita`、`sica`、`rise`：三个模型适配；`backend/common` 为共享评测工具。
- `config/`、`schemas/`、`docs/`：配置模板、报告约束和模块说明。
- `scripts/`、`tests/`：运行准备、验证与真实桌面测试。

阅读 `AGENT.md` 的四人共用规则和 `AGENTS.md` 的第二人模块说明；模块独有记录写AGENTS.md，共享协议与交接规则写AGENT.md。公共图片身份、坐标和证据语义不得由单模块自行改变。`weights/`、`work/`、`.tools/`、`.venv/`、`node_modules/`、`out/`、`dist/` 和本机配置不提交。发布包中的 Python/权重分发、CPU 路径及更大规模独立质量评测尚未验收。

`yr_explanation`分支的四模块协议类型已合并，解释报告引用可与当前证据包衔接；VLM推理和解释界面尚未提交。接口约定见 [EXPLANATION_HANDOFF.md](docs/EXPLANATION_HANDOFF.md)。
