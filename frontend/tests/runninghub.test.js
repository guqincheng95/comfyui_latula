import test from 'node:test'
import assert from 'node:assert/strict'
import { runningHubId, outputBranches, scopeGraph, assembleRunningHub, runningHubBody, runningHubResult } from '../src/lib/runninghub.js'
import { defaults } from '../src/lib/workflow.js'
import { setRunningHubKey, clearRunningHubKey } from '../src/lib/credentials.js'
import { checkConnection, submitTask, queryTask } from '../src/lib/api.js'
const graph = {
  '1': { class_type: 'LoadImageGoohai', inputs: { image: 'existing.png', 保留透明通道: true } },
  '2': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'edit cat' } },
  '3': { class_type: 'FakeSampler', inputs: { image: ['1', 0], prompt: ['2', 0], seed: 31 } },
  '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'fixture' } },
  '10': { class_type: 'LoadImage', inputs: { image: 'unrelated.png' } },
  '11': { class_type: 'SaveImage', inputs: { images: ['10', 0] } },
  '12': { class_type: 'Image Comparer (rgthree)', inputs: { image_a: ['3', 0], image_b: ['10', 0] } },
}
const workflow = { id: 'rh-fixture', provider: 'runninghub', address: 'https://evil.example', workflowId: '2121823324379631618', graph, outputId: '4', ...assembleRunningHub(graph, '4') }
test('RunningHub IDs retain precision, pasted links cannot redirect credentials', () => {
  assert.equal(runningHubId('https://www.runninghub.cn/workflow/2121823324379631618?source=workspace'), '2121823324379631618')
  assert.equal(runningHubId('2121823324379631618'), '2121823324379631618')
  for (const input of ['https://evil.example/workflow/2121823324379631618', 'http://www.runninghub.cn/workflow/2121823324379631618', 'https://runninghub.cn:8443/workflow/2121823324379631618', 'https://www.runninghub.cn/ai-app/2121823324379631618']) assert.throws(() => runningHubId(input))
})
test('single-output closure excludes independent GPU branch and comparer without changing original', () => {
  const before = JSON.stringify(graph)
  assert.equal(outputBranches(graph).length, 2)
  assert.throws(() => scopeGraph(graph, ''), /分支/)
  assert.throws(() => scopeGraph(graph, 'missing'), /分支/)
  assert.deepEqual(Object.keys(scopeGraph(graph, '4')), ['1', '2', '3', '4'])
  assert.equal(JSON.stringify(graph), before)
  assert.equal(workflow.fields.find(f => f.id === '1::image').kind, 'image')
  assert.ok(!workflow.fields.some(f => f.nodeId === '10'))
})
test('platform payload has only selected branch, scalar overrides, uploaded file and reproducible seed', () => {
  const values = { ...defaults(workflow.fields), '2::value': 'modified prompt', '3::seed': -1 }
  const result = runningHubBody(workflow, values, { '1::image': 'openapi/test.png' })
  const sent = JSON.parse(result.body.workflow)
  assert.equal(sent['1'].inputs.image, 'openapi/test.png')
  assert.equal(sent['2'].inputs.value, 'modified prompt')
  assert.deepEqual(sent['3'].inputs.prompt, ['2', 0])
  assert.equal(sent['10'], undefined)
  assert.ok(Number.isSafeInteger(result.values['3::seed']) && result.values['3::seed'] >= 0)
  assert.equal(result.body.nodeInfoList.find(f => f.nodeId === '3' && f.fieldName === 'seed').fieldValue, result.values['3::seed'])
  assert.ok(!result.body.nodeInfoList.some(f => typeof f.fieldValue === 'object'))
  assert.equal(graph['2'].inputs.value, 'edit cat')
})
test('platform disabled fields preserve defaults; unknown status and malicious output URLs are handled', () => {
  const changed = { ...workflow, fields: workflow.fields.map(f => f.id === '2::value' ? { ...f, enabled: false } : f) }
  const result = runningHubBody(changed, { '2::value': 'must not send' })
  assert.equal(JSON.parse(result.body.workflow)['2'].inputs.value, 'edit cat')
  assert.equal(runningHubResult({ status: 'QUEUED' }, '1').status, 'PENDING')
  assert.equal(runningHubResult({ status: 'UNKNOWN' }, '1').status, 'REVIEW')
  assert.equal(runningHubResult({ status: 'FAILED', errorMessage: 'model unavailable' }, '1').detail, 'model unavailable')
  const output = runningHubResult({ status: 'SUCCESS', results: [{ url: 'https://cdn.example/a.mp4?signature=test', outputType: 'mp4' }, { url: 'javascript:alert(1)', outputType: 'png' }] }, '1')
  assert.equal(output.outputs.length, 1)
  assert.equal(output.outputs[0].kind, 'video')
})
test('official transport: auth, JSON read, multipart upload, one submit and V2 result; no secret in snapshot', async () => {
  const originalFetch = globalThis.fetch, originalXHR = globalThis.XMLHttpRequest
  const calls = [], key = 'fixture-only-not-a-real-api-key'
  await setRunningHubKey(key)
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body, headers: init.headers })
    assert.ok(url.startsWith('https://www.runninghub.cn/'))
    assert.equal(init.headers.Authorization, 'Bearer ' + key)
    let payload
    if (url.endsWith('getJsonApiFormat')) payload = { code: 0, data: { prompt: JSON.stringify(graph) } }
    else if (url.endsWith('/create')) payload = { code: 0, data: { taskId: '2121823324379631999' } }
    else payload = { status: 'SUCCESS', results: [{ url: 'https://cdn.example/result.png', outputType: 'png' }] }
    return new Response(JSON.stringify(payload), { status: 200 })
  }
  globalThis.XMLHttpRequest = class {
    upload = {}
    headers = {}
    open(method, url) { this.url = url; assert.equal(method, 'POST') }
    setRequestHeader(name, value) { this.headers[name] = value }
    send(form) {
      assert.equal(this.url, 'https://www.runninghub.cn/openapi/v2/media/upload/binary')
      assert.equal(this.headers.Authorization, 'Bearer ' + key)
      assert.equal(form.get('file').name, 'input.png')
      this.status = 200; this.response = { code: 0, data: { fileName: 'openapi/uploaded.png' } }
      queueMicrotask(() => this.onload())
    }
  }
  try {
    assert.deepEqual((await checkConnection(workflow)).graph, graph)
    const submitted = await submitTask(workflow, defaults(workflow.fields), { '1::image': new File(['test'], 'input.png', { type: 'image/png' }) }, () => {})
    assert.equal(submitted.remoteId, '2121823324379631999')
    const change = await queryTask({ workflow, remoteId: submitted.remoteId })
    assert.equal(change.status, 'SUCCEEDED')
    assert.equal(calls.filter(c => c.url.endsWith('/create')).length, 1)
    assert.equal(JSON.parse(calls[1].body.workflow)['1'].inputs.image, 'openapi/uploaded.png')
    assert.equal(calls[1].body.apiKey, key)
    assert.ok(!JSON.stringify({ workflow, submitted, change }).includes(key))
    let attempts = 0
    globalThis.fetch = async () => { attempts++; throw new TypeError('network lost') }
    await assert.rejects(submitTask(workflow, defaults(workflow.fields), {}, () => {}), /无法连接/)
    assert.equal(attempts, 1, 'ambiguous create is never retried')
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 403, msg: 'invalid key ' + key }), { status: 200 })
    await assert.rejects(checkConnection(workflow), error => !error.message.includes(key) && /403/.test(error.message))
    await clearRunningHubKey()
    await assert.rejects(checkConnection(workflow), /API Key/)
  } finally { globalThis.fetch = originalFetch; globalThis.XMLHttpRequest = originalXHR; await clearRunningHubKey() }
})
