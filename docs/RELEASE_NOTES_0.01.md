拉图 0.01 初航测试版。请在下方 **Assets / 资源** 下载 `latula-v0.01-test.apk`，手机安装即可；Source code 是源码压缩包。

本版支持夜景三猫主页、统一内页、ComfyUI API 格式 JSON 导入与模块化自动装配、素材上传/任务提交/结果展示、历史图鉴、收藏和参数复用。

使用顺序：装配工作流 → 导入 API JSON → 填写手机可访问的电脑/自建云端 ComfyUI 地址 → 测试连接 → 保存并装配 → 进入工作流。

验证：核心单元测试、浏览器协议回归及 Android 15 模拟器安装流程已通过。协议检查使用模拟服务，真实 GPU 出图、真机文件选择、视频兼容与系统分享仍需试用。本版尚未接入 RunningHub 专有接口。

本次直接发布已验证的安装包，未重新打包；源码提交 `7b14be8e580e6b4a48edad170db08d72713f4b4e`。

SHA-256：`54018d34958ce402fcfbee2a6eec8a214e231ce7927ea0e45753f55b78202971`。

[构建与 Android 实装验证](https://github.com/guqincheng95/comfyui_latula/actions/runs/43632068504) · [详细测试说明](https://github.com/guqincheng95/comfyui_latula/blob/main/docs/RELEASE_0.01.md)
