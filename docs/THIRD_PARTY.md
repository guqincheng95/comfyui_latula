# 第三方技术与素材记录
本版：拉图 0.02。
- 主工程沿用用户原 Act-Two-Mobile（现 comfyui_latula）的 Vue、Capacitor、FastAPI 与 Runway 实现。
- Vue、Capacitor 和原生 App / Preferences / Filesystem / File Transfer / Share / Haptics 插件复用现成运行时。完整运行时许可文本随 APK 放在 public/third-party-notices.txt。
- Playwright 只用于隔离的 UI / 协议回归测试，不进入 APK。
- ComfyUI HTTP 原生协议与 object_info 节点定义用于工作流导入及表单装配；节点适配表位于 frontend/src/lib/workflow.js。
- ComfyChair（GPL-3.0）、ComfyUIMobileApp（MIT）、Comfy Remote（仓库未声明明确许可）是交互与工作流组织参考；本版未复制这三个项目的源码，继续保留后续按模块评估和注明来源的路径。
- 夜景三猫美术由本项目参考图迭代确定；实际背景素材为同版无菜单文字素材，文字/按钮/选中效果由应用实时渲染。发布素材为 WebP 编码，原生成图另存，不覆盖原稿。

- RunningHub 按官方工作流 API 文档适配；接口与引用见 RUNNINGHUB.md。Android 凭据存储使用系统 Android Keystore / AES-GCM 与 Capacitor 自定义桥接，不引入第三方密钥 SDK。
