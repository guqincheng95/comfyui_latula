# RunningHub 适配

协议来源为 RunningHub 官方文档（2026-11-15 核对），未复制第三方客户端代码。

| 操作 | 接口 |
|---|---|
| 读取 API JSON | POST /api/openapi/getJsonApiFormat |
| 文件上传 | POST /openapi/v2/media/upload/binary |
| 创建工作流任务 | POST /task/openapi/create |
| 查询结果 | POST /openapi/v2/query |

- 固定域名 https://www.runninghub.cn，鉴权 Authorization: Bearer；旧版工作流/创建接口同时按官方示例传 apiKey。禁止从粘贴 URL 改变 API 域名。
- 工作流与任务 ID 均保持字符串，避免 64 位 ID 被 JavaScript 数字舍入。
- 官方高级接口支持字符串 workflow 完整 JSON；指定时优先于 workflowId。客户端裁剪所选输出的依赖闭包，保留节点 ID/连线。独立其他输出和比较预览不提交；依赖中的开关逻辑由服务端节点执行，不模拟浏览器分组状态。
- 使用读到/导入的 JSON 运行，不把原生 ComfyUI /prompt 请求误发到平台首页。读取云端 JSON 会替换装配台 JSON，保存前核对分支。
- 新媒体填入上传返回的 fileName，不把 download_url 当成 ComfyUI 节点文件名。手机本地文件不会直接写进云端路径。
- 启用字段映射为 nodeId/fieldName/fieldValue；数值/布尔值保留类型，连线不当成基础值。显式提供固定 seed，-1 在提交时变成实际随机值并记录。
- 一次点击创建一次任务；忙碌锁在任何异步动作前设置。创建超时或响应不确定记为待确认，不自动重提。重启只恢复查询，不重建任务。
- Android 私密桥接插件通过系统 Android Keystore 生成 AES-GCM 密钥，加密 API Key 后仅存应用私有偏好文件；关闭原生插件日志和系统应用数据备份。配置/历史不存平台凭据；网页只保存内存会话。
- 不实现平台账户登录、AI 应用 webappId、余额读取、专用队列或任务取消。使用用户输入的个人 Key，不在 APK 内置共享付费 Key。
- 目前不绘制遮罩，不自动迁移模型/安装节点，不承诺任意自定义控件适配。LoadImageGoohai 已映射 image 为素材，缓存预览控件剔除，系统模板归入高级输入。

## 官方参考

- https://www.runninghub.cn/runninghub-api-doc-cn/api-425749013
- https://www.runninghub.cn/runninghub-api-doc-cn/api-425749014
- https://www.runninghub.cn/runninghub-api-doc-cn/api-425749007
- https://www.runninghub.cn/runninghub-api-doc-cn/api-425767306
- https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287336

## 检查

npm test 覆盖 ID 精度/恶意链接、分支裁剪、字段与上传路径、种子、鉴权与固定域名、单次创建/错误脱敏、状态结果。ui-check 和 android-smoke 均以本地模拟服务验证，不连接真实 RunningHub 账户，不消耗平台额度。Android 检查包含密钥密文及冷启动解密；实际平台生成尚未验证。
