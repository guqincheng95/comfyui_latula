import { copy, isLink, assembleWorkflow, materializeGraph } from './workflow.js'

// Capabilities belong to node TYPES, never workflow IDs or node numbers.
// Server object_info is authoritative; these standard capabilities are an offline fallback.
const imageInputs = (prefix, start, count, digits = 0) => Object.fromEntries(Array.from({ length: count }, (_, i) => [prefix + String(i + start).padStart(digits, '0'), ['IMAGE']]))
const FALLBACK = {
  LoadImage: { input: { required: { image: ['STRING'] } }, output: ['IMAGE', 'MASK'] },
  LoadImageGoohai: { input: { required: { image: ['STRING'] } }, output: ['IMAGE', 'MASK', 'STRING'] },
  LoadImageMask: { input: { required: { image: ['STRING'], channel: [['alpha', 'red', 'green', 'blue']] } }, output: ['MASK'] },
  LoraLoader: { input: { required: { model: ['MODEL'], clip: ['CLIP'] } }, output: ['MODEL', 'CLIP'] },
  LoraLoaderModelOnly: { input: { required: { model: ['MODEL'] } }, output: ['MODEL'] },
  TextEncodeQwenImageEditPlus: { input: { optional: { image1: ['IMAGE'], image2: ['IMAGE'], image3: ['IMAGE'], vae: ['VAE'] } }, output: ['CONDITIONING'] },
  TextEncodeQwenImage21: { input: { optional: imageInputs('images.image_', 1, 16) }, output: ['CONDITIONING', 'CONDITIONING', 'LATENT'] },
  TextEncodeQwenImage21GH: { input: { required: { mode: [['填充', '裁剪']], ref_image_size: [['自动', '768', '1024', '1344', '1536', '2048']] }, optional: { ...imageInputs('image_', 1, 10, 2), mask: ['MASK'] } }, output: ['CONDITIONING', 'CONDITIONING', 'LATENT'] },
}
const defs = schema => ({ ...schema?.input?.required, ...schema?.input?.optional })
export function nodeCatalog(graph, server = {}) {
  const result = {}
  for (const [id, node] of Object.entries(graph)) {
    const base = FALLBACK[node.class_type] || {}, remote = server[node.class_type] || {}
    const input = remote.input ? { required: { ...remote.input.required }, optional: { ...remote.input.optional } } : { required: { ...base.input?.required }, optional: { ...base.input?.optional } }
    // V3 autogrow uses a container definition; the class capability expands its concrete API port names.
    if (defs(remote).images && base.input?.optional && !Object.keys(defs(remote)).some(k => k.startsWith('images.'))) Object.assign(input.optional, base.input.optional)
    result[node.class_type] = { ...base, ...remote, input }
    // A dropdown can safely offer names already present in this workflow.
    // It must not pretend these are the server's complete model inventory.
    for (const [name, value] of Object.entries(node.inputs)) {
      if (typeof value !== 'string' || !/(_name|模型|采样器|调度器)$/.test(name) || name === 'filename_prefix') continue
      if (Array.isArray(defs(remote)[name]?.[0])) continue
      const options = [...new Set(Object.values(graph).filter(n => n.class_type === node.class_type).map(n => n.inputs[name]).filter(v => typeof v === 'string'))]
      input.required[name] = [options, { optionSource: '工作流已有值；同步节点定义可获取完整选项' }]
    }
  }
  return result
}
export function parseCanvasMetadata(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  const canvas = Array.isArray(value?.nodes) ? value : value?.workflow
  if (!Array.isArray(canvas?.nodes)) throw new Error('请选择普通 ComfyUI 画布 JSON（用于分组、端口和旁路信息）')
  const nodes = Object.fromEntries(canvas.nodes.map(n => [String(n.id), { title: n.title, mode: n.mode || 0, pos: n.pos, size: n.size, inputs: n.inputs || [], outputs: n.outputs || [] }]))
  const groups = (canvas.groups || []).map((g, index) => ({ id: String(index), title: g.title || '模块 ' + (index + 1), nodes: Object.entries(nodes).filter(([, n]) => {
    const [x, y, w, h] = g.bounding || []
    return n.pos && n.pos[0] >= x && n.pos[1] >= y && n.pos[0] <= x + w && n.pos[1] <= y + h
  }).map(([id]) => id) }))
  return { nodes, groups }
}
export function bypassLinks(graph, id, catalog = {}, canvas = {}) {
  const node = graph[id], schema = catalog[node?.class_type], definition = defs(schema)
  if (!node) throw new Error('节点不存在')
  const outputs = schema?.output || canvas.nodes?.[id]?.outputs?.map(p => p.type)
  const used = [...new Set(Object.values(graph).flatMap(n => Object.values(n.inputs).filter(v => isLink(v, graph) && String(v[0]) === id).map(v => v[1])))]
  const inputs = Object.entries(node.inputs).filter(([, v]) => isLink(v, graph))
  const result = {}
  for (const slot of used) {
    const type = outputs?.[slot]
    const candidates = inputs.filter(([name]) => {
      const t = definition[name]?.[0] || canvas.nodes?.[id]?.inputs?.find(p => p.name === name)?.type
      return type && type !== '*' && t === type
    })
    if (candidates.length !== 1) throw new Error('节点「' + (node._meta?.title || node.class_type) + '」的旁路连线无法唯一确定，需要完整端口定义')
    result[slot] = candidates[0][1]
  }
  if (!used.length) throw new Error('此节点没有需要透传的输出，使用停用控制')
  return result
}
export function compileGraph(graph, fields, values = {}, runtime = {}, catalog = {}, canvas = {}, uploaded = {}) {
  const input = materializeGraph(graph, fields, values, uploaded), result = {}, visiting = new Set(), controls = new Set()
  const modes = runtime.nodeModes || {}
  const roots = runtime.outputs?.length ? runtime.outputs : []
  function resolve(link, chain = new Set()) {
    const [source, slot] = link, id = String(source), node = input[id]
    if (!node) throw new Error('连接源节点不存在：' + id)
    if (chain.has(id)) throw new Error('旁路或开关形成了循环连接')
    const next = new Set(chain).add(id), mode = modes[id] || 'enabled'
    if (mode === 'muted') throw new Error('当前执行路径依赖已停用的节点「' + (node._meta?.title || node.class_type) + '」，请启用或选择其他模块')
    if (mode === 'bypass') { controls.add(id); return resolve(bypassLinks(input, id, catalog, canvas)[slot], next) }
    if (node.class_type === 'ComfySwitchNode' && typeof node.inputs.switch === 'boolean' && slot === 0) {
      controls.add(id)
      const chosen = node.inputs[node.inputs.switch ? 'on_true' : 'on_false']
      if (isLink(chosen, input)) return resolve(chosen, next)
    }
    trace(id)
    return [source, slot]
  }
  function trace(id) {
    if (result[id]) return
    if (visiting.has(id)) throw new Error('工作流包含循环连接')
    if (!input[id]) throw new Error('输出节点不存在')
    if (modes[id] === 'muted') return
    if (modes[id] === 'bypass') throw new Error('输出节点不能透传，请使用停用')
    visiting.add(id)
    const node = copy(input[id])
    for (const [name, value] of Object.entries(node.inputs)) if (isLink(value, input)) node.inputs[name] = resolve(value)
    result[id] = node; visiting.delete(id)
  }
  roots.forEach(id => trace(String(id)))
  if (!Object.keys(result).length) throw new Error('请在运行页面启用至少一个输出模块')
  return { graph: result, visible: new Set([...Object.keys(result), ...controls]) }
}
export function runtimeOutputs(graph, catalog = {}, canvas = {}) {
  const saved = Object.entries(graph).filter(([, n]) => catalog[n.class_type]?.output_node || /^(SaveImage|SaveVideo|SaveAudio|VHS_VideoCombine)$/.test(n.class_type))
  return (saved.length ? saved : Object.entries(graph).filter(([, n]) => n.class_type === 'PreviewImage')).map(([id, node], i) => {
    const group = canvas.groups?.filter(g => g.nodes.includes(id)).sort((a, b) => a.nodes.length - b.nodes.length)[0]
    return { id, label: group?.title || node._meta?.title || node.class_type + ' ' + (i + 1) }
  })
}
export function assembleGraphUI(graph, server = {}, previous = [], canvas = {}) {
  const catalog = nodeCatalog(graph, server), result = assembleWorkflow(graph, catalog), old = new Map(previous.map(f => [f.id, f]))
  for (const [id, node] of Object.entries(graph)) {
    const schema = catalog[node.class_type], definition = defs(schema)
    for (const [name, value] of Object.entries(node.inputs)) if (value && !Array.isArray(value) && typeof value === 'object' && !/Widget$/.test(value.type || '') && name !== 'rgthree_comparer') {
      const visit = (object, path = []) => {
        if (path.length > 2) return
        for (const [key, leaf] of Object.entries(object)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
          const route = [...path, key]
          if (leaf && !Array.isArray(leaf) && typeof leaf === 'object') { visit(leaf, route); continue }
          if (!['string', 'number', 'boolean'].includes(typeof leaf)) continue
          let kind = typeof leaf === 'boolean' ? 'toggle' : typeof leaf === 'number' ? 'number' : 'text', options
          if (/lora|model|ckpt/i.test(key)) {
            options = [...new Set(Object.values(graph).filter(n => n.class_type === node.class_type).flatMap(n => Object.values(n.inputs)).filter(v => v && typeof v === 'object' && typeof v[key] === 'string').map(v => v[key]))]
            if (options.length) kind = 'select'
          }
          result.fields.push({ id: id + '::' + name + '::' + JSON.stringify(route), nodeId: id, name, path: route, label: [name, ...route].join(' / '), nodeTitle: node._meta?.title || node.class_type, default: leaf, valueType: typeof leaf, kind, options, enabled: true, advanced: true, optionSource: options ? '工作流结构化参数中已有值' : undefined, step: Number.isInteger(leaf) ? 1 : 0.01 })
        }
      }
      visit(value)
    }
    const imagePorts = Object.entries(definition).filter(([, d]) => d?.[0] === 'IMAGE')
    function mediaSources(source, seen = new Set()) {
      if (seen.has(source) || !graph[source]) return []
      seen.add(source)
      const direct = result.fields.filter(f => f.nodeId === source && f.kind === 'image' && !f.virtualImage)
      if (direct.length) return direct
      return Object.values(graph[source].inputs).filter(v => isLink(v, graph)).flatMap(v => mediaSources(String(v[0]), seen))
    }
    if (imagePorts.length > 1) for (const [name] of imagePorts) if (isLink(node.inputs[name], graph)) {
      const sources = [...new Map(mediaSources(String(node.inputs[name][0])).map(f => [f.id, f])).values()]
      if (sources.length === 1 && !sources[0].mediaGroup) sources[0].mediaGroup = id
    }
    for (const [name] of imagePorts) {
      if (node.inputs[name] !== undefined && node.inputs[name] !== null) continue
      result.fields.push({ id: id + '::' + name, nodeId: id, name, label: name, nodeTitle: node._meta?.title || node.class_type, kind: 'image', default: '', enabled: true, advanced: false, virtualImage: true, optional: !schema.input.required?.[name], mediaGroup: imagePorts.length > 1 ? id : undefined })
    }
    for (const [name, type] of Object.entries(definition)) if (type?.[0] === 'MASK' && !isLink(node.inputs[name], graph)) {
      const firstImage = imagePorts.find(([key]) => isLink(node.inputs[key], graph))
      const source = firstImage ? mediaSources(String(node.inputs[firstImage[0]][0]))[0] : null
      result.fields.push({ id: id + '::' + name, nodeId: id, name, label: '遮罩 · ' + name, nodeTitle: node._meta?.title || node.class_type, kind: 'image', default: '', enabled: true, advanced: false, virtualMask: true, maskReference: source?.id || (imagePorts[0] ? id + '::' + imagePorts[0][0] : undefined), optional: !schema.input.required?.[name] })
    }
    for (const field of result.fields.filter(f => f.nodeId === id)) {
      const optionSource = definition[field.name]?.[1]?.optionSource
      if (optionSource) field.optionSource = optionSource
      if (field.kind === 'image' && !field.virtualImage) {
        const slot = schema?.output?.indexOf('MASK')
        if (slot >= 0 && Object.values(graph).some(n => Object.values(n.inputs).some(v => isLink(v, graph) && String(v[0]) === id && v[1] === slot))) field.maskSlot = slot
      }
      if (field.name === 'switch' && field.kind === 'toggle') { field.advanced = false; field.label = node._meta?.title || '路径开关' }
    }
  }
  result.fields = result.fields.map(field => {
    const saved = old.get(field.id)
    return saved ? { ...field, label: saved.label, enabled: saved.enabled ?? field.enabled, advanced: saved.advanced, kind: saved.customKind ? saved.kind : field.kind, customKind: saved.customKind } : field
  })
  return { ...result, catalog }
}
export function materializeMedia(graph, fields, values, uploaded) {
  const result = copy(graph), ids = new Set(Object.keys(result)); let next = Math.max(0, ...Object.keys(result).map(Number).filter(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000)) + 1
  const create = (type, inputs) => { while (ids.has(String(next))) next++; const id = String(next++); ids.add(id); result[id] = { class_type: type, inputs }; return id }
  for (const field of fields) {
    if (field.enabled === false) continue
    if (field.virtualImage) {
      const filename = uploaded[field.id] || values[field.id]
      if (filename && typeof filename !== 'string') throw new Error('图像端口需要有效的服务端文件名')
      if (filename && result[field.nodeId]) result[field.nodeId].inputs[field.name] = [create('LoadImage', { image: filename }), 0]
    }
    if (field.virtualMask) {
      const filename = uploaded[field.id] || values[field.id]
      if (filename && result[field.nodeId]) result[field.nodeId].inputs[field.name] = [create('LoadImageMask', { image: filename, channel: 'red' }), 0]
    }
    const mask = uploaded[field.id + '::$mask'] || values[field.id + '::$mask']
    if (mask && field.maskSlot !== undefined) {
      const loader = create('LoadImageMask', { image: mask, channel: 'red' })
      for (const node of Object.values(result)) for (const [name, value] of Object.entries(node.inputs)) if (isLink(value, result) && String(value[0]) === field.nodeId && value[1] === field.maskSlot) node.inputs[name] = [loader, 0]
    }
  }
  return result
}
