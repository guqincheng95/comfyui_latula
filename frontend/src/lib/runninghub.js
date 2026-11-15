import { assembleWorkflow, copy, isLink, materializeGraph, resultKind } from './workflow.js'
import { compileGraph, materializeMedia, nodeCatalog } from './graph-ui.js'

export const RUNNINGHUB_ORIGIN = 'https://www.runninghub.cn'
export function runningHubId(value) {
  const text = String(value || '').trim()
  if (/^\d{8,30}$/.test(text)) return text // Keep long platform IDs as strings, never Number.
  let url
  try { url = new URL(text) } catch { throw new Error('请粘贴 RunningHub 工作流完整链接或纯数字 ID') }
  if (url.protocol !== 'https:' || !['www.runninghub.cn', 'runninghub.cn'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('请使用 runninghub.cn 的 HTTPS 工作流链接')
  const match = url.pathname.match(/^\/workflow\/(\d{8,30})\/?$/)
  if (!match) throw new Error('这是其他页面，请复制 /workflow/数字ID 的工作流链接')
  return match[1]
}
export function outputBranches(graph) {
  if (!graph) return []
  const entries = Object.entries(graph)
  const saved = entries.filter(([, n]) => /^(SaveImage|SaveVideo|SaveAudio|VHS_VideoCombine)$/.test(n.class_type))
  return (saved.length ? saved : entries.filter(([, n]) => n.class_type === 'PreviewImage')).map(([id, node]) => ({ id, label: (node._meta?.title || node.class_type) + ' · 节点 ' + id }))
}
export function scopeGraph(graph, outputId) {
  if (!outputBranches(graph).some(b => b.id === outputId)) throw new Error('请选择本次执行的输出分支；不会默认执行整合文件的全部分支')
  const seen = new Set()
  function trace(id) {
    if (seen.has(id)) return
    if (!graph[id]) throw new Error('工作流连接到了不存在的节点 ' + id)
    seen.add(id)
    for (const value of Object.values(graph[id].inputs)) {
      if (Array.isArray(value) && value.length === 2 && Number.isInteger(value[1]) && typeof value[0] === 'string') {
        if (!graph[value[0]]) throw new Error('工作流连接到了不存在的节点 ' + value[0])
      }
      if (isLink(value, graph)) trace(String(value[0]))
    }
  }
  trace(outputId)
  return copy(Object.fromEntries(Object.entries(graph).filter(([id]) => seen.has(id))))
}
export function assembleRunningHub(graph, outputId, previous = []) {
  const result = assembleWorkflow(outputId ? scopeGraph(graph, outputId) : graph)
  const old = new Map(previous.map(field => [field.id, field]))
  result.fields = result.fields.map(field => {
    const saved = old.get(field.id)
    return saved ? { ...field, label: saved.label, enabled: saved.enabled ?? field.enabled, advanced: saved.advanced, kind: saved.customKind ? saved.kind : field.kind, customKind: saved.customKind } : field
  })
  return result
}
export function runningHubBody(workflow, values, uploaded = {}) {
  let graph = workflow.runtime ? workflow.graph : scopeGraph(workflow.graph, workflow.outputId)
  const fields = workflow.fields.filter(field => field.enabled !== false && graph[field.nodeId])
  const finalValues = copy(values)
  for (const field of fields) {
    const value = finalValues[field.id] ?? field.default
    if (field.kind === 'number') finalValues[field.id] = Number(value)
    if (['seed', 'noise_seed'].includes(field.name) && Number(value) === -1) finalValues[field.id] = Math.floor(Math.random() * 4294967295)
  }
  const materialized = workflow.runtime ? compileGraph(materializeMedia(graph, fields, finalValues, uploaded), fields, finalValues, workflow.runtime, nodeCatalog(graph, workflow.objectInfo), workflow.canvas, uploaded).graph : materializeGraph(graph, fields, finalValues, uploaded)
  // Explicit seeds prevent the platform from replacing a fixed seed. No connection arrays are sent as overrides.
  const nodeInfoList = []
  for (const [nodeId, node] of Object.entries(materialized)) for (const [fieldName, fieldValue] of Object.entries(node.inputs)) {
    if ((['seed', 'noise_seed'].includes(fieldName) || fields.some(f => f.nodeId === nodeId && f.name === fieldName)) && fieldValue !== null && typeof fieldValue !== 'object') nodeInfoList.push({ nodeId, fieldName, fieldValue })
  }
  return { body: { workflowId: runningHubId(workflow.workflowId), workflow: JSON.stringify(materialized), nodeInfoList, instanceType: workflow.instanceType || 'default' }, values: { ...finalValues, ...uploaded } }
}
export function runningHubResult(payload, taskId) {
  if (payload?.code !== undefined && Number(payload.code) !== 0) throw new Error('RunningHub ' + payload.code + '：' + (payload.msg || payload.message || '查询失败'))
  const status = ({ SUCCESS: 'SUCCEEDED', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', ERROR: 'FAILED', CANCELED: 'CANCELED', CANCELLED: 'CANCELED', QUEUED: 'PENDING', PENDING: 'PENDING', RUNNING: 'RUNNING' })[payload?.status]
  if (!status) return { status: 'REVIEW', outputs: [], detail: '平台返回了未知任务状态，请在 RunningHub 核对任务；不会自动重新提交。' }
  const outputs = (payload.results || []).flatMap((item, index) => {
    let url
    try { url = new URL(item.url) } catch { return [] }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return []
    const kind = resultKind(url.href, item.outputType || '')
    const extension = String(item.outputType || (kind === 'video' ? 'mp4' : kind === 'audio' ? 'wav' : 'png')).replace(/[^a-zA-Z0-9]/g, '') || 'bin'
    return [{ id: String(index), url: url.href, filename: 'runninghub-' + taskId + '-' + index + '.' + extension, kind }]
  })
  const detail = status === 'FAILED' ? (payload.errorMessage || payload.errorCode || '平台工作流执行失败') : status === 'SUCCEEDED' ? (outputs.length ? 'RunningHub 结果已返回，请及时保存原文件' : '平台报告完成，但没有可用媒体结果，请检查输出节点') : status === 'PENDING' ? 'RunningHub 正在排队' : status === 'CANCELED' ? '平台任务已取消' : 'RunningHub 正在执行'
  return { status, outputs, detail }
}
