# Windows 安装说明

当前版本为 **v0.3.0**，适用于 Windows 10/11 x64。下载入口位于 [GitHub Releases](https://github.com/Pocon041/image-authenticity-app/releases/tag/v0.3.0)。

## 完整版

完整版包含桌面应用、三个独立 Python 环境、SICA、RITA、RiSE、FSD 的默认检测资源、来源检查依赖，以及 Ollama 和 Qwen3-VL-2B 本地解释模型。

在发布页下载下列文件，并放在同一个文件夹。

```text
SRDP-Full-Setup-0.3.0-x64.exe
SRDP-Full-Data-0.3.0-01.bin
SRDP-Full-Data-0.3.0-02.bin
SRDP-Full-Data-0.3.0-03.bin
SRDP-Full-Data-0.3.0-04.bin
SRDP-Full-Data-0.3.0-05.bin
SRDP-Full-Data-0.3.0-06.bin
```

1. 双击 `SRDP-Full-Setup-0.3.0-x64.exe`，选择保存离线安装资源的空目录。
2. 安装器自动校验数据分卷、准备资源，并启动应用安装向导。
3. 完成应用安装。首次打开时，在“设置 → 运行环境”中选择一个新的模型与报告目录，例如 `D:\Forensics-Data`。
4. 等待自动配置完成，然后导入图片开始分析。

用户无需手动解压，也无需另外安装 Python、Node.js、Git 或 Ollama。数据分卷是安装包的一部分，总计约10.4GB。GitHub 单附件须小于2GiB，因此使用六个分卷，安装器自动读取。

自动配置会验证哈希、展开环境、生成模型路径并启动本地解释服务，支持取消和重试。已有本机配置会保留。资源校验失败时，请根据提示重新下载对应分卷。

## 开发者版

下载并运行 `SRDP-Developer-Setup-0.3.0-x64.exe`。

该安装器包含 Electron、桌面工作台、本项目后端适配脚本、示例配置与报告协议。真实检测所需的 Python 环境、上游模型源码、权重和解释服务由开发者自行配置。

- 体验框架时，打开“设置 → 开发与单模型调试”，选择“模拟流程”。
- 接入真实模型时，按[开发与模型配置](DEVELOPMENT.md)准备环境，再在“设置 → 运行环境”中选择对应目录。
- 已有源码环境的用户可直接选择项目根目录，复用 `config/*.local.json` 和已有权重。

开发者版启动界面无需安装 Node.js。修改源码、构建应用时需要 Node.js 和 Git。

## 系统与存储要求

- Windows 10/11 x64，建议使用已更新的系统。
- 建议16GB以上内存，推荐32GB。
- 推荐 NVIDIA GPU，8GB或更多显存，以及兼容 PyTorch CUDA12.6 的驱动。已在 RTX4060 Laptop 8GB 上完成工程联调。
- 无可用 CUDA 时可使用 CPU，CPU端到端速度与其他显卡组合尚未系统评测。
- 建议使用SSD。运行数据目录预留至少25GB；下载、离线资源与运行数据放在同一磁盘时，建议预留50GB。

完整环境展开约16.4GB。默认检测和解释流程在资源准备完成后可离线运行。GPU驱动由操作系统环境提供。

## 数据与升级

应用程序、离线安装资源、模型与报告可以分别保存。模型与报告目录须位于应用安装目录之外。

分析记录保存在所选运行目录下的 `work/analysis-runs/<taskId>/`，包含 `analysis.json`、`bundle.json`、模型报告、掩码、响应图、区域裁剪和解释记录。升级与卸载应用会保留独立的数据目录。

完整运行环境准备好后，可按需清理安装器与分卷的下载副本。建议保留一份安装资源用于重装。请勿将当前模型与报告目录当作安装缓存删除。

## 本地解释服务

完整版由应用管理 Ollama，使用 `http://127.0.0.1:11435`。模型和缓存位于所选数据目录，应用重启时恢复服务，退出时关闭自身启动的服务。

开发者自行配置的 Ollama 默认使用 `http://127.0.0.1:11434`，可在 `config/explanation.local.json` 中设置模型名和地址。

## 校验与许可

发布页提供 `SHA256SUMS.txt`。Windows PowerShell 中可使用 `Get-FileHash -Algorithm SHA256 <文件路径>` 核对下载文件；完整版安装器也会自动验证各数据分卷。

当前安装器未配置代码签名证书，Windows可能显示未知发布者。第三方模型与依赖适用各自条款，详见[组件与模型说明](THIRD_PARTY_COMPONENTS.md)。

## 构建两种安装包

在已配置开发环境的 Windows 构建机上执行。

```powershell
# 构建开发者安装器
.\run.cmd run package:win

# 同时整理开发者版、完整版安装器及离线分卷
.\run.cmd run package:distributions
```

完整版构建需要已有的 `dist/research-runtime-v1/runtime-bundle`。环境或权重变化时，先使用 `scripts/build-research-bundle.py` 重新收集并验证资源。两种发布产物和校验清单位于 `dist/v0.3.0/release/`。

安装器会直接跨分卷读取数据，无需先合并为另一个大型文件。旧的 `package:research` 构建入口继续保留供兼容使用。
