# 拉图 · comfyui_latula

版本 **0.04.1 通用操作模块测试版**（npm 版本 0.0.6，Android versionCode 308）。

**[下载 Android APK](https://github.com/guqincheng95/comfyui_latula/releases/download/v0.04.1/latula-v0.04.1-test.apk)** · [版本发布页 / Releases](https://github.com/guqincheng95/comfyui_latula/releases/tag/v0.04.1)

手机安装请下载 `.apk` 文件；发布页中的 Source code 是源码压缩包。

正式包名固定为 `com.latula.mobile`，证书指纹已固定在 `.github/signing/identity.json`。从 0.01.1 开始使用长期统一签名；旧 0.01 原型的私钥未能保存，不再处理其兼容，新旧包数据独立。

拉图是 ComfyUI / AI API 的便捷操作前端。模型推理和图片、视频生成在用户连接的电脑或云端服务中完成。

## 已实现

- 工作运行页统一为图片输入、提示词、采样与图片输出；其余控件按原节点折叠在高级设置，展开后显示。

- 使用定稿的夜景三猫港湾主页；三个入口与内部页面统一深色木质、金边与冷暖像素美术。
- 导入 ComfyUI **API 格式 JSON**，自动识别提示词、图片/视频/音频、数值、下拉和开关输入。
- 连接服务读取 object_info，补充节点范围和可选项；特殊字段可在装配台调整模块类型、中文名和高级参数分组。
- 保存多份工作流配置，装配选择持久化，主页高亮当前装配。
- 素材上传、参数回写、提交工作流、轮询排队/执行/结果；服务端任务编号与原工作流配置快照绑定。
- 图片/视频历史图鉴、收藏、参数复用（只带回草稿，不自动重提）、原文件保存/分享。
- 配置使用 Android Preferences，任务与缩略图分开存入 IndexedDB；清理缓存不删除任务。
- 保留原 Runway 动作迁移的后端、直传/中转链路；不在 APK 内置平台密钥。
- 关于、更新手札、减少动态效果、触感开关、缓存清理及离开应用。

## RunningHub 使用

1. 装配工作流 → 接入 RunningHub 工作流，粘贴网页完整链接或工作流 ID。
2. 填写自己的 API Key。安卓使用 Android Keystore 的 AES-GCM 加密保存；密钥与配置/任务快照分离，不写入仓库、安装包或日志。网页预览只保留在内存，刷新需重填。
3. 选择「验证密钥 · 读取云端工作流」，或手动导入平台导出的 API JSON；读取会更新装配台的 JSON。验证仅查询工作流，不创建生成任务。
4. 保存完整工作流；进入运行页面点击功能道具切换模块，也可勾选组合输出。切换保留各模块参数和已选素材，无需返回装配或复制配置。
5. 运行页「模块命名与旁路控制」可启用、停用节点或按类型透传旁路线；无法唯一匹配时阻止提交，不猜测连线。
5. 保存并装配，进入工作流，重新上传素材、填写提示词和参数后手动提交。
6. 使用官方完整 workflow 参数提交所选输出及依赖节点，保持原始 JSON；不是只隐藏其他表单。返回的任务 ID 用于 V2 查询，重要结果及时保存。

密钥只发送到固定 HTTPS 域名 www.runninghub.cn。生成使用自己的 RunningHub 账户额度；鉴权、工作流权限、节点和模型是否可运行以平台真实响应为准。本轮协议/安装检查使用本地模拟服务，未使用用户密钥调用付费 GPU 任务。支持图片画笔/橡皮、撤销、清空、反选和独立黑白 MASK 上传；原图 RGB 保留。复杂自定义前端脚本仍需节点类型能力声明，不承诺任意未知脚本都能自动重建。

## ComfyUI 第一次使用

1. 启动电脑/云端的 ComfyUI，确保手机可以访问服务地址。
2. 在 ComfyUI 中导出 **API 格式** JSON；普通节点画布 JSON 会得到明确提示。
3. 拉图 → 装配工作流 → 导入文件、填写地址 → 测试连接。识别标准输入并根据服务端定义完善字段。
4. 保存并装配 → 进入工作流 → 上传素材、填写提示词与参数 → 提交。
5. 在历史任务中查看、收藏和保存结果。

节点、模型和素材名称必须能在目标服务中使用。本版不安装服务端模型或自定义节点，也不在手机上执行生成。手机与服务之间的网络和访问权限需由实际部署提供。

## 兼容范围

- 原生 ComfyUI HTTP API：/system_stats、/object_info、/upload/image、/prompt、/history、/queue、/view。
- LoadImage、常见 CLIP/TextEncode、KSampler、尺寸/种子等标准输入有适配；其他节点的基础类型可依服务端定义装配。
- 通用装配层 frontend/src/lib/graph-ui.js 按服务端 object_info 生成端口/下拉/范围/旁路，多图通过真实 IMAGE 端口注入加载节点；不按工作流 ID 或固定节点编号写逻辑。
- API JSON 常缺下拉完整列表和分组。可自动同步服务端定义，或导入 object_info / 普通画布补充分组。没有完整定义时下拉明确标注「工作流已有值」，新增图像端口在提交前需服务端定义确认；不会把猜测的模型列表当作实际库存。
- 遮罩使用独立 LoadImageMask/channel=red，重接 MASK 连线，不把涂色写入原图。支持 2400 万像素以内图像。复杂动态控件/自定义前端脚本仍需通用节点类型适配，不能单凭 API JSON 重建缺失的全部前端行为。
- RunningHub 工作流 API：链接/ID 导入、读取云端 API JSON、单输出分支裁剪、官方上传和创建任务、V2 结果查询；AI 应用 webappId、平台取消和账户额度查询暂未接入。
- 取消只作用于原生 ComfyUI 中尚未开始的指定排队任务，不调用全局中断。
- 原文件链接可能失效，重要作品请主动保存。卸载应用会清除本地记录。
- 原生下载通过文件传输插件取得原文件后打开系统分享/保存面板；网页用浏览器下载。视频封面在网络/媒体跨域允许时缓存第一帧，否则保留可识别的预览占位。
- 后续构建必须配置固定签名 Secret `LATULA_ANDROID_SIGNING`，校验证书指纹后才产出 APK。缺少配置时不回退到随机测试签名；详见 [Android 签名配置](docs/ANDROID_SIGNING.md)。

## 开发与检查

Frontend: Vue 3 / Vite / Capacitor 8。后端继续使用原 FastAPI + Runway。

    cd frontend
    npm ci
    npm test
    npm run build

本地协议/UI检查（模拟服务，无真实 AI 生成）：

    npm run build
    python tests/protocol-server.py
    # 另一个终端
    npx playwright install chromium
    node tests/ui-check.mjs

Android：GitHub Actions 自动安装依赖、检查、生成原生项目、同步插件并构建 APK；随后在 Android 15 / API 35 模拟器安装此 APK，运行原生网络与冷启动持久化回归。协议服务仅用于测试，不模拟真实 GPU 生成。配置开发服务器时使用 npm run dev；某些受限执行环境不能读取网卡信息时，可用静态服务检查 dist。

后端使用方法保留：backend/.env 配置 RUNWAYML_API_SECRET，安装 backend/requirements.txt 后运行 uvicorn app.main:app --host 0.0.0.0 --port 8000。未配置 Runway 不影响原生 ComfyUI 路径。

## 项目文档

- [固定签名与自动构建配置](docs/ANDROID_SIGNING.md)
- [0.03.1 更新说明](docs/RELEASE_NOTES_0.03.1.md)
- [通用装配架构与验证](docs/UNIVERSAL_ASSEMBLY.md)
- [0.02 更新说明](docs/RELEASE_NOTES_0.02.md)
- [RunningHub 接口与边界](docs/RUNNINGHUB.md)
- [0.01 测试说明](docs/RELEASE_0.01.md)
- [第一阶段规格](docs/PHASE1_SPEC.md)
- [UI 设计计划](docs/UI_DESIGN_PLAN.md)
- [二次开发路线](docs/REDEVELOPMENT.md)
- [技术与素材来源](docs/THIRD_PARTY.md)
