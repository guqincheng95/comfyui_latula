import { comfyOutputs, copy, materializeGraph, parseWorkflow, resultKind, uid } from './workflow.js'
import { RUNNINGHUB_ORIGIN, runningHubId, runningHubBody, runningHubResult } from './runninghub.js'
import { getRunningHubKey } from './credentials.js'
async function request(url, init = {}, timeout = 20000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    let payload
    try { payload = await response.json() } catch { throw new Error('服务未返回 JSON，请检查地址是否是 API 服务') }
    if (!response.ok) {
      const detail = payload.detail || payload.error?.message || payload.error || 'HTTP ' + response.status
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    }
    return payload
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时；如正在提交，请先核对服务端队列，避免重复提交')
    if (error instanceof TypeError) throw new Error('无法连接服务。请检查地址、同一局域网/远程网络及服务访问权限；网页版还需服务允许该网页来源。')
    throw error
  } finally { clearTimeout(timer) }
}
const postJSON = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export async function checkConnection(workflow) {
  if (workflow.provider === 'runninghub') {
    const result = await runningHubRequest('/api/openapi/getJsonApiFormat', { workflowId: runningHubId(workflow.workflowId) })
    const graph = parseWorkflow(result.data?.prompt)
    return { graph, note: 'RunningHub 已连接，工作流可读取' }
  }
  if (workflow.provider === 'comfy') {
    await request(workflow.address + '/system_stats')
    const info = await request(workflow.address + '/object_info', {}, 40000)
    return { objectInfo: info, note: 'ComfyUI 已连接' }
  }
  const health = await request(workflow.address + '/health')
  if (health.status !== 'ok') throw new Error('后端健康检查未通过')
  return { health, note: 'Runway 后端已连接' }
}
function upload(url, form, progress, headers = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value))
    xhr.responseType = 'json'
    xhr.timeout = 15 * 60 * 1000
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.min(100, Math.round(event.loaded / event.total * 100))) }
    xhr.onload = () => {
      const result = xhr.response
      if (xhr.status >= 200 && xhr.status < 300) resolve(result)
      else reject(new Error(typeof result?.detail === 'string' ? result.detail : '上传失败，HTTP ' + xhr.status))
    }
    xhr.onerror = () => reject(new Error('上传连接中断，请检查网络'))
    xhr.ontimeout = () => reject(new Error('上传超时，请检查素材大小与网络'))
    xhr.onabort = () => reject(new Error('上传已取消'))
    xhr.send(form)
  })
}
export async function submitTask(workflow, values, files, update) {
  if (workflow.provider === 'runninghub') return submitRunningHub(workflow, values, files, update)
  if (workflow.provider === 'runway') return submitRunway(workflow, values, files, update)
  const uploaded = {}, finalValues = copy(values)
  const media = workflow.fields.filter(field => ['image', 'video', 'audio'].includes(field.kind) && files[field.id])
  for (let i = 0; i < media.length; i++) {
    const field = media[i]
    const body = new FormData()
    body.append('image', files[field.id], files[field.id].name)
    body.append('type', 'input')
    body.append('overwrite', 'false')
    update({ status: 'UPLOADING', detail: '上传 ' + (i + 1) + '/' + media.length + ' · ' + field.label, progress: 0 })
    const result = await upload(workflow.address + '/upload/image', body, progress => update({ progress }))
    if (!result?.name) throw new Error('素材上传未返回文件名')
    uploaded[field.id] = (result.subfolder ? result.subfolder + '/' : '') + result.name
  }
  for (const field of workflow.fields) {
    if (['seed', 'noise_seed'].includes(field.name) && Number(finalValues[field.id]) === -1) finalValues[field.id] = Math.floor(Math.random() * 4294967295)
    if (field.kind === 'number') finalValues[field.id] = Number(finalValues[field.id])
  }
  const graph = materializeGraph(workflow.graph, workflow.fields, finalValues, uploaded)
  update({ status: 'SUBMITTING', detail: '正在提交工作流，请勿重复提交', progress: null })
  const result = await request(workflow.address + '/prompt', postJSON({ prompt: graph, client_id: uid() }), 120000)
  if (!result.prompt_id || result.error) throw new Error(result.error?.message || '工作流未被接受：' + JSON.stringify(result.node_errors || result))
  return { remoteId: result.prompt_id, values: { ...finalValues, ...uploaded }, detail: 'ComfyUI 已接收任务' }
}
async function submitRunway(workflow, values, files, update) {
  if (!files.character || !files.reference) throw new Error('请选择角色素材和动作参考视频')
  const health = (await checkConnection(workflow)).health
  const characterType = files.character.type.startsWith('video/') ? 'video' : 'image'
  if (characterType === 'video' && health.characterVideo !== 'enabled') throw new Error('当前后端不支持角色视频，请更新后端或使用图片')
  const directValues = { character_type: characterType, expression_intensity: Number(values.expression || 3), body_control: characterType === 'image' && !!values.body, ratio: values.ratio || '720:1280' }
  if (values.seed !== '' && values.seed !== undefined) {
    if (!Number.isSafeInteger(Number(values.seed))) throw new Error('随机种子需要整数')
    directValues.seed = Number(values.seed)
  }
  if (health.directUpload === 'enabled') {
    const uris = []
    try {
      for (const [index, file] of [files.character, files.reference].entries()) {
        const slot = await request(workflow.address + '/api/uploads/init', postJSON({ filename: file.name }))
        const form = new FormData()
        Object.entries(slot.fields || {}).forEach(([key, value]) => form.append(key, value))
        form.append('file', file)
        update({ status: 'UPLOADING', detail: '直传 Runway · 素材 ' + (index + 1) + '/2', progress: 0 })
        await upload(slot.uploadUrl, form, progress => update({ progress }))
        uris.push(slot.runwayUri)
      }
    } catch (error) {
      // Safe fallback ONLY before the task-creation request is made.
      update({ detail: '直传素材未完成，改用后端中转' })
      return relayRunway(workflow, directValues, files, update)
    }
    update({ status: 'SUBMITTING', detail: '素材已上传，正在创建 Runway 任务', progress: null })
    const result = await request(workflow.address + '/api/tasks/direct', postJSON({ ...directValues, character_uri: uris[0], reference_uri: uris[1] }), 120000)
    if (!result.id) throw new Error('服务未返回任务编号，请先核对服务端任务')
    return { remoteId: result.id, values, detail: 'Runway 已接收任务' }
  }
  return relayRunway(workflow, directValues, files, update)
}
async function relayRunway(workflow, values, files, update) {
  const form = new FormData()
  form.append('character_file', files.character)
  form.append('reference_video', files.reference)
  Object.entries(values).forEach(([key, value]) => form.append(key, String(value)))
  // This endpoint both uploads and creates a task. A failed response is NOT retried.
  update({ status: 'SUBMITTING', detail: '上传至后端并创建任务，请勿重复提交', progress: 0 })
  const result = await upload(workflow.address + '/api/tasks', form, progress => update({ progress }))
  if (!result?.id) throw new Error('服务未返回任务编号，请先核对服务端任务')
  return { remoteId: result.id, values, detail: 'Runway 已接收任务' }
}
export async function queryTask(task) {
  const workflow = task.workflow
  if (workflow.provider === 'runninghub') {
    const key = await requireRunningHubKey()
    const result = await runningHubRequest('/openapi/v2/query', { taskId: task.remoteId }, key)
    const change = runningHubResult(result, task.remoteId)
    change.detail = redact(change.detail, key)
    return change
  }
  if (workflow.provider === 'runway') {
    const result = await request(workflow.address + '/api/tasks/' + encodeURIComponent(task.remoteId))
    const status = ({ THROTTLED: 'PENDING', CANCELLED: 'CANCELED' })[result.status] || result.status
    const outputs = (result.output || []).map((url, index) => ({ id: String(index), url, filename: 'runway-' + task.remoteId + '-' + index + '.mp4', kind: resultKind(url, 'video') }))
    return { status, outputs, detail: result.failure || result.failureCode || (status === 'SUCCEEDED' ? '结果已返回' : 'Runway 正在处理') }
  }
  const data = await request(workflow.address + '/history/' + encodeURIComponent(task.remoteId))
  const history = data[task.remoteId]
  if (history) {
    if (history.status?.status_str === 'error') {
      const error = (history.status.messages || []).find(item => item[0] === 'execution_error')?.[1]
      return { status: 'FAILED', detail: error?.exception_message || '工作流执行失败，请检查服务端节点与模型', outputs: [] }
    }
    const outputs = comfyOutputs(history, workflow.address)
    if (history.status?.completed || outputs.length) return { status: 'SUCCEEDED', outputs, detail: outputs.length ? '结果已返回' : '工作流完成，但未返回可保存的媒体。请使用保存图片/视频的输出节点。' }
  }
  const queue = await request(workflow.address + '/queue')
  const has = list => (list || []).some(item => item[1] === task.remoteId)
  if (has(queue.queue_running)) return { status: 'RUNNING', detail: 'ComfyUI 正在执行', outputs: [] }
  if (has(queue.queue_pending)) return { status: 'PENDING', detail: '任务正在排队', outputs: [] }
  return { status: 'REVIEW', detail: '服务中暂未找到此任务，可能已重启或清理记录。保留本地任务，稍后可刷新；不会自动重提。', outputs: [] }
}
function redact(message, key) {
  return String(message || '平台请求失败').split(key || '\u0000').join('••••••').replace(/Bearer\s+\S+/gi, 'Bearer ••••••')
}
async function requireRunningHubKey() {
  const key = await getRunningHubKey()
  if (!key) throw new Error('请在 RunningHub 配置中填写并保存 API Key，再查询或提交任务')
  return key
}
async function runningHubRequest(path, body, suppliedKey) {
  const key = suppliedKey || await requireRunningHubKey()
  try {
    // Credentials go only to this fixed HTTPS platform origin, never to a pasted workflow URL.
    const init = postJSON(path.startsWith('/task/') || path.startsWith('/api/') ? { ...body, apiKey: key } : body)
    init.headers.Authorization = 'Bearer ' + key
    const result = await request(RUNNINGHUB_ORIGIN + path, init, 120000)
    if (result?.code !== undefined && Number(result.code) !== 0) throw new Error('RunningHub ' + result.code + '：' + (result.msg || result.message || '请求失败'))
    return result
  } catch (error) { throw new Error(redact(error.message, key)) }
}
async function submitRunningHub(workflow, values, files, update) {
  // Validate/prune BEFORE uploading anything. A branch choice is always explicit.
  runningHubBody(workflow, values)
  const key = await requireRunningHubKey(), uploaded = {}
  const media = workflow.fields.filter(field => field.enabled !== false && ['image', 'video', 'audio'].includes(field.kind) && files[field.id])
  for (const [index, field] of media.entries()) {
    const form = new FormData()
    form.append('file', files[field.id], files[field.id].name)
    update({ status: 'UPLOADING', detail: '上传至 RunningHub ' + (index + 1) + '/' + media.length + ' · ' + field.label, progress: 0 })
    let result
    try { result = await upload(RUNNINGHUB_ORIGIN + '/openapi/v2/media/upload/binary', form, progress => update({ progress }), { Authorization: 'Bearer ' + key }) }
    catch (error) { throw new Error(redact(error.message, key)) }
    if (Number(result?.code) !== 0 || !result.data?.fileName) throw new Error('RunningHub 素材上传失败：' + redact(result?.message || result?.msg || '未返回 fileName', key))
    uploaded[field.id] = result.data.fileName
  }
  const prepared = runningHubBody(workflow, values, uploaded)
  update({ status: 'SUBMITTING', detail: '正在提交所选分支，请勿重复提交', progress: null })
  // Never retry task creation: an ambiguous network failure might already have incurred a task.
  const result = await runningHubRequest('/task/openapi/create', prepared.body, key)
  if (!result.data?.taskId || typeof result.data.taskId !== 'string') throw new Error('平台未返回字符串任务编号，请先在 RunningHub 核对任务；不会自动重提')
  return { remoteId: result.data.taskId, values: prepared.values, detail: 'RunningHub 已接收所选分支' }
}
export async function cancelTask(task) {
  if (task.workflow.provider !== 'comfy') throw new Error('此来源暂未适配单任务取消')
  const queue = await request(task.workflow.address + '/queue')
  if (!(queue.queue_pending || []).some(item => item[1] === task.remoteId)) throw new Error('仅能移除尚未开始的排队任务；不会调用全局中断影响其他任务')
  await request(task.workflow.address + '/queue', postJSON({ delete: [task.remoteId] }))
}
