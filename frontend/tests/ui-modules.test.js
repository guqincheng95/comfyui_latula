import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildUIModules } from '../src/lib/ui-modules.js'
import { assembleGraphUI,compileGraph } from '../src/lib/graph-ui.js'
import { defaults } from '../src/lib/workflow.js'
const basic=JSON.parse(fs.readFileSync(new URL('./fixtures/basic-api.json',import.meta.url)))
const all=ui=>[...ui.inputs,...ui.prompts,...ui.sampling,...ui.advanced.flatMap(g=>g.fields)]
test('critical operations are common UI modules; other controls are partitioned by node exactly once',()=>{
 const assembled=assembleGraphUI(basic),before=JSON.stringify(assembled.fields),ui=buildUIModules(basic,assembled.fields,assembled.catalog)
 assert.deepEqual(ui.inputs.map(f=>f.id),['1::image'])
 assert.deepEqual(ui.prompts.map(f=>f.id),['2::text'])
 assert.ok(ui.sampling.some(f=>f.id==='4::seed'&&f.label==='随机种子'))
 assert.ok(ui.sampling.some(f=>f.id==='4::sampler_name'&&f.kind==='select'))
 assert.deepEqual(ui.advanced.find(g=>g.id==='9').fields.map(f=>f.name),['ckpt_name'])
 assert.ok(ui.advanced.find(g=>g.id==='3').fields.some(f=>f.name==='text'))
 assert.ok(ui.advanced.find(g=>g.id==='10').fields.some(f=>f.name==='filename_prefix'))
 assert.deepEqual(all(ui).map(f=>f.id).sort(),assembled.fields.map(f=>f.id).sort())
 assert.equal(JSON.stringify(assembled.fields),before)
})
test('split sampling and scalar sources normalize across unknown node types and arbitrary node IDs',()=>{
 for(const prefix of ['a','renumbered-9000-']){
  const graph={
   [prefix+'seed']:{class_type:'PrimitiveInt',inputs:{value:42}},
   [prefix+'noise']:{class_type:'UnknownNoise',inputs:{noise_seed:[prefix+'seed',0]}},
   [prefix+'steps']:{class_type:'CustomScheduler',inputs:{num_steps:9,scheduler_name:'karras'}},
   [prefix+'sampler']:{class_type:'ThirdPartyAlgorithm',inputs:{sampler:'euler'}},
   [prefix+'run']:{class_type:'SamplerCustomAdvanced',inputs:{noise:[prefix+'noise',0],sigmas:[prefix+'steps',0],sampler:[prefix+'sampler',0]}},
   [prefix+'output']:{class_type:'SaveImage',inputs:{images:[prefix+'run',0]}}
  }
  const assembled=assembleGraphUI(graph),ui=buildUIModules(graph,assembled.fields,assembled.catalog)
  assert.deepEqual(ui.sampling.map(f=>f.label).sort(),['随机种子','采样步数','调度方式','采样器'].sort())
  const value=defaults(assembled.fields),seed=ui.sampling.find(f=>f.label==='随机种子');value[seed.id]=83
  const compiled=compileGraph(graph,assembled.fields,value,{outputs:[prefix+'output']},assembled.catalog).graph
  assert.equal(compiled[prefix+'seed'].inputs.value,83)
  assert.deepEqual(compiled[prefix+'noise'].inputs.noise_seed,[prefix+'seed',0])
 }
})
test('helper LLM seeds, image resize geometry and fixed/system text stay in their original advanced nodes',()=>{
 const graph={
 'x':{class_type:'LLMTextGenerate',inputs:{seed:3,temperature:0.5,system_prompt:'system'}},
 'y':{class_type:'ImageResize',inputs:{width:64,height:64}},
 'z':{class_type:'PrimitiveStringMultiline',_meta:{title:'固定提示词'},inputs:{value:'unchanged'}},
 'o':{class_type:'SaveImage',inputs:{images:['y',0]}}
 }
 const a=assembleGraphUI(graph),ui=buildUIModules(graph,a.fields,a.catalog)
 assert.equal(ui.sampling.length,0);assert.equal(ui.prompts.length,0)
 assert.deepEqual(ui.advanced.map(g=>g.id),['x','y','z'])
 assert.deepEqual(all(ui).map(f=>f.id).sort(),a.fields.map(f=>f.id).sort())
})
test('unseen image nodes, multi-image ports and masks use one shared input module',()=>{
 const graph={'a':{class_type:'UnknownImageLoader',inputs:{file:'base.png'}},'b':{class_type:'UnknownReference',inputs:{image1:['a',0]}},'o':{class_type:'SaveImage',inputs:{images:['b',0]}}}
 const schema={UnknownImageLoader:{input:{required:{file:['STRING',{image_upload:true}]}},output:['IMAGE','MASK']},UnknownReference:{input:{required:{image1:['IMAGE']},optional:{image2:['IMAGE'],image3:['IMAGE'],mask:['MASK']}},output:['IMAGE']}}
 const a=assembleGraphUI(graph,schema),ui=buildUIModules(graph,a.fields,a.catalog)
 assert.ok(ui.inputs.some(f=>f.id==='a::file'))
 assert.equal(ui.inputs.filter(f=>f.mediaGroup==='b').length,3)
 assert.ok(ui.inputs.some(f=>f.virtualMask&&f.maskReference))
 assert.deepEqual(all(ui).map(f=>f.id).sort(),a.fields.map(f=>f.id).sort())
})
test('explicit presentation overrides survive definition refresh without changing graph bindings',()=>{
 const a=assembleGraphUI(basic),original=a.fields.find(f=>f.id==='4::steps')
 const previous=a.fields.map(f=>f===original?{...f,customLabel:true,label:'细节步数',customAdvanced:true}:f)
 const rebuilt=assembleGraphUI(basic,{},previous),ui=buildUIModules(basic,rebuilt.fields,rebuilt.catalog)
 const f=ui.advanced.find(g=>g.id==='4').fields.find(f=>f.id===original.id)
 assert.equal(f.label,'细节步数');assert.equal(f.name,'steps');assert.equal(f.customAdvanced,true)
 assert.equal(ui.sampling.some(f=>f.id===original.id),false)
})

test('string bridges for sampler/scheduler are controls, while a negative-only bridge stays advanced',()=>{
 const graph={
 'a':{class_type:'PrimitiveStringMultiline',inputs:{value:'euler'}},
 'b':{class_type:'PrimitiveStringMultiline',inputs:{value:'karras'}},
 'n':{class_type:'PrimitiveStringMultiline',inputs:{value:'unwanted'}},
 'run':{class_type:'UnknownSampler',inputs:{sampler_name:['a',0],scheduler:['b',0],negative:['n',0]}},
 'o':{class_type:'SaveImage',inputs:{images:['run',0]}}
 }
 const a=assembleGraphUI(graph),ui=buildUIModules(graph,a.fields,a.catalog)
 assert.deepEqual(ui.sampling.map(f=>f.label),['采样器','调度方式'])
 assert.ok(ui.sampling.every(f=>f.kind==='select'))
 assert.equal(ui.prompts.length,0)
 assert.ok(ui.advanced.find(g=>g.id==='n').fields.some(f=>f.id==='n::value'))
 assert.deepEqual(all(ui).map(f=>f.id).sort(),a.fields.map(f=>f.id).sort())
})
