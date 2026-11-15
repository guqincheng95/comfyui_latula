# 通用工作流装配

目标是输入结构驱动的通用客户端，不为每份工作流硬编码页面、节点编号、输入表单或功能名称。

## 输入信息

- API 图：class_type、inputs、连接关系和当前值。
- object_info：真实输入/输出类型、下拉选项、可选端口和范围；本机/云 ComfyUI 直接获取，RunningHub 可通过其官方原生 ComfyUI 代理只读获取。代理密钥 URL 不保存到工作流/任务/日志；安卓直接使用原生 HTTP，关闭插件日志。
- 可选画布：普通工作流的分组标题、节点位置/端口和 mode 信息。未出现在 API 图里的节点不假装可以恢复。
- 节点类型能力：少量版本明确的标准/扩展节点离线能力，复用于任何工作流；服务端声明优先。没有完整定义时明确显示选项来源，并阻止未确认的新增图像端口提交。

## 运行模型

一份配置保存完整图和全部字段。runtime.outputs 是本次参与输出的入口；runtime.nodeModes 保存 enabled / bypass / muted。运行页控制模块与节点状态，不切换到其他配置。参数按稳定字段 ID 保存，本次 Files 在模块切换间保留，生成前仅选择当前路径的素材上传。

compileGraph 按字段值解析实际路径和 ComfySwitchNode，旁路通过同类型输入重接被引用的输出，重接不唯一时拒绝；停用后仍被活动路径依赖时拒绝。共享依赖只保留一次。UI 控件和提交图使用同一编译结果。历史任务保存运行状态、参数及工作流快照；复用不自动提交。

## 媒体与遮罩

未知类名只要有 IMAGE 端口定义即可自动生成入口。多个可选端口组成参考图架，批量选择按端口顺序填入。新增图像文件先上传，再创建标准 LoadImage，将节点输出连接到目标端口。

图片加载节点的 MASK 输出被使用时显示遮罩画板；可选 MASK 端口可单独导入/绘制。遮罩绘制在手机 canvas 完成，黑色保护、白色修改，导出与原图尺寸一致的 PNG。上传后创建 LoadImageMask（channel=red），重接原 MASK 依赖，保留原图颜色。原始 API 图不被永久破坏。

## 来源与边界

- https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287337
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_qwen.py
- https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/utils/executionUtil.ts
- https://github.com/goohai/Goohaitools-comfyui/blob/master/nodes/Text%20Encode%20Qwen%20Image%202.1%20GH.py
- https://github.com/goohai/Goohaitools-comfyui/blob/master/nodes/%E5%8A%A0%E8%BD%BD%E5%9B%BE%E5%83%8F.py

仅据官方/原作者接口定义实现兼容行为，未复制第三方节点源码。未知复杂前端 Widget 的行为不能从标量 JSON 反推出；通用解析和类型能力扩展与「给每个工作流单独调试」不同，不能承诺所有未来自定义脚本零适配。

## 验证原则

使用未在类型适配表中的合成类名和多组随机偏移节点 ID，验证服务端元数据驱动的下拉、多图和旁路；混合与真实用户工作流的离线结构检查。浏览器检查模块切换/草稿/图片保留、模型/采样器选择、笔刷/撤销/清空/反选以及导出黑白 PNG 像素。安卓检查原生上传、运行快照、密钥恢复。模拟协议通过不表示真实模型生成已验收。
