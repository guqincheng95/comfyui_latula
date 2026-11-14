# AI-Workflow-Mobile 二次开发路线

核对日期：2026-11-15。范围：资料核对、旧仓库复用评估、项目改名和后续技术路线。未进行任何平台扣费生成或生产服务器部署。

## 一、两条分类轴

客户端形态与调用方式是两回事。网页、PWA、WebView APK、原生 APK 都可以直接发 HTTP API 请求；WebSocket 是实时通信协议，不等于网页模拟点击。

| 项目 | 客户端/服务形态 | 生成调用方式 | 默认面向的执行端 |
| --- | --- | --- | --- |
| ComfyUI 官方示例 | Python 调用示例 | 原生 HTTP + WebSocket | 本地或远程自建 ComfyUI |
| ComfyChair | Kotlin + Jetpack Compose 原生 Android | ComfyUI API | 可连通的本地或远程 ComfyUI；不等于已适配平台专有接口 |
| ComfyUIMobileApp | Flutter Android 客户端 + Python 管理服务 | HTTP/WS 请求；配套 Python 服务负责启停、本机素材与状态管理 | 项目文档主要面向自己的电脑 |
| Comfy Remote | Web/PWA + Android WebView 外壳 | 网页代码直接调用 ComfyUI API | 项目文档主要面向局域网 ComfyUI |
| Salad comfyui-api | 服务端 API 包装层，无手机 UI | HTTP 接收任务，管理 ComfyUI 执行和输出 | 自建 GPU 本地机或云实例 |
| comfy-api-proxy | 官方服务端适配层，无手机 UI | 对外 v2 jobs/assets API，对内原生 ComfyUI API | 一代理对应一 ComfyUI；不提供多机路由 |
| 本仓库当前实现 | Vue + Capacitor APK + FastAPI | 手机请求自己的后端，后端请求 Runway；素材可临时授权直传 | Runway 云端模型 API |

上述项目均不是靠自动打开网站、填写网页、点击生成按钮来完成主链路。文档功能不代表已在本项目实测兼容。

## 二、执行端分类

| 类型 | 算力位置 | 谁准备模型和节点 | 典型提交方式 | 主要适配点 |
| --- | --- | --- | --- | --- |
| 本地电脑 ComfyUI | 自己电脑 GPU | 自己 | API 格式 graph → /prompt | 地址可达、上传文件名、节点参数、队列、结果路径 |
| 自建云 ComfyUI | 租用云 GPU | 自己或镜像维护者 | 原生接口，或自行包装后的接口 | 鉴权、实例启停、模型与节点版本、文件保存 |
| 平台工作流 API | RunningHub 等平台 GPU | 平台环境 + 你配置工作流 | workflowId + 可改节点参数，按具体接口支持提交 graph | 平台鉴权、上传协议、任务状态、额度、节点支持 |
| 平台 AI 应用 API | 平台 GPU | AI 应用作者与平台 | webappId + 应用开放参数 | 应用字段、授权可调用范围、任务及结果接口 |
| 模型 API | 模型厂商云端 | 厂商 | model + 厂商定义输入 | 模型参数和输出协议；Runway Act-Two 属于此类 |

本地与自建云可以使用相同的 ComfyUI 协议，但传输、鉴权和部署不同。平台的专有工作流/AI 应用接口不能仅通过更换 URL 接入原生客户端。RunningHub 另提供原生 ComfyUI 兼容代理，官方给出了第三方客户端接入说明；这条路径可尝试复用原生协议客户端，但需验证该客户端的实际调用接口、平台模型/节点和并发条件，不等于支持 webappId 应用接口。

## 三、RunningHub 接入依据

官方提供 AI 应用与 ComfyUI 工作流两组入口。AI 应用入口 `POST /task/openapi/ai-app/run` 使用 `webappId`、鉴权信息和 `nodeInfoList`，返回 `taskId` 等数据。节点参数通常由 nodeId、fieldName、fieldValue 表示，文件上传后把平台返回的 fileName 填入相应字段。

实施时应按选定接口的当前文档核对鉴权位置和请求体，不能把平台示例里的中转服务路由误当成平台路由。webappId/workflowId 在 JavaScript 中应按字符串管理，避免大整数精度丢失，并按接口要求序列化。

官方 AI 应用示例说明旧 `/task/openapi/status` 已停止维护；接入时核对当前结果查询接口。不能复用旧博客里的查询代码而不验证。

界面先参照 RunningHub 的应用卡片、表单、结果和历史体验。第一阶段维护人工审核的应用配置；平台字段可用于辅助导入，但不承诺任意工作流自动生成完美表单。

## 四、仓库复用结论

保留原仓库，不新开项目。理由是 APK 打包、前后端边界和异步任务链路都已存在。

| 现有模块 | 处理方式 |
| --- | --- |
| Vue/Vite 页面、样式、素材预览 | 复用；后续拆成应用列表、动态表单、任务和结果组件 |
| Capacitor Android 配置、Actions | 复用；APK 改显示名称，applicationId 保持兼容 |
| FastAPI 服务 | 复用；逐步增加应用目录、平台适配和任务记录 |
| Runway SDK 及直传/中转逻辑 | 保留为 Runway 模块，不能直接用于 RunningHub 上传 |
| 本地任务编号保存与轮询恢复 | 复用思路；目前只存单个 Runway 活跃任务，需增加 provider、appId、服务地址、输入快照和版本 |
| 输出视频播放与下载 | 复用；扩展图片、多个结果、历史记录与失效链接处理 |
| 原日本阿里云后端 | 历史部署记录，不作为新架构的固定依赖；本次未访问或修改该服务器 |

当前缺少平台适配、应用配置目录、多任务历史、服务端持久化任务映射、用户鉴权及资源隔离。现有通配 CORS 不等于鉴权，不宜直接作为多人公网服务开放。

## 五、分阶段二次开发

1. 项目准备：改名、确认复用边界、保存架构与验收说明。此阶段不表示 RunningHub 已接通。
2. 单应用验证：选择一个有 API 调用权限的 RunningHub AI 应用，后端配置密钥；完成字段获取、素材上传、提交、查询、结果展示。Key 不进入 APK。
3. 应用目录与表单：配置 appId、名称、封面、provider、执行模式、远程 ID、字段类型、范围、默认值及节点映射。添加一个相同协议的新应用时只增加配置；遇到新协议或特殊控件仍需开发。
4. 统一任务：内部 taskId 与 provider taskId 分开保存；后端保存任务映射和状态，手机断线后能恢复；超时提交先确认是否创建成功，禁止盲目重试造成重复扣费。
5. 执行端扩展：增加原生 ComfyUI 适配，用同一表单对接本地电脑和自建云；RunningHub 工作流与 AI 应用分别适配。原 Runway 模块继续保留。
6. 稳定与分发：多任务、历史收藏、结果归档、并发限制、日志脱敏；固定签名与递增 versionCode；再做公网部署和商业功能。

建议先完成 RunningHub AI 应用闭环，贴近本轮参考产品；本地 ComfyUI 随后接入。无需为第一轮验证购买专用 GPU 服务器。是否切换云 GPU 取决于所选工作流实测耗时、调用量和费用。

## 六、建议的接口与模块边界（尚未实现）

手机只认识应用字段、内部任务 ID 和统一状态。后端识别 provider，分别完成 upload、submit、query、可选 cancel；不支持取消的来源应明确返回不支持。

应用配置应区分 `comfyui`（本地/云端是部署属性）、`runninghub_app`、`runninghub_workflow` 和 `runway`。任务状态统一为提交中、排队、运行、成功、失败、取消；另保存原始状态和错误码。

不要把全局 ComfyUI `/interrupt` 当成任意用户的单任务取消。实时连接仅作为进度辅助，结果查询和任务记录承担恢复依据。

所有用户文件先绑定所属应用/用户，远程文件 ID 不跨 provider 混用。结果链接可能失效，应按用户选择归档原文件；任务元数据与下载文件分别管理。

## 七、验收条件

- 选定 AI 应用的提示词、图片和参数准确传入对应字段。
- 生成中切后台、断网、重开后恢复同一个任务；不重复提交。
- 额度不足、参数错误、排队、平台失败和查询暂时失败可区分。
- 图片、视频及多结果展示正常，保存后的文件可打开。
- APK 不包含平台 Key，日志不输出 Key 或带签名的临时 URL。
- 添加第二个已支持协议的应用主要通过配置完成。
- 保留原 Runway 功能，旧存储记录和包名不因改名失效。

## 八、核对来源

- RunningHub 开始：https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287334
- AI 应用完整接入示例：https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287339
- AI 应用任务接口：https://www.runninghub.cn/runninghub-api-doc-cn/api-425749010
- 工作流接入示例：https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287342
- nodeInfoList：https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287336
- 原生接口兼容：https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287337
- ComfyUI 官方接口：https://docs.comfy.org/development/comfyui-server/comms_routes
- ComfyChair：https://github.com/legal-hkr/comfychair
- ComfyUIMobileApp：https://github.com/deni2312/ComfyUIMobileApp
- Comfy Remote：https://github.com/MisterStepper/Comfy-App
- API 包装层：https://github.com/SaladTechnologies/comfyui-api
- 官方代理：https://github.com/Comfy-Org/comfy-api-proxy

本次验证以源码审阅、前端构建和 Python 编译检查为范围。未执行真实平台生成，未验证现有线上服务存活或手机真机行为；具体检查结果以同次开发日志为准。
