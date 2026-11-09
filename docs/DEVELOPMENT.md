# 开发与模型配置

本文面向从源码运行、配置已有推理环境和扩展模型适配器的开发者。

## 前置工具

- Windows 10/11 x64。
- Git。
- Node.js 22.12+，推荐 Node.js 24 LTS。
- 视觉检测环境使用 Python 3.13。来源检查和 FSD 已验证环境使用 Python 3.12，分别隔离安装。
- GPU 推理需要 NVIDIA 驱动。项目当前视觉环境使用 PyTorch 2.7.0+cu126、torchvision 0.22.0。

## 启动桌面框架

```powershell
git clone https://github.com/Pocon041/image-authenticity-app.git
cd image-authenticity-app
.\run.cmd ci
.\start.cmd
```

打开“开发与单模型调试”并选择“模拟流程”，可以检查图片导入、IPC、进度和结果展示。准备真实环境后再选择联合分析。

## 视觉检测环境

使用独立的 `.venv-vision` 安装 SICA、RITA 和 RiSE 的公共依赖。来源环境固定在 `.venv`，两者分开可避免 Pillow 和 OpenCV 版本相互覆盖。

```powershell
py -3.13 -m venv .venv-vision
$visionPython = (Resolve-Path .venv-vision\Scripts\python.exe).Path
& $visionPython -m pip install --upgrade pip
& $visionPython -m pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cu126
& $visionPython -m pip install -r backend/requirements-app.txt
& $visionPython -m pip install --no-deps --target .tools/rise-deps-v5 -r backend/rise/requirements-isolated.txt
& $visionPython -c "import torch; print(torch.__version__); print('CUDA:', torch.cuda.is_available())"
```

RiSE 的 Transformers 等依赖安装在 `.tools/rise-deps-v5`，以适配现有其他检测器。CPU 环境需选择兼容的 PyTorch 安装方式，并将 RiSE 的 `device` 设置为 `cpu`。

## 来源检查与 FSD

来源检查使用 `.venv`。在新目录中先创建环境，再执行准备脚本。

```powershell
py -3.12 -m venv .venv
.\run.cmd run provenance:setup
.\run.cmd run aigc:setup
```

`aigc:setup` 创建 `.venv-fsd`、准备固定 FSD 源码并生成缺失的本机配置。首次 FSD 检测可能下载官方权重，默认保存到项目的 `weights/fsd/v1.2.0`。

需要离线运行时，先在联网环境准备依赖、权重与 OCR 模型。详细来源处理见 [PROVENANCE_V01.md](PROVENANCE_V01.md)，FSD 入口见 [AIGC_FSD.md](AIGC_FSD.md)。

## 模型源码与权重

```powershell
.\run.cmd run rita:setup
.\run.cmd run sica:setup
.\run.cmd run rise:setup
```

准备脚本固定并校验源码版本。权重从官方入口取得后放置如下。

```text
weights/
├─ rita/rita_catnet.pth
├─ sica/sica_weight_train.pth
├─ RiSE/RiSE-9.pth
└─ fsd/v1.2.0/
```

- [RITA 官方仓库](https://github.com/scu-zjz/RITA)提供百度网盘入口，选 `rita_catnet.pth`。详见 [RITA_INTEGRATION.md](RITA_INTEGRATION.md)。
- [SICA 官方仓库](https://github.com/venus-guangjian/SICA_OpenMMSec)提供权重分享目录。模板使用 `train` 版本。使用 `full` 权重时，同时修改路径和 `checkpointVariant`。详见 [SICA_INTEGRATION.md](SICA_INTEGRATION.md)。
- [RiSE 官方权重](https://huggingface.co/Jason37437/RiSE/tree/main)选 RGB 版 `RiSE-9.pth`。详见 [RISE_INTEGRATION.md](RISE_INTEGRATION.md)。

SICA full 权重使用过完整 OpenMMSec 数据，在相关数据上的结果需要考虑训练数据重叠。

## 本机配置

以下命令仅创建缺失的文件。已有配置继续保留。

```powershell
foreach ($model in @('rita', 'sica', 'rise', 'router')) {
    $destination = "config/$model.local.json"
    if (-not (Test-Path -LiteralPath $destination)) {
        $settings = Get-Content "config/$model.example.json" -Raw | ConvertFrom-Json
        $settings.pythonPath = '.venv-vision/Scripts/python.exe'
        $settings | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination -Encoding utf8
    }
}
```

检查每份配置的 Python、源码、权重路径和设备。相对路径相对于运行目录。SICA 与路由应指向同一份 SICA 权重和 CLIP 源码，RiSE 的 `dependencyPath` 应指向 `.tools/rise-deps-v5`。

来源检查默认读取 `.venv/Scripts/python.exe`，也可以使用 `config/provenance.local.json` 指定其他 Python。FSD 配置为 `config/aigc.local.json`。

## 本地 VLM

安装 Ollama 后，从 [Qwen 官方 GGUF 仓库](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/tree/main)取得语言模型和配套视觉投影文件。把选定的两个 GGUF 放在同一目录，按 Ollama 导入方式创建模型标签。

例如，在只放这两个 GGUF 的目录中创建 `Modelfile`，内容为 `FROM .`，再执行。

```powershell
ollama create srdp-qwen3-vl-2b -f Modelfile
ollama list
```

在项目根目录配置模型。

```powershell
.\run.cmd run explanation:setup -- --model srdp-qwen3-vl-2b
```

确保 Ollama 服务运行。已有服务时直接复用，手动启动使用 `ollama serve`。解释配置支持 `host` 和 `model`，原兼容服务入口保留。配置细节见 [EXPLANATION_HANDOFF.md](EXPLANATION_HANDOFF.md)。

如需将 Ollama 权重存到数据盘，在首次导入前设置 `OLLAMA_MODELS` 并重启服务，使服务和 CLI 使用同一目录。

## 验证真实推理

```powershell
.\run.cmd run typecheck
.\run.cmd run build
.\run.cmd run test:workflow
.\run.cmd run test:protocol
.\run.cmd run test:confidence
.\run.cmd run test:explanation
.\run.cmd run test:evidence-links

# 将路径替换为本机测试图片
.\run.cmd run smoke:workflow -- --image "D:\images\sample.jpg" --software-rendering
```

`--software-rendering` 用于测试窗口渲染，检测器仍按配置使用 CPU 或 CUDA。报告校验入口为 `run.cmd run report:validate -- <analysis.json>`。模型效果评估需要独立数据和明确的评价协议。

## 更新

先保存本地改动，然后更新共享分支和依赖。

```powershell
git status --short
git switch main
git pull --ff-only origin main
.\run.cmd ci
```

模型权重、运行环境、数据和本机配置由各开发者自行管理。更新后执行所修改模块对应的检查。
