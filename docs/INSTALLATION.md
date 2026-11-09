# Windows 安装与配置

## 下载

当前版本为 v0.2.2。安装器与校验文件位于 [GitHub Releases](https://github.com/Pocon041/image-authenticity-app/releases/tag/v0.2.2)。

安装器 `SRDP-Setup-0.2.2-x64.exe` 约 125 MB，包含桌面应用、Electron 和本项目 Python 后端脚本。运行真实模型还需要 Python 环境、模型源码、权重以及本地解释模型。

## 安装与首次配置

1. 运行安装器，选择应用安装位置。
2. 启动应用，展开“本地运行环境”。
3. 选择模型与报告目录，例如 `D:\SRDP-Data`。数据目录应位于应用安装目录以外。
4. 准备好模型环境后导入图片，点击“开始分析”。

已有源码环境的用户可以直接选择其项目根目录。应用复用其中的 `config/*.local.json`，相对路径以这个目录为基准。

### 使用配套运行资源

如果取得的安装包带有 `runtime-bundle` 文件夹，解压后保持以下结构。

```text
安装包/
├─ SRDP-Setup-0.2.2-x64.exe
├─ SHA256SUMS.txt
└─ runtime-bundle/
   ├─ manifest.json
   └─ *.zip
```

从这个位置运行安装器。首次启动后选择“选择数据目录并自动配置”，应用自动校验资源、展开三个 Python 环境、生成配置并启动本地 VLM 服务。用户无需逐项安装这些组件。资源未自动识别时，点击“选择完整资源包”并指定 `runtime-bundle`。

自动配置可取消和重试。已有完整展开的组件会复用，已有本机配置会保留。完成后可移除安装资源的解压副本，保留原安装包供重装使用。

GitHub 当前 Release 附件提供安装器和校验文件。配套运行资源包含第三方权重，获取和分发时需要遵守相应许可。自行准备环境的步骤见[开发配置](DEVELOPMENT.md)。

## 硬件与空间

- Windows 10/11 x64，多核 x64 处理器。
- 推荐 16 GB 以上内存，32 GB 更适合完整检测与本地 VLM。
- 推荐 NVIDIA GPU，8 GB 或更多显存，以及兼容 PyTorch CUDA 12.6 的驱动。
- 无 CUDA 时可以配置 CPU 路线，端到端 CPU 性能尚未系统评测。
- 建议使用 SSD，运行目录预留至少 25 GB。
- 配套资源压缩约 10.23 GB，展开约 16.41 GB。安装包 ZIP、解压副本和运行目录放在同一磁盘时，建议预留 50 GB。

应用按序运行检测器。显存和耗时也受到图片尺寸、图块数量及其他程序占用影响。

## 解释服务

自行准备 Ollama 时，默认使用 `http://127.0.0.1:11434`。模型名与地址在 `config/explanation.local.json` 中配置。

随包服务由应用启动，使用 `http://127.0.0.1:11435`，其模型和临时文件保存在数据目录。应用重启时恢复服务，退出时关闭自身启动的服务。

## 升级和卸载

新版本安装器可以覆盖升级应用。配置、模型和报告位于独立数据目录，升级和卸载会保留这些文件。分析结果保存在 `work/analysis-runs/<taskId>/`，可以从应用中打开。

## 构建含运行资源的安装包

在已配置完整推理环境的 Windows 构建机上执行。

```powershell
.\run.cmd run package:research

# 本机环境或权重更新后重新收集资源
.\run.cmd run package:research -- --rebuild-runtime
```

现有构建命令沿用 `package:research` 名称。构建器从 `config/sica.local.json` 指定的 Python 环境、来源与 FSD 环境、模型权重和本机 Ollama 中收集运行资源，并生成资源清单与 SHA-256 校验值。产物为 `dist/SRDP-Research-0.2.2-win-x64.zip`。

发布前确认所有资源的分发许可。权重和运行环境不提交 Git，打包脚本也不会自动将它们上传 GitHub。

当前安装器未使用代码签名证书，Windows 可能显示未知发布者。请核对与安装器配套的 SHA-256 文件。
