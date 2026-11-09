# SRDP Windows 安装版

适用于 Windows 10/11 x64。运行 `SRDP-Setup-0.2.1-x64.exe`，选择安装位置，安装后从开始菜单或桌面打开“SRDP 图像真实性分析”。应用界面和 Electron 运行时随安装包提供，用户启动应用无需安装 Node.js。

## 首次启动

打开“本地运行环境”，选择模型与报告目录。建议放在空间充足的数据盘，例如 `D:\SRDP-Data`。目录中的配置、权重和分析结果在应用升级及卸载后保留。

已经按项目 README 配置过源码版的用户，可以直接选择已有项目根目录，例如自己的 `D:\SRDP`。相对模型路径和配置继续以这个目录为基准。安装版使用随程序提供的 Python 后端脚本。

新建目录时，应用会提供 `config/*.example.json` 和本说明。配置模板用于参考，准备好环境后复制为相应的 `*.local.json`，填写本机 Python、模型源码及权重路径。“已找到配置”仅表示存在配置文件，实际可用性在分析时检查。

## 推理环境

安装包包含应用和本项目 Python 后端。Python 解释器、推理依赖、第三方模型源码、官方权重和 Ollama 模型需要单独准备。准备过程需要下载依赖，环境就绪后可以本地分析。

完整步骤和官方下载链接见项目 README。

https://github.com/Pocon041/image-authenticity-app#readme

可以先按 README 在选定目录准备模型环境，再用安装版连接该目录。模型配置通常包括以下文件。

- `config/sica.local.json`，设置 Python、SICA/CLIP 源码和权重。
- `config/rita.local.json`，设置 Python、RITA 源码和权重。
- `config/rise.local.json`，设置 Python、RiSE 源码、隔离依赖和权重。
- `config/aigc.local.json`，设置 FSD 环境与权重目录。
- `config/router.local.json`，使用已有 SICA 权重与 CLIP 源码。
- `config/explanation.local.json`，设置本地 Ollama 地址和实际模型标签。

元数据、C2PA 和水印解析使用所选目录中的 `.venv/Scripts/python.exe`。按 README 执行 `provenance:setup` 准备。各检测器也支持在配置中使用其他位置的 Python 和权重绝对路径。

## 使用与报告

选择图片后运行联合分析。模型缺失或执行失败会显示对应状态，可以在“开发与单模型调试”中选择明确标记的模拟流程检查图像导入和界面。

报告保存在所选目录的 `work/analysis-runs/<任务编号>/`，包含简明报告、完整证据包、来源报告、定位产物和解释。应用内可打开当前报告文件夹。

## 升级和卸载

新安装包可以覆盖升级应用。模型与报告目录独立管理，升级沿用已保存的目录选择。卸载应用后，模型、配置和报告仍保存在用户选择的目录。

此版本未使用商业代码签名证书，Windows 可能显示未知发布者。请从本项目 GitHub Releases 下载，并使用发布页的 SHA-256 校验文件核对安装包。
