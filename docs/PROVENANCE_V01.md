# 第一人模块：来源信息与图像预处理 v0.1.0

本模块在联合工作流准备图片时读取原文件，生成 provenance 单模块报告。实现限于来源与预处理相关服务，以及把报告放入完整证据包的必要接线；不改变 manipulation、AIGC 或 explanation 检测逻辑。

## 文件约定

- `images/original.<ext>`：输入文件字节副本，作为元数据和 C2PA 验证的输入。
- `images/display.png`：按 EXIF 方向校正、转换为 sRGB、未缩放的 8 位 PNG。其像素大小与 `image.width` / `image.height` 一致，是 `display_image_pixels` bbox 的坐标基准。
- `reports/provenance.json`：单独保存的 provenance 报告。
- `bundle.json`：工作流完整证据主文件，图片信息、全部模块报告和附件索引在其中；`reports` 中包含同一份 provenance 报告。
- `analysis.json`：面向当前界面的简明 manipulation 摘要，不是第四人的完整输入。

`imageId` 是原文件完整字节的 SHA-256，形式为 `sha256:<64位小写十六进制>`。显示图不参与身份计算。
`extensions.mediaInput` 预留媒体类型和帧信息：静态图使用 `{ "kind": "image", "frame": null }`；后续视频帧可使用 `kind: "video"` 并在 `frame` 中记录帧序号与呈现时间，不改变现有图片坐标字段。

## 已实现检查

### 文件预处理

记录原始哈希、编码尺寸、显示尺寸、EXIF orientation、输出格式和色彩空间。原文件不重编码；显示副本不缩放，供模块共享坐标使用。

### EXIF、XMP、IPTC

记录文件格式和图像属性；可读取时提取相机厂商/型号、拍摄/编辑时间、软件、镜头/曝光信息、GPS，以及选定的 XMP/IPTC 描述、版权、来源和创建者字段。`strippingAssessment` 固定为 `unknown`：缺字段或整段元数据缺失不能证明被剥离或伪造。

### C2PA / Content Credentials

当前支持在 JPEG APP11/JUMBF、PNG `caBX`、WebP `C2PA` 容器位置扫描内嵌清单标记。命中后用 `c2pa-python` 读取活动清单，记录 claim generator、签名者/issuer、签名时间、动作历史、software agent、digital source type、ingredients 和验证状态。AI 来源类型只记录清单中的声明，不代替 AIGC 检测。远端清单获取与 OCSP 查询关闭；缺少嵌入清单也不能排除外部凭证。

### 水印

- 元数据文字：检查 EXIF/XMP/IPTC 中的 watermark、Digimarc、Adobe Stock、Shutterstock、Getty Images、iStock、Alamy、Dreamstime 和 Depositphotos 等候选字样。
- 可见水印文字：RapidOCR 在规范显示图上匹配这些图库名称，以及 watermark、preview、sample 等通用词；命中会保留识别文字、置信值和 `display_image_pixels` 坐标框。它不能确认文字由水印叠加产生；低对比度、倾斜、遮挡、图形 Logo 和其他文字可能造成漏报或误报。
- 隐形载荷：在原始解码像素上使用 `invisible-watermark` 的 DWT-DCT 解码路径，精确匹配 Stability AI / Diffusers 公开的 Stable Diffusion XL 48 位固定载荷。超过 1200 万像素时为避免阻塞而不运行解码，不对输入缩放。匹配只说明解出的载荷与该公开常量一致，可被复制伪造；缩放、裁剪、压缩、色彩处理或尺寸太小会导致漏检。它不是通用 SD、SynthID 或其他 AI 水印检测器。

子检查详情分别保留 `status`、`outcome`、方法和 limitation。`no_known_*` 表示当前已实现的检测器没有命中，不等于“没有水印”。

## 安装与本地运行

在项目根目录执行：

```bat
run.cmd run provenance:setup
```

脚本创建项目忽略的 `.tools/provenance-venv`，安装固定版本的 C2PA、Pillow、RapidOCR、ONNX Runtime、OpenCV headless、PyWavelets 和隐形水印解码器。`invisible-watermark` 以 `--no-deps` 安装，避免覆盖 RapidOCR 的 headless OpenCV 包；代码直接载入其 DWT-DCT 算法，绕过该包导入时加载的非必需 RivaGAN/PyTorch。

来源报告随联合分析自动生成；完整 JSON 位于任务输出目录的 `bundle.json`，单模块副本位于 `reports/provenance.json`。

当前是源码开发接入：发布目录尚未打包 `.tools/provenance-venv`、Python worker 和 OCR 模型，因此独立安装包中的 provenance 运行时部署仍需后续配置。

## 上游方法

本地整合补充了5项合成像素检查：可见水印关键词、平坦载体上的固定/非固定载荷、纹理载体的严格匹配语义、小图配置边界和超大图未扫描状态。纹理载体在本机往返出现过1位丢失，因此“已嵌入”不保证精确解码；实现没有放宽精确匹配，也不将近似匹配当作命中。这些检查不构成真实图片上的准确率或鲁棒性基准。

```powershell
.tools/provenance-venv/Scripts/python.exe -m unittest discover -s backend/provenance -p test_*.py
```

- [C2PA Python SDK 用法](https://github.com/contentauth/c2pa-python/blob/main/docs/usage.md)
- [C2PA Context 与验证设置](https://github.com/contentauth/c2pa-python/blob/main/docs/context-settings.md)
- [RapidOCR 官方安装文档](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/install/)
- [invisible-watermark 解码接口与边界](https://github.com/ShieldMnt/invisible-watermark)
- [Diffusers Stable Diffusion XL 固定载荷实现](https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/stable_diffusion_xl/watermark.py)
