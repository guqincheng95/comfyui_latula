# 拉图 · comfyui_latula

版本 **0.01 初航测试版**（npm 版本 0.0.1，Android versionCode 301）。

拉图是 ComfyUI / AI API 的便捷操作前端。模型推理和图片、视频生成在用户连接的电脑或云端服务中完成。

## 0.01 已实现

- 使用定稿的夜景三猫港湾主页；三个入口与内部页面统一深色木质、金边与冷暖像素美术。
- 导入 ComfyUI **API 格式 JSON**，自动识别提示词、图片/视频/音频、数值、下拉和开关输入。
- 连接服务读取 object_info，补充节点范围和可选项；特殊字段可在装配台调整模块类型、中文名和高级参数分组。
- 保存多份工作流配置，装配选择持久化，主页高亮当前装配。
- 素材上传、参数回写、提交工作流、轮询排队/执行/结果；服务端任务编号与原工作流配置快照绑定。
- 图片/视频历史图鉴、收藏、参数复用（只带回草稿，不自动重提）、原文件保存/分享。
- 配置使用 Android Preferences，任务与缩略图分开存入 IndexedDB；清理缓存不删除任务。
- 保留原 Runway 动作迁移的后端、直传/中转链路；不在 APK 内置平台密钥。
- 关于、更新手札、减少动态效果、触感开关、缓存清理及离开应用。

## 第一次使用

1. 启动电脑/云端的 ComfyUI，确保手机可以访问服务地址。
2. 在 ComfyUI 中导出 **API 格式** JSON；普通节点画布 JSON 会得到明确提示。
3. 拉图 → 装配工作流 → 导入文件、填写地址 → 测试连接。识别标准输入并根据服务端定义完善字段。
4. 保存并装配 → 进入工作流 → 上传素材、填写提示词与参数 → 提交。
5. 在历史任务中查看、收藏和保存结果。

节点、模型和素材名称必须能在目标服务中使用。本版不安装服务端模型或自定义节点，也不在手机上执行生成。手机与服务之间的网络和访问权限需由实际部署提供。

## 兼容范围

- 原生 ComfyUI HTTP API：/system_stats、/object_info、/upload/image、/prompt、/history、/queue、/view。
- LoadImage、常见 CLIP/TextEncode、KSampler、尺寸/种子等标准输入有适配；其他节点的基础类型可依服务端定义装配。
- 不保证任意自定义节点的前端交互、复杂列表、遮罩绘制、专有上传协议自动兼容。特殊节点适配集中在 frontend/src/lib/workflow.js。
- 暂未接入 RunningHub 的 webappId / workflowId 专有平台接口。
- 取消只作用于原生 ComfyUI 中尚未开始的指定排队任务，不调用全局中断。
- 原文件链接可能失效，重要作品请主动保存。卸载应用会清除本地记录。
- 原生下载通过文件传输插件取得原文件后打开系统分享/保存面板；网页用浏览器下载。视频封面在网络/媒体跨域允许时缓存第一帧，否则保留可识别的预览占位。
- 测试包保留原 applicationId com.acttwomobile.app。CI 从本版开始缓存测试签名；旧原型包由不同临时签名构建时，可能无法直接覆盖安装。

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

Android：GitHub Actions 自动安装依赖、检查、生成原生项目、同步插件并构建 APK。配置开发服务器时使用 npm run dev；某些受限执行环境不能读取网卡信息时，可用静态服务检查 dist。

后端使用方法保留：backend/.env 配置 RUNWAYML_API_SECRET，安装 backend/requirements.txt 后运行 uvicorn app.main:app --host 0.0.0.0 --port 8000。未配置 Runway 不影响原生 ComfyUI 路径。

## 项目文档

- [0.01 测试说明](docs/RELEASE_0.01.md)
- [第一阶段规格](docs/PHASE1_SPEC.md)
- [UI 设计计划](docs/UI_DESIGN_PLAN.md)
- [二次开发路线](docs/REDEVELOPMENT.md)
- [技术与素材来源](docs/THIRD_PARTY.md)
