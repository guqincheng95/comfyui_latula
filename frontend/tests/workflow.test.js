import test from 'node:test'
import assert from 'node:assert/strict'
import { assembleWorkflow, parseWorkflow, materializeGraph, normalizeAddress, defaults, validateValues, comfyOutputs } from '../src/lib/workflow.js'
const graph = {
 '1': { class_type:'LoadImage',inputs:{image:'reference.png'} },
 '2': { class_type:'CLIPTextEncode',inputs:{text:'a cat',clip:['9',1]} },
 '3': { class_type:'CLIPTextEncode',inputs:{text:'blur',clip:['9',1]} },
 '4': { class_type:'KSampler',inputs:{model:['9',0],positive:['2',0],negative:['3',0],latent_image:['6',0],seed:12,steps:20,cfg:7,denoise:1,sampler_name:'euler'} },
 '6': { class_type:'VAEEncode',inputs:{pixels:['1',0],vae:['9',2]} },
 '8': { class_type:'EmptyLatentImage',inputs:{width:512,height:768,batch_size:1} },
 '9': { class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'model.safetensors'} },
 '10': { class_type:'SaveImage',inputs:{images:['4',0],filename_prefix:'test'} }
}
test('imports API JSON, including prompt wrapper, without accepting editor JSON',()=>{
 assert.deepEqual(parseWorkflow(JSON.stringify({prompt:graph})),graph)
 assert.throws(()=>parseWorkflow({nodes:[],links:[]}),/API/)
 assert.throws(()=>parseWorkflow('broken'),/JSON/)
 assert.throws(()=>parseWorkflow({'1':{class_type:'Foo',inputs:'wrong'}}),/inputs/)
})
test('automatically assembles independent image, positive/negative prompts and dimensions',()=>{
 const {fields}=assembleWorkflow(graph)
 assert.equal(fields.find(f=>f.id==='1::image').kind,'image')
 assert.equal(fields.find(f=>f.id==='2::text').label,'正向提示词')
 assert.equal(fields.find(f=>f.id==='3::text').label,'反向提示词')
 assert.equal(fields.find(f=>f.id==='8::width').kind,'number')
 assert.ok(!fields.find(f=>f.id==='4::model'))
})
test('reads custom node dropdowns and constraints from object_info',()=>{
 const custom={'5':{class_type:'CustomEdit',inputs:{prompt:'hello',strength:0.5,mode:'fast',enabled:true}}}
 const info={CustomEdit:{input:{required:{prompt:['STRING',{multiline:true}],strength:['FLOAT',{min:0,max:1,step:0.1}],mode:[['fast','quality']],enabled:['BOOLEAN']}}}}
 const {fields,missing}=assembleWorkflow(custom,info)
 assert.equal(fields.find(f=>f.name==='prompt').kind,'textarea')
 assert.deepEqual(fields.find(f=>f.name==='mode').options,['fast','quality'])
 assert.equal(fields.find(f=>f.name==='enabled').kind,'toggle')
 assert.deepEqual(missing,[])
 const values=defaults(fields);values['5::strength']=2
 assert.throws(()=>validateValues(fields,values),/范围/)
})
test('reports unavailable custom node types instead of claiming they work',()=>{
 const assembled=assembleWorkflow({'1':{class_type:'MissingCustom',inputs:{}}},{})
 assert.deepEqual(assembled.missing,['MissingCustom'])
 assert.match(assembled.warnings[0],/MissingCustom/)
})
test('materialization changes only mapped values and uploaded file, preserving graph links',()=>{
 const {fields}=assembleWorkflow(graph), values=defaults(fields)
 values['2::text']='edited';values['4::seed']=123
 const result=materializeGraph(graph,fields,values,{'1::image':'inputs/uploaded.png'})
 assert.equal(result['1'].inputs.image,'inputs/uploaded.png')
 assert.equal(result['2'].inputs.text,'edited')
 assert.equal(result['4'].inputs.seed,123)
 assert.deepEqual(result['4'].inputs.positive,['2',0])
 assert.equal(graph['2'].inputs.text,'a cat')
 assert.equal(graph['1'].inputs.image,'reference.png')
})
test('missing required material fails, server filenames remain usable, random seed is accepted',()=>{
 const fields=[{id:'i',name:'image',label:'参考图片',kind:'image',default:''},{id:'s',name:'seed',label:'种子',kind:'number',min:0,max:4294967295,default:0}]
 assert.throws(()=>validateValues(fields,{i:'',s:1}),/参考图片/)
 validateValues(fields,{i:'existing.png',s:-1})
 validateValues(fields,{i:'',s:1},{i:{name:'local.png'}})
})
test('rejects dangerous field names and service URL credentials/schemes',()=>{
 assert.throws(()=>parseWorkflow('{"1":{"class_type":"X","inputs":{"__proto__":"bad"}}}'),/字段/)
 assert.throws(()=>normalizeAddress('ftp://example.com'),/http/)
 assert.throws(()=>normalizeAddress('https://user:password@example.com'),/密钥/)
 assert.throws(()=>normalizeAddress('https://example.com?apiKey=secret'),/密钥/)
 assert.equal(normalizeAddress('192.168.1.4:8188/'),'http://192.168.1.4:8188')
})
test('retains all image/video outputs and safely encodes filenames',()=>{
 const result=comfyOutputs({outputs:{'7':{images:[{filename:'a & b.png',subfolder:'one/two'}]},'8':{gifs:[{filename:'movie.mp4',format:'video/h264-mp4'}]}}},'http://host:8188')
 assert.equal(result.length,2);assert.equal(result[1].kind,'video')
 assert.equal(new URL(result[0].url).searchParams.get('filename'),'a & b.png')
 assert.equal(new URL(result[0].url).searchParams.get('subfolder'),'one/two')
})

test('explains malformed addresses, phone loopback and listen addresses in Chinese',()=>{
 assert.throws(()=>normalizeAddress('127.0.0.8188'),/冒号/)
 for(const value of ['http://127.0.0.1:8188','127.1:8188','localhost:8188','http://[::1]:8188']) assert.throws(()=>normalizeAddress(value,{allowLoopback:false}),/手机自身/)
 assert.throws(()=>normalizeAddress('0.0.0.0:8188'),/监听地址/)
 assert.equal(normalizeAddress('192.168.1.8:8188',{allowLoopback:false}),'http://192.168.1.8:8188')
})
test('disables disconnected media without deleting graph nodes and keeps concatenation fragments advanced',()=>{
 const sample={...graph,'144':{class_type:'LoadImage',inputs:{image:'unused.png'}},'87':{class_type:'Text Concatenate',inputs:{text_g:'',text_l:'',text_a:['2',0]}}}
 const original=JSON.stringify(sample), assembled=assembleWorkflow(sample)
 assert.equal(assembled.fields.find(f=>f.id==='144::image').enabled,false)
 assert.equal(assembled.fields.find(f=>f.id==='1::image').enabled,true)
 assert.equal(assembled.fields.find(f=>f.id==='87::text_g').kind,'text')
 assert.equal(assembled.fields.find(f=>f.id==='87::text_g').advanced,true)
 assert.match(assembled.warnings.join(' '),/未连接/)
 assert.equal(JSON.stringify(sample),original)
})
