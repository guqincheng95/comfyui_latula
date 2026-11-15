<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import GameIcon from './components/GameIcon.vue'
import WorkflowField from './components/WorkflowField.vue'
import ReferenceInputs from './components/ReferenceInputs.vue'
import MaskEditor from './components/MaskEditor.vue'
import TaskThumb from './components/TaskThumb.vue'
import { assembleWorkflow, copy, defaults, DISPLAY_VERSION, normalizeAddress, parseWorkflow, STATUS, TERMINAL, uid, validateValues } from './lib/workflow'
import { loadConfig, saveConfig, loadTasks, saveTask, removeTask, clearThumbs } from './lib/storage'
import { checkConnection, submitTask, queryTask, cancelTask, readNodeDefinitions } from './lib/api'
import { downloadOutput, clearNativeCache } from './lib/media'
import { RUNNINGHUB_ORIGIN, runningHubId, outputBranches, assembleRunningHub, scopeGraph } from './lib/runninghub'
import { getRunningHubKey, setRunningHubKey, clearRunningHubKey } from './lib/credentials'
import { assembleGraphUI, nodeCatalog, compileGraph, runtimeOutputs, bypassLinks, parseCanvasMetadata } from './lib/graph-ui'

const loaded = ref(false), fatal = ref('')
const page = ref('home'), toast = ref(''), storageError = ref('')
const config = reactive({ workflows: [], activeId: '', drafts: {}, settings: { reducedMotion: false, haptics: true } })
const tasks = ref([]), draft = ref(null), importing = ref(false), testing = ref(false), busy = ref(false), advanced = ref(false)
const values = reactive({}), files = reactive({})
const selectedTaskId = ref(''), filter = ref('all'), favoriteOnly = ref(false), workflowFilter = ref('')
const downloadKey = ref(''), downloadProgress = ref(null), outputErrors = reactive({})
const exitOpen = ref(false), confirmRemove = ref(null)
const reload = () => window.location.reload()
const characterMode = ref('image')
const apiKeyInput = ref(''), keySaved = ref(false)
const maskEditing = ref(null), syncing = ref(false)
const maskBaseFile = computed(() => maskEditing.value ? files[maskEditing.value.virtualMask ? maskEditing.value.maskReference : maskEditing.value.id] : null)
const draftBranches = computed(() => outputBranches(draft.value?.graph))
const providerName = workflow => ({ comfy: 'ComfyUI', runninghub: 'RunningHub', runway: 'Runway' })[workflow.provider] || workflow.provider
const types = ['textarea','image','video','audio','number','select','toggle','text']
let toastTimer, saveTimer, pollTimer, polling = false, backListener, stateListener, restoreSuppressed = false
const active = computed(() => config.workflows.find(workflow => workflow.id === config.activeId))
const catalog = computed(() => active.value?.graph ? nodeCatalog(active.value.graph, active.value.objectInfo) : {})
const modules = computed(() => active.value?.graph ? runtimeOutputs(active.value.graph, catalog.value, active.value.canvas) : [])
const projection = computed(() => {
  const workflow = active.value
  if (!workflow?.runtime) return { visible: new Set((workflow?.fields || []).map(f => f.nodeId)), error: '' }
  try { return { ...compileGraph(workflow.graph, workflow.fields, values, workflow.runtime, catalog.value, workflow.canvas), error: '' } }
  catch (error) { return { visible: new Set(), error: error.message } }
})
const visibleFields = computed(() => (active.value?.fields || []).filter(f => f.enabled !== false && (!active.value?.runtime || (projection.value.visible.has(f.nodeId) && active.value.runtime.nodeModes?.[f.nodeId] !== 'bypass'))))
const referenceGroups = computed(() => [...new Set(visibleFields.value.filter(f => f.mediaGroup && !f.advanced).map(f => f.mediaGroup))].map(id => ({ id, fields: visibleFields.value.filter(f => f.mediaGroup === id && !f.advanced) })))
const runtimeNodes = computed(() => {
  const workflow = active.value
  if (!workflow?.runtime || !workflow.runtime.outputs.length) return []
  let visible
  try { visible = compileGraph(workflow.graph, workflow.fields, values, { ...workflow.runtime, nodeModes: {} }, catalog.value, workflow.canvas).visible } catch { return [] }
  return [...visible].filter(id => !modules.value.some(m => m.id === id)).map(id => {
    let canBypass = true
    try { bypassLinks(workflow.graph, id, catalog.value, workflow.canvas) } catch { canBypass = false }
    return { id, label: workflow.graph[id]._meta?.title || workflow.graph[id].class_type, canBypass }
  })
})
const activeCount = computed(() => tasks.value.filter(task => task.remoteId && !TERMINAL.has(task.status)).length)
const latestTask = computed(() => tasks.value.find(task => task.workflow.id === active.value?.id))
const selectedTask = computed(() => tasks.value.find(task => task.id === selectedTaskId.value))
const mainFields = computed(() => visibleFields.value.filter(field => !field.advanced && !field.mediaGroup).map(field => active.value?.provider === 'runway' && field.id === 'character' ? { ...field, kind: characterMode.value } : field))
const extraFields = computed(() => visibleFields.value.filter(field => field.advanced))
const pageTitle = computed(() => ({ assemble: '装配工作流', workbench: active.value?.name || '工作流工坊', history: selectedTask.value ? '作品详情' : '历史图鉴', settings: '旅途设置', about: '关于拉图', updates: '更新手札' })[page.value])
const filteredTasks = computed(() => tasks.value.filter(task => {
  if (favoriteOnly.value && !task.favorite) return false
  if (workflowFilter.value && task.workflow.id !== workflowFilter.value) return false
  if (filter.value === 'active') return !TERMINAL.has(task.status)
  if (filter.value === 'failed') return ['FAILED','REVIEW','INTERRUPTED'].includes(task.status)
  if (filter.value === 'image' || filter.value === 'video') return task.outputs?.some(output => output.kind === filter.value)
  return true
}))
const historyWorkflows = computed(() => [...new Map(tasks.value.map(task => [task.workflow.id, task.workflow.name])).entries()])
const cachedSummary = computed(() => tasks.value.length + ' 条任务记录 · ' + tasks.value.reduce((sum, task) => sum + (task.outputs?.length || 0), 0) + ' 个结果')
const runwayFields = [
  { id: 'character', name: 'character', label: '角色素材', kind: 'image', default: '', nodeTitle: '角色图片；视频需后端支持' },
  { id: 'reference', name: 'reference', label: '动作参考视频', kind: 'video', default: '', nodeTitle: '单人、无切镜，动作清楚' },
  { id: 'expression', name: 'expression', label: '表情强度', kind: 'number', min: 1, max: 5, step: 1, default: 3 },
  { id: 'ratio', name: 'ratio', label: '输出比例', kind: 'select', options: ['720:1280','1280:720','960:960','832:1104','1104:832','1584:672'], default: '720:1280' },
  { id: 'body', name: 'body', label: '肢体动作迁移', kind: 'toggle', default: true },
  { id: 'seed', name: 'seed', label: '固定种子（可留空）', kind: 'text', default: '', advanced: true },
]
function notify(message) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 4500) }
function tap() { if (config.settings.haptics && Capacitor.isNativePlatform()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}) }
async function persist() {
  try { await saveConfig(copy(config)); storageError.value = '' } catch (error) { storageError.value = error.message || '本地保存失败，请勿清除应用数据' }
}
function deferredSave() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300) }
function go(target) {
  tap()
  if (target === 'workbench' && !active.value) { notify('先装配一个工作流，再开始创作'); target = 'assemble' }
  page.value = target; selectedTaskId.value = ''; draft.value = null
  location.hash = target
  nextTick(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
}
function back() {
  if (maskEditing.value) { maskEditing.value = null; return }
  if (exitOpen.value) { exitOpen.value = false; return }
  if (confirmRemove.value) { confirmRemove.value = null; return }
  if (selectedTaskId.value) { selectedTaskId.value = ''; return }
  if (draft.value) { draft.value = null; return }
  if (page.value !== 'home') go('home')
  else exitOpen.value = true
}
function newWorkflow(provider = 'comfy') {
  draft.value = { id: uid(), name: provider === 'comfy' ? '我的 ComfyUI 工作流' : 'Runway 动作迁移', provider, address: provider === 'runway' ? localStorage.getItem('actTwoBackendUrl') || '' : '', fields: provider === 'runway' ? copy(runwayFields) : [], graph: null, warnings: [], missing: [], connection: 'unchecked', updatedAt: Date.now() }
  if (provider === 'runninghub') Object.assign(draft.value, { name: '我的 RunningHub 工作流', address: RUNNINGHUB_ORIGIN, workflowId: '', outputId: '', branchNames: {}, instanceType: 'default' })
  tap()
}
async function saveKey(quiet = false) {
  await setRunningHubKey(apiKeyInput.value)
  keySaved.value = true
  if (!quiet) { notify(Capacitor.isNativePlatform() ? 'API Key 已加密保存在本机' : 'API Key 仅在本次网页会话有效'); pollAll() }
}
async function saveKeyButton() { try { await saveKey() } catch (error) { notify(error.message) } }
async function forgetKey() {
  try { await clearRunningHubKey(); apiKeyInput.value = ''; keySaved.value = false; notify('已清除本机 RunningHub 密钥，任务记录保留') }
  catch (error) { notify(error.message) }
}
function normalizeWorkflow(workflow) {
  if (workflow.provider === 'runninghub') {
    workflow.workflowId = runningHubId(workflow.workflowId)
    workflow.address = RUNNINGHUB_ORIGIN
  } else workflow.address = normalizeAddress(workflow.address, { allowLoopback: !Capacitor.isNativePlatform() })
}
function installGraph(workflow, graph) {
  const old = workflow.graph
  if (old && workflow.runtime) workflow.runtime.nodeModes = Object.fromEntries(Object.entries(workflow.runtime.nodeModes || {}).filter(([id]) => old[id]?.class_type === graph[id]?.class_type))
  workflow.graph = graph
  rebuild(workflow)
  workflow.connection = 'unchecked'
}
function rebuild(workflow) {
  if (!workflow.graph) return
  const result = assembleGraphUI(workflow.graph, workflow.objectInfo, workflow.fields, workflow.canvas)
  delete result.catalog
  Object.assign(workflow, result)
  workflow.branchNames ||= {}
  const roots = runtimeOutputs(workflow.graph, nodeCatalog(workflow.graph, workflow.objectInfo), workflow.canvas).map(m => m.id)
  workflow.runtime ||= { outputs: workflow.outputId ? [workflow.outputId] : workflow.provider === 'comfy' ? roots : [], nodeModes: {} }
  workflow.runtime.outputs = workflow.runtime.outputs.filter(id => roots.includes(id)); workflow.runtime.nodeModes ||= {}
  for (const [id, metadata] of Object.entries(workflow.canvas?.nodes || {})) if (workflow.graph[id] && !workflow.runtime.nodeModes[id]) {
    if (metadata.mode === 4) workflow.runtime.nodeModes[id] = 'bypass'
    if (metadata.mode === 2) workflow.runtime.nodeModes[id] = 'muted'
  }
}
function activateModule(id) { if (busy.value) return; active.value.runtime.outputs = [id]; persist(); tap() }
function toggleModule(id, enabled) {
  if (busy.value) return
  active.value.runtime.outputs = enabled ? [...new Set([...active.value.runtime.outputs, id])] : active.value.runtime.outputs.filter(value => value !== id)
  persist()
}
async function syncDefinitions(workflow = active.value) {
  if (!workflow?.graph || syncing.value) return
  syncing.value = true
  try {
    if (workflow.provider === 'runninghub') await saveKey(true)
    workflow.objectInfo = await readNodeDefinitions(workflow); rebuild(workflow)
    if (workflow === active.value) for (const field of workflow.fields) if (!(field.id in values)) values[field.id] = field.default
    if (!draft.value) await persist()
    notify('控件定义已同步：下拉选项、端口和数值范围已更新')
  } catch (error) { notify(error.message) } finally { syncing.value = false }
}
async function importDefinitions(event, canvas = false) {
  const file = event.target.files?.[0], workflow = draft.value || active.value
  if (!file || !workflow) return
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('控件定义文件超过 20 MB')
    const raw = JSON.parse(await file.text())
    if (canvas) workflow.canvas = parseCanvasMetadata(raw)
    else {
      const info = raw.object_info || raw.objectInfo || raw
      if (!Object.values(info).some(v => v?.input)) throw new Error('请选择服务端 object_info 节点定义 JSON')
      const classes = new Set(Object.values(workflow.graph || {}).map(n => n.class_type)); classes.add('LoadImage'); classes.add('LoadImageMask')
      workflow.objectInfo = Object.fromEntries(Object.entries(info).filter(([name]) => classes.has(name)))
    }
    rebuild(workflow)
    if (workflow === active.value) for (const field of workflow.fields) if (!(field.id in values)) values[field.id] = field.default
    if (!draft.value) await persist()
    notify(canvas ? '已读取画布分组和端口信息' : '已按节点定义重新装配全部控件')
  } catch (error) { notify(error.message) } finally { event.target.value = '' }
}
function selectOutput() {
  if (!draft.value?.graph) return
  Object.assign(draft.value, assembleRunningHub(draft.value.graph, draft.value.outputId, draft.value.fields))
  draft.value.connection = 'unchecked'
}
function edit(workflow) { draft.value = copy(workflow); tap() }
async function importGraph(event) {
  const file = event.target.files?.[0]
  if (!file || !draft.value) return
  importing.value = true
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('工作流 JSON 超过 4 MB')
    installGraph(draft.value, parseWorkflow(await file.text()))
    draft.value.name = file.name.replace(/\.json$/i, '')
    notify('已识别 ' + Object.keys(draft.value.graph).length + ' 个节点' + (draft.value.provider === 'runninghub' && !draft.value.outputId ? '，请先选择一个输出分支' : '，已装配输入字段'))
  } catch (error) { notify(error.message) } finally { importing.value = false; event.target.value = '' }
}
async function test(workflow) {
  testing.value = true
  try {
    normalizeWorkflow(workflow)
    if (workflow.provider === 'runninghub') await saveKey(true)
    const result = await checkConnection(workflow)
    if (workflow.provider === 'runninghub') installGraph(workflow, result.graph)
    if (workflow.provider === 'comfy' && workflow.graph) {
      workflow.objectInfo = result.objectInfo; rebuild(workflow)
    }
    if (workflow.provider === 'runninghub') {
      try { workflow.objectInfo = await readNodeDefinitions(workflow); rebuild(workflow) }
      catch { workflow.warnings.unshift('平台完整控件定义尚未取得：模型下拉仅含工作流已有值。可同步或导入节点定义；API JSON 不包含完整选项。') }
    }
    workflow.connection = 'ready'; workflow.checkedAddress = workflow.address; workflow.checkedWorkflowId = workflow.workflowId
    if (workflow.provider === 'runway') workflow.characterVideo = result.health?.characterVideo === 'enabled'
    notify(result.note + (workflow.provider === 'runninghub' ? '，已读取云端 JSON；请核对分支' : '，节点字段已更新'))
  } catch (error) { workflow.connection = 'offline'; notify(error.message) }
  finally { testing.value = false; if (!draft.value) await persist() }
}
async function saveWorkflow(equip = true) {
  if (testing.value || importing.value) return notify('请等待工作流读取完成后再保存')
  try {
    const workflow = draft.value
    normalizeWorkflow(workflow)
    if (workflow.provider === 'runninghub') {
      if (!workflow.graph) throw new Error('请导入 API JSON 或点击读取云端工作流')
      if (apiKeyInput.value.trim()) await saveKey(true)
    }
    if (!workflow.name.trim()) throw new Error('请输入工作流名称')
    if (workflow.provider === 'comfy' && !workflow.graph) throw new Error('请先导入 API 格式工作流')
    if (workflow.address !== workflow.checkedAddress) workflow.connection = 'unchecked'
    workflow.updatedAt = Date.now()
    const index = config.workflows.findIndex(item => item.id === workflow.id)
    if (index < 0) config.workflows.push(copy(workflow))
    else config.workflows.splice(index, 1, copy(workflow))
    if (equip) config.activeId = workflow.id
    await persist(); draft.value = null
    notify(equip ? '工作流已装配' : '配置已保存')
    if (equip) go('home')
  } catch (error) { notify(error.message) }
}
async function equip(workflow) { config.activeId = workflow.id; await persist(); tap(); notify('已装配「' + workflow.name + '」') }
async function duplicate(workflow) { draft.value = { ...copy(workflow), id: uid(), name: workflow.name + ' · 副本' } }
async function deleteWorkflow(workflow) {
  config.workflows = config.workflows.filter(item => item.id !== workflow.id)
  if (config.activeId === workflow.id) config.activeId = ''
  delete config.drafts[workflow.id]
  await persist(); confirmRemove.value = null; notify('已移除本地配置，历史任务仍保留')
}
watch(() => config.activeId + ':' + (active.value?.updatedAt || ''), () => {
  restoreSuppressed = true
  Object.keys(values).forEach(key => delete values[key])
  Object.keys(files).forEach(key => delete files[key])
  if (active.value) Object.assign(values, defaults(active.value.fields), config.drafts[active.value.id] || {})
  nextTick(() => restoreSuppressed = false)
})
watch(values, () => {
  if (!loaded.value || restoreSuppressed || !active.value) return
  config.drafts[active.value.id] = copy(values); deferredSave()
}, { deep: true })
function chooseFile(field, file) {
  if (file && file.size > 200 * 1024 * 1024) { notify('0.01 单个素材暂限 200 MB'); return }
  files[field.id] = file
  delete files[field.id + '::$mask']; delete values[field.id + '::$mask']
}
function openMask(field) {
  if (files[field.virtualMask ? field.maskReference : field.id]) maskEditing.value = field
  else notify('请先选择此遮罩对应的原图，再打开画板')
}
function saveMask(file) { files[maskEditing.value.id + (maskEditing.value.virtualMask ? '' : '::$mask')] = file; maskEditing.value = null; notify('遮罩已保存；提交时单独上传并接入 MASK 连线') }
function clearMask(field) { delete files[field.id + '::$mask']; delete values[field.id + '::$mask'] }
async function patch(task, change) {
  Object.assign(task, change, { updatedAt: Date.now() })
  try { await saveTask(copy(task)) } catch { storageError.value = '任务记录未能保存，请检查设备存储空间并保留服务端任务编号。' }
}
async function generate() {
  if (busy.value || !active.value) return
  busy.value = true
  let task, phase = ''
  try {
    const workflow = copy(active.value), input = copy(values), selectedFiles = { ...files }
    normalizeWorkflow(workflow)
    if (workflow.provider === 'runninghub') {
      await saveKey(true)
    }
    if (workflow.runtime) {
      if (projection.value.error) throw new Error(projection.value.error)
      workflow.fields = copy(visibleFields.value)
      const permitted = new Set(workflow.fields.flatMap(field => [field.id, field.id + '::$mask']))
      for (const id of Object.keys(selectedFiles)) if (!permitted.has(id)) delete selectedFiles[id]
    }
    validateValues(workflow.fields.filter(field => field.enabled !== false), input, selectedFiles)
    if (workflow.provider === 'runway' && (!selectedFiles.character || !selectedFiles.reference)) throw new Error('请重新选择角色素材和动作视频')
    notify('正在检查服务连接…')
    const connection = await checkConnection(workflow)
    if (workflow.provider === 'comfy') {
      const executable = workflow.runtime ? compileGraph(workflow.graph, workflow.fields, input, workflow.runtime, nodeCatalog(workflow.graph, connection.objectInfo), workflow.canvas).graph : workflow.graph
      const assembled = assembleWorkflow(executable, connection.objectInfo)
      if (assembled.missing.length) throw new Error('服务缺少节点：' + assembled.missing.join('、'))
      // Keep user labels/kinds but apply authoritative numerical limits/options.
      workflow.fields = workflow.fields.map(field => ({ ...field, ...Object.fromEntries(Object.entries(assembled.fields.find(item => item.id === field.id) || {}).filter(([key]) => ['min','max','step','options'].includes(key))) }))
      validateValues(workflow.fields, input, selectedFiles)
    }
    if (workflow.fields.some(field => (field.virtualImage || field.virtualMask) && selectedFiles[field.id])) {
      const info = workflow.provider === 'comfy' ? connection.objectInfo : workflow.objectInfo
      for (const field of workflow.fields.filter(f => (f.virtualImage || f.virtualMask) && selectedFiles[f.id])) {
        const schema = info?.[workflow.graph[field.nodeId].class_type], definition = { ...schema?.input?.required, ...schema?.input?.optional }
        if (!definition[field.name] && !(field.name.startsWith('images.') && definition.images)) throw new Error('新增图像或遮罩端口需要服务端定义确认，请先同步或导入节点定义')
      }
    }
    task = reactive({ id: uid(), remoteId: '', workflow, values: input, fileNames: Object.fromEntries(Object.entries(selectedFiles).filter(([,file]) => file).map(([id,file]) => [id,file.name])), status: 'UPLOADING', detail: '准备素材', outputs: [], favorite: false, createdAt: Date.now(), updatedAt: Date.now(), progress: null })
    await saveTask(copy(task)); tasks.value.unshift(task)
    const submitted = await submitTask(workflow, input, selectedFiles, update => { phase = update.status || phase; patch(task, update) })
    await patch(task, { remoteId: submitted.remoteId, values: submitted.values, status: 'SUBMITTED', detail: submitted.detail, progress: null })
    notify('任务已提交，可以在历史图鉴查看')
    pollAll()
  } catch (error) {
    if (task) await patch(task, { status: phase === 'SUBMITTING' ? 'REVIEW' : 'FAILED', detail: error.message + (phase === 'SUBMITTING' ? '。请先核对服务端队列，不会自动重试提交。' : ''), progress: null })
    notify(error.message)
  } finally { busy.value = false }
}
async function refreshTask(task) {
  if (!task.remoteId) { notify(task.detail || '尚无服务端任务编号，请核对服务端后手动处理'); return }
  try { await patch(task, await queryTask(copy(task))) }
  catch (error) { await patch(task, { detail: '查询暂时失败：' + error.message }) }
}
async function pollAll() {
  clearTimeout(pollTimer)
  if (polling || document.hidden || !loaded.value) return
  polling = true
  try { await Promise.allSettled(tasks.value.filter(task => task.remoteId && !TERMINAL.has(task.status)).map(refreshTask)) }
  finally { polling = false; if (!document.hidden) pollTimer = setTimeout(pollAll, 7000) }
}
async function cancel(task) { try { await cancelTask(copy(task)); await patch(task, { status: 'CANCELED', detail: '已从服务端待执行队列移除' }); notify('排队任务已移除') } catch (error) { notify(error.message) } }
async function favorite(task) { await patch(task, { favorite: !task.favorite }); tap() }
function openTask(task) { page.value = 'history'; selectedTaskId.value = task.id; nextTick(() => window.scrollTo({ top: 0, behavior: 'instant' })); tap() }
async function reuse(task) {
  let workflow = config.workflows.find(item => item.id === task.workflow.id)
  if (!workflow) { workflow = copy(task.workflow); config.workflows.push(workflow) }
  if (task.workflow.runtime) workflow.runtime = copy(task.workflow.runtime)
  if (workflow.graph) rebuild(workflow)
  config.activeId = workflow.id
  config.drafts[workflow.id] = { ...(config.drafts[workflow.id] || {}), ...copy(task.values) }
  await persist()
  Object.keys(values).forEach(key => delete values[key]); Object.assign(values, defaults(workflow.fields), config.drafts[workflow.id])
  Object.keys(files).forEach(key => delete files[key])
  go('workbench')
  notify('已带回参数。请核对素材后手动提交，不会自动生成。')
}
async function removeRecord(task) {
  await removeTask(task.id); tasks.value = tasks.value.filter(item => item.id !== task.id)
  selectedTaskId.value = ''; confirmRemove.value = null; notify('已移除这条本地记录，远端结果未删除')
}
async function saveOutput(task, output) {
  downloadKey.value = task.id + output.id; downloadProgress.value = null
  try { await downloadOutput(output, progress => downloadProgress.value = progress); notify(Capacitor.isNativePlatform() ? '原文件已准备，请在系统面板选择保存或分享' : '已发起原文件下载') }
  catch (error) { notify(error.message) } finally { downloadKey.value = '' }
}
async function useAsInput(task, output) {
  const workflow = active.value
  if (!workflow) return notify('请先装配一个工作流')
  const field = workflow.fields.find(item => item.kind === output.kind)
  if (!field) return notify('当前工作流没有对应的素材输入模块')
  try {
    notify('正在读取原文件…')
    const response = await fetch(output.url)
    if (!response.ok) throw new Error('原文件暂不可用')
    const blob = await response.blob()
    const file = new File([blob], output.filename || 'result', { type: blob.type || (output.kind === 'video' ? 'video/mp4' : 'image/png') })
    go('workbench'); chooseFile(field, file); notify('已带入素材，提交时会上传到当前服务')
  } catch (error) { notify(error.message) }
}
function publicValues(task) {
  return task.workflow.fields.filter(field => field.enabled !== false).map(field => ({ label: field.label, value: /key|token|password|secret/i.test(field.name) ? '••••••' : (task.values[field.id] ?? field.default) }))
}
const date = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
function connectionLabel(workflow) { return workflow.connection === 'ready' && workflow.checkedAddress === workflow.address && (workflow.provider !== 'runninghub' || workflow.checkedWorkflowId === workflow.workflowId) ? '已连接' : workflow.connection === 'offline' ? '连接异常' : '待检查' }
async function clearCache() { await clearThumbs(); await clearNativeCache(); notify('预览与分享缓存已清理，任务记录保留') }
async function exit() {
  await persist()
  if (Capacitor.isNativePlatform()) await NativeApp.minimizeApp()
  else notify('网页版可关闭此标签页，已接收的任务继续在服务端运行')
  exitOpen.value = false
}
function visibility() { if (document.hidden) clearTimeout(pollTimer); else pollAll() }
onMounted(async () => {
  try {
    const saved = await loadConfig()
    try { apiKeyInput.value = await getRunningHubKey(); keySaved.value = !!apiKeyInput.value } catch { notify('请在设置中清除后重新填写 RunningHub 密钥') }
    Object.assign(config, saved, { settings: { reducedMotion: false, haptics: true, ...saved.settings } })
    for (const workflow of config.workflows) if (workflow.graph) rebuild(workflow)
    tasks.value = (await loadTasks()).sort((a,b) => b.createdAt - a.createdAt)
    // Preserve the previous prototype's active task and backend setting.
    const legacy = JSON.parse(localStorage.getItem('actTwoActiveTask') || 'null')
    if (legacy?.id && !tasks.value.some(task => task.remoteId === legacy.id)) {
      const workflow = { id: 'legacy-runway', name: 'Runway 动作迁移', provider: 'runway', address: legacy.backendUrl || localStorage.getItem('actTwoBackendUrl') || '', fields: copy(runwayFields) }
      const task = { id: uid(), remoteId: legacy.id, workflow, values: {}, status: legacy.status || 'SUBMITTED', detail: legacy.detail || '原版本任务', outputs: legacy.resultUrl ? [{ id: '0', url: legacy.resultUrl, kind: 'video', filename: 'runway-' + legacy.id + '.mp4' }] : [], createdAt: legacy.updatedAt || Date.now(), updatedAt: Date.now() }
      tasks.value.unshift(task); await saveTask(task)
    }
    for (const task of tasks.value.filter(item => !item.remoteId && ['UPLOADING','SUBMITTING'].includes(item.status))) await patch(task, { status: itemStatus(task), detail: '应用重启前未保存服务端任务编号，请先核对服务端任务。不会自动重复提交。' })
    if (active.value) Object.assign(values, defaults(active.value.fields), config.drafts[active.value.id] || {})
    document.addEventListener('visibilitychange', visibility)
    if (Capacitor.isNativePlatform()) {
      backListener = await NativeApp.addListener('backButton', back)
      stateListener = await NativeApp.addListener('appStateChange', ({ isActive }) => { if (isActive) pollAll(); else clearTimeout(pollTimer) })
    }
    loaded.value = true
    pollAll()
  } catch (error) { fatal.value = error.message || '本地数据加载失败'; loaded.value = true }
})
function itemStatus(task) { return task.status === 'UPLOADING' ? 'INTERRUPTED' : 'REVIEW' }
onBeforeUnmount(() => { clearTimeout(pollTimer); clearTimeout(saveTimer); clearTimeout(toastTimer); document.removeEventListener('visibilitychange', visibility); backListener?.remove(); stateListener?.remove() })
</script>

<template>
  <div class="latula" :class="{ 'reduce-motion': config.settings.reducedMotion }">
    <div v-if="!loaded" class="boot"><GameIcon name="cat" :size="50" /><h1>拉图</h1><p>点亮港湾的灯火…</p></div>
    <div v-else-if="fatal" class="boot"><h1>记录暂未打开</h1><p>{{ fatal }}</p><button class="gold-button" @click="reload">重新打开</button></div>
    <template v-else>
      <main v-if="page === 'home'" class="home-shell">
        <div class="home-stage">
          <div class="home-art" role="img" aria-label="月夜像素港湾，三个猫咪工坊沿石阶排列，门口有女性像素管理员，前景冒险者走向小屋"></div>
          <div class="moon-glow"></div>
          <header class="home-brand"><h1>拉图<span>AI</span></h1><p>ComfyUI · AI Workflow</p><div class="brand-rule">◇</div></header>
          <div class="home-version">初航测试版 · v{{ DISPLAY_VERSION }}</div>
          <button class="scene-sign assembly-sign" :class="{ equipped: active }" @click="go('assemble')" aria-label="装配工作流">
            <span class="sign-title">装配工作流</span><small>{{ active ? active.name : '配置 · 管理 · 切换' }}</small><GameIcon class="sign-arrow" name="chevron" />
          </button>
          <button class="scene-sign enter-sign" @click="go('workbench')" aria-label="进入工作流"><span class="sign-title">进入工作流</span><small>{{ active ? '素材 · 参数 · 提交' : '先装配你的工作流' }}</small><GameIcon class="sign-arrow" name="chevron" /></button>
          <button class="scene-sign history-sign" @click="go('history')" aria-label="历史任务"><span class="sign-title">历史任务</span><small>{{ activeCount ? activeCount + ' 个任务等待结果' : '记录 · 查看 · 复用' }}</small><GameIcon class="sign-arrow" name="chevron" /><span v-if="activeCount" class="scene-badge">{{ activeCount }}</span></button>
          <nav class="home-nav" aria-label="辅助功能">
            <button @click="go('about')"><span><GameIcon name="info" /></span>关于</button><button @click="go('updates')"><span><GameIcon name="update" /></span>更新</button><button @click="go('settings')"><span><GameIcon name="gear" /></span>设置</button><button @click="exitOpen = true"><span><GameIcon name="power" /></span>退出</button>
          </nav>
        </div>
      </main>
      <div v-else class="interior-shell">
        <header class="page-header"><button class="icon-button" aria-label="返回" @click="back"><GameIcon name="back" /></button><div><small>拉图 · 月夜工坊</small><h1>{{ pageTitle }}</h1></div><button class="icon-button" aria-label="返回主页" @click="go('home')"><GameIcon name="cat" /></button></header>
        <main class="page-body">
          <div v-if="storageError" class="notice error" role="alert">{{ storageError }}</div>
          <template v-if="page === 'assemble'">
            <template v-if="!draft">
              <section class="intro"><GameIcon name="gear" :size="35" /><div><h2>为你的旅程装配工作流</h2><p>导入 ComfyUI API JSON，自动组成素材与参数界面。</p></div></section>
              <div class="provider-choices"><button class="gold-button wide" @click="newWorkflow('comfy')"><GameIcon name="add" />导入 ComfyUI 工作流</button><button class="wood-button wide" @click="newWorkflow('runninghub')"><GameIcon name="book" />接入 RunningHub 工作流</button></div>
              <div v-if="!config.workflows.length" class="empty-state"><GameIcon name="cat" :size="48" /><h3>工匠猫正在等你</h3><p>准备好 API 格式工作流与服务地址，开始第一次装配。</p></div>
              <article v-for="workflow in config.workflows" :key="workflow.id" class="parchment workflow-card" :class="{ selected: config.activeId === workflow.id }">
                <div class="card-heading"><span class="seal"><GameIcon :name="workflow.provider === 'comfy' ? 'gear' : 'play'" /></span><div><h3>{{ workflow.name }}</h3><small>{{ providerName(workflow) }} · {{ workflow.fields.length }} 个输入</small></div><span v-if="config.activeId === workflow.id" class="badge">已装配</span></div>
                <p class="connection"><i :class="connectionLabel(workflow) === '已连接' ? 'online' : ''"></i>{{ connectionLabel(workflow) }}<span>{{ workflow.address }}</span></p>
                <div class="button-row"><button class="gold-button small" @click="equip(workflow)">{{ config.activeId === workflow.id ? '当前装配' : '装配' }}</button><button class="wood-button small" @click="edit(workflow)">编辑</button><button class="icon-button" aria-label="复制工作流配置" @click="duplicate(workflow)"><GameIcon name="edit" :size="18" /></button><button class="icon-button danger" aria-label="移除工作流配置" @click="confirmRemove = { type: 'workflow', item: workflow }"><GameIcon name="trash" :size="18" /></button></div>
              </article>
              <details class="parchment"><summary>其他已支持模块</summary><p class="muted">原有 Runway 动作迁移继续可用，需配置持有密钥的后端。</p><button class="wood-button" @click="newWorkflow('runway')">添加 Runway 模块</button><p class="muted">ComfyUI 原生接口可连接本地电脑或自建云服务器；RunningHub 使用独立的平台 API。</p></details>
            </template>
            <section v-else class="parchment editor">
              <div class="section-heading"><h2>{{ draft.provider === 'runway' ? 'Runway 配置' : '工作流装配台' }}</h2><button class="text-button" @click="draft = null">返回列表</button></div>
              <div class="field-group"><label for="workflow-name">工作流名称</label><input id="workflow-name" v-model="draft.name" maxlength="60" /></div>
              <div v-if="draft.provider !== 'runninghub'" class="field-group"><label for="workflow-address">{{ draft.provider === 'comfy' ? 'ComfyUI 服务地址' : 'Runway 后端地址' }}</label><input id="workflow-address" v-model="draft.address" placeholder="例如 http://192.168.1.8:8188" inputmode="url" /><small>填写电脑局域网 IP 或云端域名。手机里的 127.0.0.1 指手机自身；电脑通常需开启局域网监听。</small></div>
              <template v-if="draft.provider === 'runninghub'">
                <p class="muted">RunningHub · 官方平台 API。保留完整工作流，在运行页控制执行路径。</p>
                <div class="field-group"><label for="runninghub-workflow">工作流链接或 ID</label><input id="runninghub-workflow" v-model="draft.workflowId" inputmode="url" placeholder="https://www.runninghub.cn/workflow/数字ID" /><small>支持完整网页链接，自动去除来源参数。接口域名固定为 www.runninghub.cn。</small></div>
                <div class="field-group"><label for="runninghub-key">RunningHub API Key</label><input id="runninghub-key" type="password" v-model="apiKeyInput" autocomplete="off" autocapitalize="off" spellcheck="false" @input="keySaved = false" placeholder="填写你自己的 API Key" /><small>{{ Capacitor.isNativePlatform() ? '使用 Android Keystore 加密保存；不会写入工作流和任务记录。' : '网页预览仅在当前会话保存密钥，刷新后需要重填。' }}</small><button class="text-button" @click="saveKeyButton">{{ keySaved ? '密钥已保存 · 更新密钥' : '保存密钥' }}</button></div>
                <div class="field-group"><label for="runninghub-instance">运行规格</label><select id="runninghub-instance" v-model="draft.instanceType"><option value="default">标准 · 24G</option><option value="plus">Plus · 48G</option><option value="ultra">Ultra · 84G</option></select><small>规格影响平台用量；以你的账户可用规格和平台实际计费为准。</small></div>
              </template>
              <label v-if="draft.provider !== 'runway'" class="workflow-import"><GameIcon name="upload" :size="28" /><strong>{{ importing ? '正在识别…' : draft.graph ? '更换 API 工作流文件' : '选择 API 格式 JSON' }}</strong><small>从 ComfyUI 导出 API 格式，不是普通画布 JSON</small><input type="file" accept=".json,application/json" :disabled="importing" aria-label="导入 API 工作流文件" @change="importGraph" /></label>
              <section v-if="draft.graph" class="branch-picker"><h3>完整工作流已装配</h3><p class="muted">功能切换、模块启停和节点旁路统一放在运行页面。保存一份配置即可，不需要为每个功能复制工作流。</p></section>
              <details v-if="draft.graph" class="parchment"><summary>控件与画布信息</summary><p class="muted">API JSON 通常不含完整选项和分组。服务端 object_info 提供类型/下拉/端口；普通画布 JSON 提供分组名称和端口信息，原执行图仍以 API JSON 为准。</p><button class="wood-button" :disabled="syncing" @click="syncDefinitions(draft)">{{ syncing ? '正在读取节点定义…' : '同步控件选项' }}</button><label class="metadata-import">导入节点定义<input type="file" accept=".json" aria-label="导入节点定义" @change="importDefinitions($event)" /></label><label class="metadata-import">补充画布分组信息<input type="file" accept=".json" aria-label="补充画布分组信息" @change="importDefinitions($event,true)" /></label></details>
              <div v-if="draft.graph" class="assembly-stats"><span>{{ draft.nodeCount }}<small>节点</small></span><span>{{ draft.fields.filter(f => f.enabled !== false && ['image','video','audio'].includes(f.kind)).length }}<small>素材输入</small></span><span>{{ draft.fields.filter(f => f.enabled !== false && f.kind === 'textarea').length }}<small>文本输入</small></span><span>{{ draft.fields.length }}<small>输入字段</small></span></div>
              <button class="wood-button wide" :disabled="testing || (draft.provider !== 'runninghub' && !draft.address)" @click="test(draft)"><GameIcon name="wifi" />{{ testing ? '正在连接与读取…' : draft.provider === 'runninghub' ? '验证密钥 · 读取云端工作流' : '测试连接 · 完善自动装配' }}</button>
              <div v-for="warning in draft.warnings" :key="warning" class="notice">{{ warning }}</div>
              <details v-if="draft.fields.length" class="field-mapping"><summary>调整界面模块（{{ draft.fields.length }}）</summary><p class="muted">常见节点已自动装配。特殊节点可更改模块类型和中文名；连接线保持不变。</p><div v-for="field in draft.fields" :key="field.id" class="mapping-row"><div><strong>{{ field.nodeTitle }}</strong><small>节点 {{ field.nodeId || '模块' }} · {{ field.name }}</small></div><input v-model="field.label" :aria-label="field.name + '显示名称'" /><select v-model="field.kind" :aria-label="field.name + '输入类型'" @change="field.customKind = true"><option v-for="kind in types" :key="kind" :value="kind">{{ ({ textarea:'提示词/多行文本',image:'图片上传',video:'视频上传',audio:'音频上传',number:'数值',select:'下拉选择',toggle:'开关',text:'单行文本' })[kind] }}</option></select><label class="check-label"><input type="checkbox" v-model="field.enabled" />启用字段</label><label class="check-label"><input type="checkbox" v-model="field.advanced" />高级参数</label></div></details>
              <div class="button-row sticky-actions"><button class="wood-button" @click="saveWorkflow(false)">保存配置</button><button class="gold-button" :disabled="importing || testing" @click="saveWorkflow(true)"><GameIcon name="check" />保存并装配</button></div>
            </section>
          </template>

          <template v-else-if="page === 'workbench'">
            <template v-if="active">
              <section class="intro"><GameIcon name="book" :size="35" /><div><h2>{{ active.name }}</h2><p>{{ providerName(active) }} · 一份工作流，自由切换执行模块</p></div><button class="icon-button" aria-label="编辑当前工作流" @click="edit(active); page = 'assemble'"><GameIcon name="gear" /></button></section>
              <section v-if="active.runtime" class="parchment runtime-panel"><div class="section-heading"><div><h3>运行模块</h3><small>点击道具切换功能；勾选可组合输出。切换保留参数和已选素材。</small></div><GameIcon name="gear" /></div>
                <div class="module-rack"><article v-for="module in modules" :key="module.id" :data-output-id="module.id" class="module-item" :class="{selected:active.runtime.outputs.includes(module.id)}"><button :disabled="busy" :aria-label="'切换模块 ' + (active.branchNames[module.id] || module.label)" :aria-pressed="active.runtime.outputs.includes(module.id)" @click="activateModule(module.id)"><span class="module-prop"><GameIcon name="book" :size="32" /></span><strong>{{ active.branchNames[module.id] || module.label }}</strong><small>{{ active.runtime.outputs.includes(module.id) ? '已启用' : '已停用' }}</small></button><label class="check-label"><input type="checkbox" :aria-label="'启用输出 ' + module.id" :checked="active.runtime.outputs.includes(module.id)" :disabled="busy" @change="toggleModule(module.id,$event.target.checked)" />参与运行</label></article></div>
                <details><summary>模块命名与旁路控制</summary><div v-for="module in modules" :key="'name-'+module.id" class="field-group"><label :for="'module-name-'+module.id">{{ module.label }}</label><input :id="'module-name-'+module.id" v-model="active.branchNames[module.id]" :disabled="busy" placeholder="模块显示名称" @change="persist" /></div><div v-for="node in runtimeNodes" :key="node.id" class="node-state"><span>{{ node.label }}<small>节点 {{ node.id }}</small></span><select :aria-label="'节点 ' + node.id + '运行状态'" :value="active.runtime.nodeModes[node.id] || 'enabled'" :disabled="busy" @change="active.runtime.nodeModes[node.id] = $event.target.value; persist()"><option value="enabled">启用</option><option value="bypass" :disabled="!node.canBypass">{{ node.canBypass ? '旁路（透传连线）' : '旁路需完整端口定义' }}</option><option value="muted">停用</option></select></div><small>旁路会重接上游同类型端口；无法唯一匹配时不会猜测。停用被当前路径依赖的节点会阻止提交。</small></details>
                <p v-if="projection.error" class="notice" role="alert">{{ projection.error }}</p>
                <button class="text-button" :disabled="syncing || busy" @click="syncDefinitions()">{{ syncing ? '正在同步…' : '同步控件选项' }}</button>
              </section>
              <section v-if="active.provider === 'runninghub'" class="parchment"><div class="field-group"><label for="workbench-key">RunningHub API Key</label><input id="workbench-key" type="password" v-model="apiKeyInput" autocomplete="off" autocapitalize="off" spellcheck="false" @input="keySaved = false" placeholder="填写你自己的 API Key" /><small>{{ keySaved ? '本机密钥已就绪' : '提交前请填写密钥' }} · 工作流 {{ active.workflowId }}</small><button class="text-button" @click="saveKeyButton">保存密钥</button></div><p class="muted">提交将使用 RunningHub 账户额度。按当前启用/旁路状态提交执行图；网络异常不会自动重新提交。</p></section>
              <section class="parchment"><p class="muted">素材与参数将发送到你配置的服务。返回主页不会取消已接收的任务。</p><div v-if="active.provider === 'runway' && active.characterVideo" class="field-group"><label for="character-mode">角色素材类型</label><select id="character-mode" v-model="characterMode" :disabled="busy" @change="files.character = null"><option value="image">图片</option><option value="video">视频（只迁移表情）</option></select></div><ReferenceInputs v-for="group in referenceGroups" :key="group.id" :fields="group.fields" :values="values" :files="files" :disabled="busy" @file="chooseFile" @value="(field,value) => values[field.id] = value" @mask="openMask" @clear-mask="clearMask" @notice="notify" /><WorkflowField v-for="field in mainFields" :key="field.id" :field="field" v-model="values[field.id]" :file="files[field.id]" :mask="files[field.id + '::$mask']" :disabled="busy" @file="chooseFile(field, $event)" @mask="openMask(field)" @clear-mask="clearMask(field)" /><details v-if="extraFields.length" :open="advanced" @toggle="advanced = $event.target.open"><summary>高级参数 · {{ extraFields.length }} 项</summary><WorkflowField v-for="field in extraFields" :key="field.id" :field="field" v-model="values[field.id]" :file="files[field.id]" :mask="files[field.id + '::$mask']" :disabled="busy" @file="chooseFile(field, $event)" @mask="openMask(field)" @clear-mask="clearMask(field)" /></details><div v-if="!active.fields.length" class="notice">没有识别到输入字段，可在装配台连接服务后读取节点定义。</div></section>
              <button class="gold-button wide submit-button" :disabled="busy || !!projection.error" @click="generate"><GameIcon name="play" />{{ busy ? '正在上传与提交…' : '提交工作流' }}</button>
              <section v-if="latestTask" class="parchment task-progress" aria-live="polite"><div class="section-heading"><h3>{{ STATUS[latestTask.status] || latestTask.status }}</h3><button class="text-button" @click="openTask(latestTask)">查看任务</button></div><p>{{ latestTask.detail }}</p><progress v-if="latestTask.progress !== null && latestTask.progress !== undefined" :value="latestTask.progress" max="100"></progress><small>{{ latestTask.remoteId || '等待服务端任务编号' }}</small></section>
            </template><div v-else class="empty-state"><h2>还没有装配工作流</h2><button class="gold-button" @click="go('assemble')">前往装配</button></div>
          </template>

          <template v-else-if="page === 'history'">
            <template v-if="selectedTask">
              <section class="parchment"><div class="section-heading"><div><small>{{ date(selectedTask.createdAt) }}</small><h2>{{ selectedTask.workflow.name }}</h2></div><button class="icon-button" :class="{ favorite: selectedTask.favorite }" :aria-label="selectedTask.favorite ? '取消收藏' : '收藏任务'" @click="favorite(selectedTask)"><GameIcon name="heart" /></button></div><span class="status" :class="selectedTask.status.toLowerCase()">{{ STATUS[selectedTask.status] || selectedTask.status }}</span><p>{{ selectedTask.detail }}</p><code v-if="selectedTask.remoteId" class="task-id">{{ selectedTask.remoteId }}</code><div class="button-row"><button class="wood-button small" @click="refreshTask(selectedTask)"><GameIcon name="refresh" :size="16" />刷新</button><button class="gold-button small" @click="reuse(selectedTask)">使用相同参数</button><button v-if="selectedTask.status === 'PENDING' && selectedTask.workflow.provider === 'comfy'" class="text-button" @click="cancel(selectedTask)">移除排队任务</button></div></section>
              <article v-for="output in selectedTask.outputs" :key="output.id" class="parchment output-card">
                <div v-if="outputErrors[selectedTask.id + output.id]" class="notice">原文件暂不可用，可稍后刷新；任务记录仍保留。</div>
                <video v-if="output.kind === 'video'" :src="output.url" controls playsinline preload="metadata" @error="outputErrors[selectedTask.id + output.id] = true"></video><audio v-else-if="output.kind === 'audio'" :src="output.url" controls></audio><a v-else :href="output.url" target="_blank" rel="noopener"><img :src="output.url" alt="生成结果" @error="outputErrors[selectedTask.id + output.id] = true" /></a>
                <div class="button-row"><button class="gold-button small" :disabled="!!downloadKey" @click="saveOutput(selectedTask, output)"><GameIcon name="download" :size="17" />{{ downloadKey === selectedTask.id + output.id ? (downloadProgress === null ? '准备原文件…' : downloadProgress + '%') : '保存 / 分享原文件' }}</button><button class="wood-button small" @click="useAsInput(selectedTask, output)">用作素材</button></div>
              </article>
              <details class="parchment"><summary>当时的参数与来源</summary><p>{{ providerName(selectedTask.workflow) }} · {{ selectedTask.workflow.address }}</p><dl class="parameter-list"><template v-for="item in publicValues(selectedTask)" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ String(item.value) }}</dd></template></dl><p v-if="Object.keys(selectedTask.fileNames || {}).length" class="muted">原上传素材：{{ Object.values(selectedTask.fileNames).join('、') }}</p></details>
              <button class="text-button danger" :disabled="!!selectedTask.remoteId && !TERMINAL.has(selectedTask.status)" @click="confirmRemove = { type: 'task', item: selectedTask }">移除此条本地记录</button>
            </template>
            <template v-else>
              <section class="intro"><GameIcon name="scroll" :size="35" /><div><h2>你的创作图鉴</h2><p>{{ cachedSummary }}</p></div><button class="icon-button" aria-label="刷新进行中的任务" @click="pollAll(); notify('正在同步任务状态')"><GameIcon name="refresh" /></button></section>
              <div class="filter-tabs" aria-label="任务筛选"><button v-for="item in [['all','全部'],['image','图片'],['video','视频'],['active','进行中'],['failed','需关注']]" :key="item[0]" :class="{ active: filter === item[0] }" @click="filter = item[0]">{{ item[1] }}</button></div>
              <div class="history-filters"><label class="check-label"><input type="checkbox" v-model="favoriteOnly" />只看收藏</label><select v-model="workflowFilter" aria-label="按工作流筛选"><option value="">所有工作流</option><option v-for="[id, name] in historyWorkflows" :key="id" :value="id">{{ name }}</option></select></div>
              <div v-if="!filteredTasks.length" class="empty-state"><GameIcon name="cat" :size="52" /><h3>{{ tasks.length ? '这里暂时没有匹配的记录' : '图鉴的第一页，等你点亮' }}</h3><p>生成的图片、视频和任务会留在这里。</p><button v-if="!tasks.length" class="gold-button" @click="go('workbench')">开始第一次创作</button></div>
              <div class="history-grid"><button v-for="task in filteredTasks" :key="task.id" class="history-card" @click="openTask(task)"><TaskThumb :task="task" :output="task.outputs?.[0]" /><div class="history-info"><strong>{{ task.workflow.name }}</strong><span class="status" :class="task.status.toLowerCase()">{{ STATUS[task.status] || task.status }}</span><small>{{ date(task.createdAt) }}<span v-if="task.favorite"> · 已收藏</span></small><small v-if="task.outputs?.length > 1">{{ task.outputs.length }} 个结果</small></div></button></div>
            </template>
          </template>

          <template v-else-if="page === 'settings'">
            <section class="parchment"><h2>界面与互动</h2><label class="switch-row"><span>减少动态效果<small>保留即时点击反馈，关闭环境呼吸动画</small></span><input type="checkbox" v-model="config.settings.reducedMotion" @change="persist" /></label><label class="switch-row"><span>轻触反馈<small>设备支持时，点击会有轻微震动</small></span><input type="checkbox" v-model="config.settings.haptics" @change="persist" /></label></section>
            <section class="parchment"><h2>记录与缓存</h2><p>{{ cachedSummary }}</p><p class="muted">缓存只用于缩略预览和原文件分享。清理缓存保留工作流、参数与任务记录。卸载应用会清除本地数据，请将重要原文件保存到手机。</p><button class="wood-button" @click="clearCache">清理预览与分享缓存</button></section>
            <section class="parchment"><h2>RunningHub 密钥</h2><p class="muted">{{ keySaved ? '本机已保存密钥' : '尚未保存密钥' }}。在 RunningHub 装配台或工坊里填写。清除后，刷新历史中的平台任务需重新填写。</p><button class="wood-button" @click="forgetKey">清除本机 RunningHub 密钥</button></section><section class="parchment"><h2>服务配置</h2><p class="muted">服务地址、工作流和输入模块统一在装配台管理。</p><button class="gold-button" @click="go('assemble')">前往装配台</button></section>
          </template>
          <template v-else-if="page === 'about'">
            <section class="parchment about-panel"><GameIcon name="cat" :size="56" /><h2>拉图</h2><p class="subtitle">把工作流，装进口袋。</p><span class="badge">v{{ DISPLAY_VERSION }} · 初航测试版</span><p>连接自己的 ComfyUI 或已配置的 API 服务，用熟悉的素材、提示词和参数，取回你的创作。</p><p class="muted">图片与视频由连接的电脑或云端服务生成。拉图负责前端操作、任务跟踪和作品图鉴。</p><a href="https://github.com/guqincheng95/comfyui_latula" target="_blank" rel="noopener">项目仓库与更新记录 ↗</a></section>
            <section class="parchment"><h2>技术与美术</h2><p class="muted">Vue、Capacitor 及官方原生插件；ComfyUI 原生 API。参考 ComfyChair、ComfyUIMobileApp、Comfy Remote 的工作流与任务组织思路，本版未复制它们的源码。美术使用本项目确定的夜景三猫方案。</p><a href="/third-party-notices.txt" target="_blank" rel="noopener">查看第三方组件许可 ↗</a></section>
          </template>
          <template v-else-if="page === 'updates'">
            <section class="parchment"><span class="badge">v{{ DISPLAY_VERSION }}</span><h2>月夜港湾 · 云端工坊</h2><ul><li>新增通用装配引擎、节点定义驱动控件、多图参考与遮罩画板</li><li>完整工作流在运行页切换模块、节点旁路和多输出组合</li><li>Android Keystore 加密保存平台密钥，与任务记录分离</li><li>三猫工坊主页与统一的木质金边界面</li><li>ComfyUI API 工作流导入与模块化自动装配</li><li>素材上传、任务状态与返回前台恢复查询</li><li>图片 / 视频图鉴、收藏与参数复用</li><li>保留原有 Runway 动作迁移</li></ul><p class="muted">安装包在仓库 Releases 中下载；保持固定签名，可覆盖更新。暂未配置应用内自动更新源。</p><a class="wood-button" href="https://github.com/guqincheng95/comfyui_latula/releases" target="_blank" rel="noopener">下载安装包</a></section>
          </template>
          <footer class="page-footer">拉图 · 每一次灵感，都有归处 <span>v{{ DISPLAY_VERSION }}</span></footer>
        </main>
      </div>
      <MaskEditor v-if="maskEditing" :file="maskBaseFile" :mask="files[maskEditing.id + (maskEditing.virtualMask ? '' : '::$mask')]" @save="saveMask" @close="maskEditing = null" /><Transition name="toast"><div v-if="toast" class="toast" role="status">{{ toast }}</div></Transition>
      <div v-if="exitOpen || confirmRemove" class="modal-scrim" @click.self="exitOpen = false; confirmRemove = null">
        <section class="parchment modal" role="dialog" aria-modal="true" :aria-label="exitOpen ? '离开拉图' : '移除确认'">
          <template v-if="exitOpen"><h2>暂别月夜港湾？</h2><p>已被服务接收的任务会继续执行，回来后会同步状态。</p><p v-if="busy" class="notice">素材上传或任务提交尚未完成，现在离开可能中断。请先等待任务编号返回。</p><div class="button-row"><button class="wood-button" @click="exitOpen = false">留在这里</button><button class="gold-button" :disabled="busy" @click="exit">暂时离开</button></div></template>
          <template v-else><h2>{{ confirmRemove.type === 'workflow' ? '移除本地装配配置？' : '移除此条本地记录？' }}</h2><p>远端工作流和结果文件不会删除。</p><div class="button-row"><button class="wood-button" @click="confirmRemove = null">保留</button><button class="gold-button" @click="confirmRemove.type === 'workflow' ? deleteWorkflow(confirmRemove.item) : removeRecord(confirmRemove.item)">确认移除</button></div></template>
        </section>
      </div>
    </template>
  </div>
</template>
