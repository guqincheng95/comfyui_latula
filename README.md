# 拉图 · comfyui_latula

「拉图」是连接 ComfyUI 或其他 AI API 的 Android 前端，名称寓意从工作流或 API 中拉取图片与生成结果。复用原 Act-Two-Mobile 仓库。

APK 负责提供直观方便的操作界面：选择应用与服务、填写提示词和参数、上传素材、提交请求、查看任务，以及预览、下载和管理结果。图片、视频的生成和模型推理由所连接的电脑或云端服务执行，APK 本身不承担生成算力。

以上描述为产品定位；当前已实现与后续计划的能力以下文为准。

当前版本：0.3.0（项目改名与二次开发准备）。APK 中文显示名称为「拉图」，仓库名称为 `comfyui_latula`。

现有可调用模块仍为 Runway Act-Two。RunningHub AI 应用、RunningHub 工作流、本地及自建云 ComfyUI 是后续接入方向，当前尚未实现，不将它们展示为可用功能。

二次开发路线、接口分类、复用评估与验收标准见 [二次开发路线](docs/REDEVELOPMENT.md)。

Android applicationId 保持 `com.acttwomobile.app`，原后端地址和任务记录使用的存储键保持兼容。能否覆盖安装还取决于相同签名和递增的 Android versionCode；现有 CI 仍为 debug 构建，尚未建立固定签名基线。

## 已实现
- 手机端上传角色参考图
- 手机端上传动作参考视频
- Act-Two 参数：表情强度、身体控制、输出比例、Seed
- FastAPI 后端安全持有 Runway API Key
- 素材先上传为 Runway ephemeral asset，再创建 Character Performance 任务
- 前端轮询任务状态
- 生成完成后在线播放与下载结果

## 技术栈
- Frontend: Vue 3 + Vite
- Backend: Python + FastAPI
- Runway SDK: runwayml
- Model: act_two

## 本地运行

### 1. 后端
```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

在 `.env` 中填写：
```env
RUNWAYML_API_SECRET=key_xxx
```

启动：
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. 前端
```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

电脑与 Android 手机处于同一局域网时，可通过电脑局域网 IP 访问 Vite 页面。

## 安全
- API Key 只允许存在于后端 `.env`
- `.env` 已加入 `.gitignore`
- 前端不会接触 Runway API Key

## 当前限制
真实生成仍需要在运行环境中配置用户自己的 Runway API Key 与可用 API Credits。
