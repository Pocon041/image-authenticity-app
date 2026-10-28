# HiFi-Net 通用权重：二分类与定位检查

> 历史评测记录。v0.2.0发布整理时已移除HiFi-Net的运行代码与命令；本文保留原有观察和协议纠正，不作为当前安装说明。权重和评测结果仍保留在本机。

本轮按用户要求测试已经下载的 general `750001` 权重，没有训练、调阈值，也没有将它设为 APP 默认模型。SICA 和 RITA 保持原有独立模式。

## 模型与环境

官方源码：[CHELSEA234/HiFi_IFDL](https://github.com/CHELSEA234/HiFi_IFDL)，固定提交 `0ca70d651087bb09959dec583947031c47d30209`。

- `HRNet/750001.pth`：81112652 字节，SHA256 `be21278afb4e657bdafdf581d8d8bc6bc09f3b4507b10502ce98f1ae7ef1c5c1`。
- `NLCDetection/750001.pth`：57487769 字节，SHA256 `7615fcb054e7cbd0b25d647d72655a690424232668abbc911551648e84b5f8fc`。
- 配套 `center/radius_center.pth` 来自相同官方源码提交，中心 18 维，半径约 1.24048。
- 本地固定的文件哈希只用于身份与一致性记录，不冒充作者提供的签名。
- HRNet 的 699 个状态项、检测头的 66 个状态项均 strict=True 完整匹配，missing/unexpected 为空。

本机使用现有 EIT PyTorch 2.7.0+cu126、FP32、RTX 4060 Laptop GPU。旧源码的 `np.int` 通过 seg_hrnet 模块内的代理映射到 int，未修改全局 NumPy、共享环境版本或官方源码文件。yacs 0.1.8 单独放在 `.tools/hifi-deps/`。

当前沿用官方代码中的 CUDA 设备假设，初始适配器只声明支持 cuda:0，不宣称已有 CPU 或任意显卡编号适配。

## 规则

预处理与公开单图 API 一致：整张图片 PIL bicubic 缩放至 256×256，RGB / 255，不使用 ImageNet 归一化，不中心裁剪。

二分类保留两个口径：

1. 官方便捷 API 的原生判断：14 类 logits 的 argmax，类别 0 为真实，其他类别为假。
2. 与 SICA 比较用的固定 0.5 口径：`1 - softmax(logits)[real] >= 0.5`。

两者可能不一致，因为“最高分的单类是 real”和“所有非 real 类的概率和超过 0.5”可以同时发生。AUROC 始终使用连续分数，没有使用硬标签替代。

定位使用官方单图 API 的特征到真实像素中心的 L2 距离，固定阈值 2.3。距离响应不是概率。二值掩码用最近邻映射回规范显示尺寸，连续距离图用双线性映射。定位在全部 383 张篡改图上计算，不用分类结果筛选后再计分。

像素 F1/IoU/AUC 在原尺寸标注上计算；没有根据真值反转预测、选择阈值或排除边界。源数据与掩码只读，EXIF 坐标变换与原图对应。

## 本地 CASIA 子集结果

共 479 张：96 真实、383 篡改，全部成功读取。

- 官方原生分类：TP=60、TN=87、FP=9、FN=323；ACC=30.69%、balanced ACC=53.15%、F1=26.55%、AUROC=0.44895。
- 固定 0.5 分类：TP=61、TN=87、FP=9、FN=322；ACC=30.90%、F1=26.93%。与原生判断有 1 张差异。
- 定位：383 张篡改图的平均像素 F1=0.002413、IoU=0.001409、像素 AUC=0.47545。
- 368/383 张篡改图的预测掩码为空。
- 拼接：24/130 检出，检出率 18.46%；定位平均像素 F1=0.000087。
- 复制移动：36/253 检出，检出率 14.23%；定位平均像素 F1=0.003608。
- 96 张真实图的平均预测标记面积约 1.05%。

同一批图片上，先前 SICA 的固定 0.5 分类 ACC=82.25%、AUROC=0.92390。这是当前两个公开权重与各自预处理的工程观察，不是控制训练数据、预处理等变量后的架构比较。

## 官方 API 数值对照

已抽查 CASIA 拼接、ADM 生成各 1 张。使用未经改写的官方类方法和辅助分类函数，仅替换文件加载路径，在相同环境、相同 256 像素输入上比较：

- 分类标签一致。
- 分数差异小于 1e-6，实际记录相同。
- 二值掩码逐像素差异为 0。

记录保存在 `work/hifi-casia-observation/api-parity.json`。该抽查有助于排除适配方法改写造成的数值偏差，不能排除权重适用域、软件版本或配套文件等更广泛问题。

## 结论与下一步

当前 `750001` 通用权重加官方单图 API 配置，在本地 CASIA 子集未达到可用效果。不能只因源码包含分类和定位，就宣布它可以替代现有方法。也不根据这些结果临时降低距离阈值或反转分数。

权重职责需分别理解：SICA 的权重只执行二分类，本轮定位并未使用 SICA。HiFi general 的官方单图示例同时提供 detect/localize，但本轮定位数字只是该通用 API 路径的诊断，不能写成专用定位权重的验证结果。

此结论不覆盖另一套 `weights_loc`。官方定位脚本使用不同的 NLCDetection_loc 模块；225000 版本默认走 CE 掩码分支，不能把它当作 750001 的补充文件，也不能直接套用通用版本的距离阈值路径。若继续验证 HiFi，应独立准备相应定位权重、代码和配置。

本地 479 张是可用子集，不是完整 CASIA v2，且没有排除模型训练来源重合，不能作独立泛化结论。当前也没有验证文档、视频或新型多步编辑场景。

## 复现

先按现有 README 配置 Node/npm，并准备匹配的 CUDA Python。初始源码与依赖可这样准备：

```powershell
git clone https://github.com/CHELSEA234/HiFi_IFDL.git .tools/hifi-official
git -C .tools/hifi-official checkout 0ca70d651087bb09959dec583947031c47d30209
<配置的Python> -m pip install --no-deps --target .tools/hifi-deps yacs==0.1.8
Copy-Item config/hifi.example.json config/hifi.local.json
```

其余 Python 依赖见 `backend/hifi/requirements.txt`，使用已有依赖时不要求重新安装。编辑本机 Python、两个权重和源码路径，再运行：

```powershell
npm.cmd run hifi:evaluate -- --casia-root <本机划分清单目录> --output work/hifi-casia-new
npm.cmd run hifi:infer -- --image <本机图片> --output work/hifi-single-new
<配置的Python> -m unittest discover -s backend/hifi -p test_*.py
```

结果 CSV/统计在指定目录；单图命令另存预测、连续距离 NPY 和叠加图。`inspection.json` 是调试记录，不是 v1.0 VLM 证据包。此轮没有添加 HiFi 的 APP 模式或正式模块报告接口。

权重、数据、本机配置和 `.tools/` 均不提交 Git。README 保持不变，工作记录统一写入 AGENT.md。

## 定位权重 225000（CE 分支）补充验证

2026-10-27 追加：用户下载官方 localization weights 后，按 `HiFi_Net_loc.py` 的 CE 分支独立接入，未训练、未调阈值、未改 README。

### 权重与代码路径

- `weights/hifi/weight_loc/HRNet/225000.pth`：107032008 字节，SHA256 `f60dcb8a245831335db663579801aed09bd81e6b7f602c88d514461c435e7425`。
- `weights/hifi/weight_loc/NLCDetection/225000.pth`：96371777 字节，SHA256 `a2e824ac2fc99565ad422d5afffbbfe7d9eaf2e8e0d6f48cc10e6bb079d947f7`。
- strict=True 完整加载：HRNet 699 项、NLCDetection_loc 106 项，missing/unexpected 均为空。
- 代码走 `models/NLCDetection_loc.py`，`--loss_type` 默认 `ce`，二值掩码按 `mask_binary >= 0.5` 生成，**不使用** general 的 2.3 距离阈值；`center_loc/radius_center.pth`（radius≈1.50596）只作审计记录，CE 分支推理不依赖它。
- 新增 `backend/hifi/model_loader_loc.py`、`backend/hifi/evaluate_loc.py`、`backend/hifi/evaluate_loc_official.py`、`config/hifi.loc.example.json`；命令为 `npm run hifi:loc:evaluate` 与 `npm run hifi:loc:official`。

### 关键协议修正

初版适配器沿用了 general API 的 PIL bicubic 256 预处理，与官方定位评测脚本不一致：

- 官方 `HiFi_Net_loc.py` + `utils/load_edata.py`：图像按**原分辨率**送入 HRNet，只有掩码分支在 `NLCDetection_loc.forward` 内部用 bilinear 插值到 256；GT 掩码用 PIL BICUBIC 缩到 256 后 `>0.5`。
- 初版：先把图 PIL bicubic 缩到 256 再送入网络，GT 用 nearest 缩到 256。

该偏差显著压低定位指标，已修正为 `predict(native=True)`，`evaluate_loc.py --input` 默认 `native`。初版结果保留在 `work/hifi-loc-casia-observation/` 作为偏差记录，不再作为结论。

### 本地 CASIA 479 张结果（修正后，native 输入）

定位（原尺寸、正类像素、无真值翻转）：

- 383 张篡改：F1=0.34055、IoU=0.28028、AUC=0.86711；91 张预测为空；96 张真实图平均预测面积 0.22%。
- 拼接：F1=0.3147、AUC=0.8335，37/130 空预测。
- 复制移动：F1=0.3538、AUC=0.8844，54/253 空预测。

二分类（cls_level_1 十四类 argmax）：

- ACC=44.26%、balanced ACC=59.29%、F1=49.53%、AUROC=0.62285。
- 叶子分布：real 333、inpainting 80、stgan 35、copy_move 19、splicing 12。
- 修正后不再坍缩，但仍然弱，只作完整性记录，不作可用图像级检测器。

### 精确官方协议复现

`backend/hifi/evaluate_loc_official.py`（`npm run hifi:loc:official`）严格按官方脚本：原图输入、GT BICUBIC 256 + `>0.5`、逐图 `max(F1,F1_flip)` / `max(AUC,1-AUC)`、无 EXIF、batch=1。

- macro F1=0.64750（无翻转 0.64638，7 张选择翻转）。
- macro AUC=0.88540（无翻转 0.86674，27 张选择翻转）。
- 拼接 F1=0.62641 / AUC=0.85957；复制移动 F1=0.65834 / AUC=0.89868。
- 与项目脚本 `officialProtocolDiagnostic` 交叉验证：0.64747/0.88533 对 0.64750/0.88540，差异小于 1e-4。

### 与论文和 750001 的对照

| 指标               | 初版（bicubic256） | 修正后（native） | 论文            |
| ------------------ | ------------------ | ---------------- | --------------- |
| 官方口径 macro F1  | 0.54246            | 0.64750          | 0.616（微调）   |
| 官方口径 macro AUC | 0.77971            | 0.88540          | 0.866（预训练） |
| 正类像素 F1        | 0.14273            | 0.34055          | —               |
| 像素 AUC           | 0.72638            | 0.86711          | —               |

- 与论文同量级且略高，但本地 479 张 pilot 子集与本地修正掩码不等于官方 CASIA1+CASIA2 清单，不能称为论文复现。
- general 750001 的官方入口（`HiFi_Net.py::_transform_image`）本身就是 PIL bicubic 256，已完成 API parity，不受本次修正影响；两套权重各自的官方路径预处理不同，不能混用。
