import test from 'node:test'
import assert from 'node:assert/strict'
import { assembleGraphUI, compileGraph, materializeMedia, nodeCatalog, bypassLinks, parseCanvasMetadata } from '../src/lib/graph-ui.js'
import { defaults } from '../src/lib/workflow.js'
const schema = {
 LoadImage:{input:{required:{image:['STRING']}},output:['IMAGE','MASK']},
 AnyReferenceNode:{input:{required:{image1:['IMAGE']},optional:{image2:['IMAGE'],image3:['IMAGE']}},output:['IMAGE']},
 AnyLoraNode:{input:{required:{model:['MODEL'],strength:['FLOAT',{min:0,max:2}]}},output:['MODEL']},
 AnyModelLoader:{input:{required:{model_name:[['model-a','model-b']]}},output:['MODEL']},
 AnyPainter:{input:{required:{image:['IMAGE'],mask:['MASK'],model:['MODEL'],sampler_name:[['euler','heun']] }},output:['IMAGE']},
 SaveImage:{input:{required:{images:['IMAGE']}},output_node:true,output:[]}
}
function sample(offset=0) {
 const id=n=>String(n+offset)
 const graph={
  [id(1)]:{class_type:'LoadImage',inputs:{image:'base.png'}},
  [id(2)]:{class_type:'AnyReferenceNode',inputs:{image1:[id(1),0]}},
  [id(3)]:{class_type:'AnyModelLoader',inputs:{model_name:'model-a'}},
  [id(4)]:{class_type:'AnyLoraNode',inputs:{model:[id(3),0],strength:0.7}},
  [id(5)]:{class_type:'AnyPainter',inputs:{image:[id(2),0],mask:[id(1),1],model:[id(4),0],sampler_name:'euler'}},
  [id(6)]:{class_type:'SaveImage',inputs:{images:[id(5),0]}},
  [id(7)]:{class_type:'SaveImage',inputs:{images:[id(1),0]}}
 }
 return {graph,id}
}
test('unseen node classes and arbitrary IDs use server ports, dropdowns and true bypass',()=>{
 for(const offset of [0,1000,90000]){
  const {graph,id}=sample(offset),before=JSON.stringify(graph),ui=assembleGraphUI(graph,schema),values=defaults(ui.fields)
  assert.deepEqual(ui.fields.find(f=>f.id===id(3)+'::model_name').options,['model-a','model-b'])
  assert.equal(ui.fields.find(f=>f.id===id(2)+'::image2').virtualImage,true)
  assert.equal(ui.fields.find(f=>f.id===id(1)+'::image').maskSlot,1)
  const runtime={outputs:[id(6)],nodeModes:{[id(4)]:'bypass'}}
  const compiled=compileGraph(graph,ui.fields,values,runtime,ui.catalog).graph
  assert.deepEqual(compiled[id(5)].inputs.model,[id(3),0])
  assert.equal(compiled[id(4)],undefined);assert.equal(compiled[id(7)],undefined)
  assert.equal(JSON.stringify(graph),before)
  assert.throws(()=>compileGraph(graph,ui.fields,values,{outputs:[id(6)],nodeModes:{[id(3)]:'muted'}},ui.catalog),/依赖已停用/)
 }
})
test('multiple outputs share dependencies, source remains intact and empty run is rejected',()=>{
 const {graph}=sample(),ui=assembleGraphUI(graph,schema),values=defaults(ui.fields)
 const compiled=compileGraph(graph,ui.fields,values,{outputs:['6','7']},ui.catalog).graph
 assert.ok(compiled['6']&&compiled['7']);assert.equal(Object.keys(compiled).length,7)
 assert.throws(()=>compileGraph(graph,ui.fields,values,{outputs:[]},ui.catalog),/至少一个/)
})
test('multi-image and mask files are injected as typed loader links, never as IMAGE strings',()=>{
 const {graph}=sample(),ui=assembleGraphUI(graph,schema),values=defaults(ui.fields)
 const materialized=materializeMedia(graph,ui.fields,values,{'2::image2':'ref2.png','1::image::$mask':'mask.png'})
 const compiled=compileGraph(materialized,ui.fields,values,{outputs:['6']},ui.catalog).graph
 const added=compiled['2'].inputs.image2,mask=compiled['5'].inputs.mask
 assert.equal(compiled[added[0]].class_type,'LoadImage');assert.equal(compiled[added[0]].inputs.image,'ref2.png')
 assert.equal(compiled[mask[0]].class_type,'LoadImageMask');assert.equal(compiled[mask[0]].inputs.channel,'red')
 assert.deepEqual(compiled['5'].inputs.image,['2',0]);assert.equal(compiled['1'].inputs.image,'base.png')
})
test('unambiguous types required for bypass and selected switch branch suppresses unused controls',()=>{
 const graph={
 'a':{class_type:'Source',inputs:{}},'b':{class_type:'Source',inputs:{}},
 'c':{class_type:'Ambiguous',inputs:{left:['a',0],right:['b',0]}},
 's':{class_type:'ComfySwitchNode',inputs:{switch:false,on_false:['a',0],on_true:['c',0]}},
 'o':{class_type:'SaveImage',inputs:{images:['s',0]}}
 }
 const catalog={Ambiguous:{input:{required:{left:['IMAGE'],right:['IMAGE']}},output:['IMAGE']}}
 assert.throws(()=>bypassLinks(graph,'c',catalog),/唯一确定/)
 const ui=assembleGraphUI(graph),result=compileGraph(graph,ui.fields,defaults(ui.fields),{outputs:['o']},catalog)
 assert.equal(result.graph.c,undefined);assert.equal(result.graph.b,undefined);assert.deepEqual(result.graph.o.inputs.images,['a',0]);assert.ok(result.visible.has('s'))
})
test('canvas metadata gives generic group labels and port types without workflow-specific rules',()=>{
 const canvas=parseCanvasMetadata({nodes:[{id:4,pos:[10,10],size:[100,100],mode:4,inputs:[{name:'model',type:'MODEL'}],outputs:[{type:'MODEL'}]}],groups:[{title:'通用增强',bounding:[0,0,200,200]}]})
 assert.deepEqual(canvas.groups[0].nodes,['4']);assert.equal(canvas.nodes['4'].mode,4)
 const {graph}=sample();assert.deepEqual(bypassLinks(graph,'4',{},canvas),{0:['3',0]})
})
test('structured widget leaves preserve other values and model choices are honestly sourced',()=>{
 const graph={'1':{class_type:'AnyStructured',inputs:{slot:{lora:'lora-a',on:true,strength:0.7},other:{lora:'lora-b',on:false,strength:1}}},'2':{class_type:'SaveImage',inputs:{images:['1',0]}}}
 const ui=assembleGraphUI(graph),field=ui.fields.find(f=>f.name==='slot'&&f.path?.[0]==='on'),values=defaults(ui.fields);values[field.id]=false
 const compiled=compileGraph(graph,ui.fields,values,{outputs:['2']},ui.catalog).graph
 assert.equal(compiled['1'].inputs.slot.on,false);assert.equal(compiled['1'].inputs.slot.strength,0.7)
 assert.deepEqual(ui.fields.find(f=>f.name==='slot'&&f.path?.[0]==='lora').options,['lora-a','lora-b'])
})

test('optional masks do not assume coordinates of a transformed upstream original',()=>{
 const graph={
 '1':{class_type:'LoadImage',inputs:{image:'source.png'}},
 '2':{class_type:'UnknownCrop',inputs:{image:['1',0]}},
 '3':{class_type:'UnknownEdit',inputs:{image:['2',0]}},
 '4':{class_type:'SaveImage',inputs:{images:['3',0]}}
 }
 const metadata={UnknownCrop:{input:{required:{image:['IMAGE']}},output:['IMAGE']},UnknownEdit:{input:{required:{image:['IMAGE']},optional:{mask:['MASK']}},output:['IMAGE']}}
 const ui=assembleGraphUI(graph,metadata),mask=ui.fields.find(f=>f.id==='3::mask')
 assert.equal(mask.virtualMask,true);assert.equal(mask.maskReference,undefined);assert.equal(mask.advanced,true);assert.match(mask.maskWarning,/中间处理/)
})
