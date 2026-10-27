# 第二人模块：RITA 接入

本模块接入现有 RITA，负责单图篡改定位与报告转换，不训练新模型。公共桌面框架仍保留模拟模式；RITA 作为单独可选择的本地模式，缺少依赖或权重时明确报错，不回退为模拟结果。

## 1. 当前边界

官方模型默认四类：篡改、其余像素、EOS 和 padding。它没有独立整图分类头，也不是四种篡改手段分类。推理序列表示模型计算步骤，不直接解释为真实编辑历史。

适配器采用最后一个非 EOS 主导的有效步骤，提取类别 0 掩码，保留 padding 占比和终止原因。全尺寸掩码用最近邻恢复，连续响应图用双线性恢复。响应图保存四类 softmax 中类别 0 的响应，没有移除控制类别再重新归一化。

整图分数暂为模型分辨率下有效像素中最高 1% 类别 0 响应的平均值。这是待验证的工程汇总量，不是作者提供的图像级概率。默认没有整图阈值，`decision=inconclusive`，定位附件可以独立使用。配置阈值后可以输出二分类，但配置值不因此成为已验证阈值。

## 2. 官方文件和 Python

准备 Node/npm 环境后，在项目根目录执行：

```powershell
npm.cmd run rita:setup
```

这会下载固定提交 `b50efcd5b4c41b8bfc69b0b10ce6230dcb67b983` 的官方 `rita.py` 至 `.tools/rita-upstream/`，并校验源码 SHA256。运行时只将作者硬编码的骨干初始化路径替换为空，然后严格加载完整任务权重；不允许缺失参数后继续推理。

从[官方 README](https://github.com/scu-zjz/RITA)给出的[百度分享](https://pan.baidu.com/s/1W1HC4_mn044ub2NLJLSeQQ?pwd=43nn)下载 `rita_catnet.pth`，提取码 `43nn`，放到：

```text
weights/rita/rita_catnet.pth
```

依赖已有 PyTorch 的环境可以直接配置；否则创建单独的 Python 环境，安装适合本机 CPU/CUDA 的 torch、torchvision，再安装：

```powershell
python -m pip install -r backend/rita/requirements.txt
```

当前本机检查到可用的 PyTorch 2.7.0+cu126、timm 1.0.21 环境。该环境可用于接入检查，不等同于作者所有依赖版本的精确复现。源码和权重的实际使用条件应以原项目为准，不将本项目 MIT 自动适用于第三方文件。

## 3. 本机配置

```powershell
Copy-Item config/rita.example.json config/rita.local.json
```

编辑本机配置的 `pythonPath`、`checkpointPath`，其余默认值可以保留。带目录的相对配置路径相对于项目根目录；裸 `python` 则从 PATH 查找。每个成员可以使用不同的 Python 和权重路径。

- `device`：`auto`、`cuda` 或 `cpu`。
- `checkpointSha256`：可选的完整小写权重哈希。运行时总会记录实际哈希；配置哈希后必须匹配。
- `maxSteps`：1–20，默认 10。
- `decisionThreshold`：默认 `null`，保留证据不足；未经验证不要宣传分数为真假概率。
- `timeoutMs`：默认 180000，桌面超时后终止本次 Python 子进程。

权重、本机配置、下载源码和运行产物都不提交 Git。

## 4. 单图和 APP 入口

```powershell
npm.cmd run rita:infer -- --image examples/stage1-materials/sample-005/images/original.jpg
```

可使用 `--config`、`--output` 指定配置和结果目录。命令为输入创建原始字节快照和未缩放规范显示副本，再运行单次 Python 进程。程序不会读取数据集标签或真值标注。

桌面运行入口保持现有方式。界面选择“RITA 本地定位”，选图后点击“开始 RITA 定位”。主进程通过白名单桥接调用 Python，界面不直接访问 Python 或权重。

结果目录包含：

```text
images/                原文件快照、规范显示副本
artifacts/mask.png     原尺寸二值预测掩码
artifacts/response.png 原尺寸模型响应灰度图
artifacts/overlay.png  红色预测区域叠加预览
artifacts/crop-*.png   最多 20 个连通区域裁剪，按面积排序
report.json            v1.0 manipulation 报告
bundle.json            单模块证据包，可供公共汇总器合并
request.local.json     本地任务参数，可能含本机路径，不用于公开分享
```

图片 ID 已切换为原始字节 SHA256，`imageId` 可跨重复导入保持一致。当前只适配第二人的报告；没有自动补出来源、AI 检测或 VLM 的运行结果。

## 5. 验证

独立的几何、控制类别和分数规则测试：

```powershell
python -m unittest discover -s backend/rita -p test_*.py
```

真实推理后，校验证据包：

```powershell
npm.cmd run examples:validate -- --bundle <结果目录>/bundle.json
```

正确加载和接口通过不能代表定位效果。实际接入应检查真实图误报、拼接、复制移动和 IMD2020 修复；确定阈值要另用验证集，现有 12 张联调图片不用于证明泛化。

首次缺少权重时运行失败是预期行为，不能生成伪造的“真实结果”。GPU 耗时、峰值显存和检测表现只有实际推理后才能记录。当前发布包内的 Python 和权重分发未配置，RITA 暂用于源码开发模式。
