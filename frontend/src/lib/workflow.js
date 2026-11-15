export const DISPLAY_VERSION = '0.04.1'
export const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'INTERRUPTED'])
export const STATUS = { UPLOADING: '上传中', SUBMITTING: '提交中', SUBMITTED: '已提交', PENDING: '排队中', RUNNING: '生成中', SUCCEEDED: '已完成', FAILED: '失败', CANCELED: '已取消', REVIEW: '提交状态待确认', INTERRUPTED: '上传已中断' }
export const copy = value => JSON.parse(JSON.stringify(value))
export const uid = () => globalThis.crypto?.randomUUID?.() || 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)
const safeKey = key => !['__proto__', 'prototype', 'constructor'].includes(key)
export function normalizeAddress(value, { allowLoopback = true } = {}) {
  let text = (value || '').trim().replace(/\/+$/, '')
  if (!text) throw new Error('请填写服务地址')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) throw new Error('仅支持 http/https 服务')
  if (!/^https?:\/\//i.test(text)) text = 'http://' + text
  let url
  try { url = new URL(text) } catch { throw new Error('服务地址格式不正确。请填写 http://电脑局域网IP:8188，IP 和端口之间使用英文冒号。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('使用 http/https 服务地址，不在地址里填写密钥或查询参数')
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]') throw new Error('0.0.0.0 是服务监听地址，请改填电脑的实际局域网 IP 或云端域名。')
  if (!allowLoopback && (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || /^127\./.test(url.hostname) || url.hostname === '[::1]')) throw new Error('手机中的 127.0.0.1 / localhost 指向手机自身，无法访问电脑。请填写电脑局域网 IP，例如 http://192.168.1.8:8188。')
  return url.href.replace(/\/+$/, '')
}
export function parseWorkflow(raw) {
  if (typeof raw === 'string' && raw.length > 4 * 1024 * 1024) throw new Error('工作流文件超过 4 MB')
  let value
  try { value = typeof raw === 'string' ? JSON.parse(raw) : copy(raw) } catch { throw new Error('无法解析 JSON，请选择导出的 API 格式工作流') }
  if (Array.isArray(value?.nodes) || Array.isArray(value?.links)) throw new Error('这是节点编辑器格式。请在 ComfyUI 中导出「API 格式」JSON 后重新导入。')
  const graph = value?.prompt && typeof value.prompt === 'object' ? value.prompt : value
  if (!graph || Array.isArray(graph) || typeof graph !== 'object') throw new Error('工作流必须是 API 格式的节点对象')
  const entries = Object.entries(graph)
  if (!entries.length || entries.length > 1500) throw new Error('工作流为空或节点数量过多')
  for (const [id, node] of entries) {
    if (!safeKey(id) || !node || typeof node.class_type !== 'string' || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) throw new Error('节点 ' + id + ' 缺少 class_type 或 inputs，请使用 API 格式')
    if (Object.keys(node.inputs).some(key => !safeKey(key))) throw new Error('工作流包含不支持的字段名称')
  }
  return copy(graph)
}
export function isLink(value, graph) {
  return Array.isArray(value) && value.length === 2 && typeof value[1] === 'number' && graph[String(value[0])]
}
const labels = { width: '宽度', height: '高度', batch_size: '生成数量', seed: '随机种子', noise_seed: '随机种子', steps: '采样步数', cfg: '提示词引导', denoise: '重绘强度', sampler_name: '采样器', scheduler: '调度器', ckpt_name: '模型', unet_name: '扩散模型', lora_name: 'LoRA', strength_model: '模型强度', strength_clip: '文本强度', text: '提示词', prompt: '提示词', positive: '正向提示词', negative: '反向提示词', text_g: '全局提示词', text_l: '局部提示词', clip_l: 'CLIP 提示词', t5xxl: 'T5 提示词', image: '参考图片', video: '参考视频', audio: '音频素材', filename_prefix: '输出文件前缀', fps: '帧率', frame_rate: '帧率', length: '帧数', guidance: '引导强度' }
const common = new Set(['width', 'height', 'batch_size', 'seed', 'noise_seed', 'steps', 'cfg', 'denoise', 'sampler_name', 'scheduler', 'guidance'])
// A registry of adapters, rather than a separate screen per workflow.
// Add a class-specific field resolver here when a custom node needs special handling.
export const NODE_ADAPTERS = [
  { match: name => /^(LoadImage|LoadImageMask|LoadImageOutput|LoadImageGoohai)$/.test(name), file: { image: 'image' } },
  { match: name => /^(VHS_LoadVideo|LoadVideo)$/.test(name), file: { video: 'video', file: 'video' } },
  { match: name => /^(LoadAudio|VHS_LoadAudio)$/.test(name), file: { audio: 'audio' } },
  { match: name => /CLIPTextEncode|TextEncode|Prompt|String|Text/i.test(name), multiline: true },
]
function branchRoles(graph) {
  const roles = {}
  const walk = (id, role, seen = new Set()) => {
    id = String(id)
    if (!graph[id] || seen.has(id)) return
    seen.add(id)
    if (/TextEncode/.test(graph[id].class_type)) roles[id] = role
    for (const input of Object.values(graph[id].inputs)) if (isLink(input, graph)) walk(input[0], role, seen)
  }
  for (const node of Object.values(graph)) {
    for (const role of ['positive', 'negative']) if (isLink(node.inputs[role], graph)) walk(node.inputs[role][0], role)
  }
  return roles
}
export function assembleWorkflow(graph, objectInfo = null) {
  const fields = [], warnings = [], roles = branchRoles(graph)
  const roots = Object.keys(graph).filter(id => /^(SaveImage|PreviewImage|VHS_VideoCombine|SaveAudio|SaveVideo)$/.test(graph[id].class_type) || objectInfo?.[graph[id].class_type]?.output_node)
  const ancestors = new Set()
  function trace(id) { if (ancestors.has(id)) return; ancestors.add(id); for (const value of Object.values(graph[id].inputs)) if (isLink(value, graph)) trace(String(value[0])) }
  roots.forEach(trace)
  const unsupported = []
  for (const [nodeId, node] of Object.entries(graph)) {
    const schema = objectInfo?.[node.class_type]
    if (objectInfo && !schema) unsupported.push(node.class_type)
    const definition = { ...schema?.input?.required, ...schema?.input?.optional }
    const adapter = NODE_ADAPTERS.find(a => a.match(node.class_type))
    let count = 0
    for (const [name, value] of Object.entries(node.inputs)) {
      if (isLink(value, graph) || value === null || typeof value === 'object') continue
      // Preview widgets echo another linked value; editing their cached text does not alter that value.
      if (/showAnything/i.test(node.class_type) && name === 'text') continue
      const meta = definition?.[name], type = meta?.[0], opts = meta?.[1] || {}
      let kind = typeof value === 'boolean' ? 'toggle' : typeof value === 'number' ? 'number' : 'text'
      if (Array.isArray(type)) kind = 'select'
      else if (type === 'INT' || type === 'FLOAT') kind = 'number'
      else if (type === 'BOOLEAN') kind = 'toggle'
      if (adapter?.file?.[name]) kind = adapter.file[name]
      else if (opts.image_upload) kind = 'image'
      else if (opts.video_upload) kind = 'video'
      else if (opts.audio_upload) kind = 'audio'
      else if (typeof value === 'string' && (opts.multiline || /^(text|prompt|positive|negative|clip_l|t5xxl)$/.test(name) || (/TextEncode/.test(node.class_type) && /^(text_g|text_l)$/.test(name)) || (adapter?.multiline && /value|string/i.test(name)))) kind = 'textarea'
      const file = ['image', 'video', 'audio'].includes(kind)
      const role = roles[nodeId]
      let label = labels[name] || name
      if (kind === 'textarea' && /^(value|string)$/.test(name) && node._meta?.title) label = node._meta.title
      if (kind === 'textarea' && role) label = role === 'negative' ? '反向提示词' : '正向提示词'
      const enabled = !(file && roots.length && !ancestors.has(nodeId))
      if (!enabled) warnings.push('素材节点「' + (node._meta?.title || node.class_type) + '」未连接到已识别的媒体输出，已默认停用此输入。可在模块调整中重新启用；原工作流节点保持不变。')
      const template = kind === 'textarea' && (/system.?prompt|固定提示词|系统提示词/i.test(node._meta?.title || '') || String(value).length > 2048)
      const options = kind === 'select' ? type.map(String) : undefined
      const optionMissing = !!options && !options.includes(String(value))
      if (optionMissing) options.unshift(String(value))
      fields.push({ id: nodeId + '::' + name, nodeId, name, label, nodeTitle: node._meta?.title || node.class_type, kind, default: value, valueType: typeof value, enabled, advanced: template || !(file || kind === 'textarea' || common.has(name)), min: opts.min, max: opts.max, step: opts.step || (type === 'INT' || Number.isInteger(value) ? 1 : 0.01), options, optionMissing })
      count++
    }
    if (!count && !schema && !adapter && !/Save|Encode|Decode|Loader|Sampler|Latent|Conditioning|Model|ImageScale|Preview|showAnything|Comparer/.test(node.class_type)) warnings.push('节点 ' + (node._meta?.title || node.class_type) + ' 未发现可编辑的基础字段；特殊交互可能需要适配。')
  }
  if (unsupported.length) warnings.unshift('服务端未安装或未提供定义：' + [...new Set(unsupported)].join('、'))
  return { fields, warnings, missing: [...new Set(unsupported)], nodeCount: Object.keys(graph).length }
}
export function defaults(fields) { return Object.fromEntries(fields.map(field => [field.id, field.default])) }
export function materializeGraph(graph, fields, values, uploaded = {}) {
  const result = copy(graph)
  for (const field of fields) {
    if (field.virtualImage || field.virtualMask || !result[field.nodeId] || !safeKey(field.name)) continue
    const value = uploaded[field.id] ?? values[field.id] ?? field.default
    if (field.path) {
      let target = result[field.nodeId].inputs[field.name]
      if (!target || typeof target !== 'object') continue
      for (const part of field.path.slice(0, -1)) { if (!safeKey(part) || !target[part] || typeof target[part] !== 'object') { target = null; break }; target = target[part] }
      const key = field.path.at(-1)
      if (target && safeKey(key)) target[key] = value
    } else result[field.nodeId].inputs[field.name] = value
  }
  return result
}
export function validateValues(fields, values, files = {}) {
  for (const field of fields) {
    if (field.enabled === false) continue
    const value = values[field.id] ?? field.default
    if (['image', 'video', 'audio'].includes(field.kind)) {
      if (!field.optional && !files[field.id] && !String(value || '').trim()) throw new Error('请选择' + field.label)
    } else if (field.kind === 'number') {
      if (value === '' || value === null || !Number.isFinite(Number(value))) throw new Error(field.label + '需要有效数字')
      if (['seed', 'noise_seed'].includes(field.name) && Number(value) === -1) continue
      if ((field.min !== undefined && Number(value) < field.min) || (field.max !== undefined && Number(value) > field.max)) throw new Error(field.label + '超出节点允许范围')
    }
  }
}
export function resultKind(url, format = '') {
  return /video|\.mp4|\.webm|\.mov|\.mkv/i.test(format + ' ' + url) ? 'video' : /audio|\.mp3|\.wav|\.flac/i.test(format + ' ' + url) ? 'audio' : 'image'
}
export function comfyOutputs(history, address) {
  const outputs = []
  for (const [nodeId, data] of Object.entries(history?.outputs || {})) {
    for (const category of ['images', 'gifs', 'videos', 'audio']) {
      for (const item of data[category] || []) {
        if (!item?.filename) continue
        const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder || '', type: item.type || 'output' })
        const url = address + '/view?' + query
        outputs.push({ id: nodeId + '-' + outputs.length, url, filename: item.filename, kind: resultKind(item.filename, item.format || (category === 'videos' ? 'video' : category === 'audio' ? 'audio' : '')), nodeId })
      }
    }
  }
  return outputs
}
