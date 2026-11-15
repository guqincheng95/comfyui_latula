// Presentation only. Submission always uses original IDs, paths and graph values.
import { isLink } from './workflow.js'
const key = v => String(v || '').toLowerCase().replace(/[\s_\-]/g, '')
const aliases = {
 seed:['seed','noise_seed','random_seed','随机种子','种子'],steps:['steps','num_steps','sampling_steps','采样步数','步数'],
 guidance:['cfg','guidance','guidance_scale','cfg_scale','提示词引导','引导强度'],denoise:['denoise','denoising_strength','重绘强度'],
 sampler:['sampler_name','sampler','采样器'],scheduler:['scheduler','scheduler_name','调度器','调度方式'],
 width:['width','宽度'],height:['height','高度'],ratio:['aspect_ratio','ratio','比例','画幅比例'],
}
const labels={seed:'随机种子',steps:'采样步数',guidance:'提示词引导',denoise:'重绘强度',sampler:'采样器',scheduler:'调度方式',width:'宽度',height:'高度',ratio:'画幅比例'}
function semantic(name){return Object.keys(aliases).find(role=>aliases[role].some(alias=>key(alias)===key(name)))}
const helper=/llm|language|textgenerat|promptoptim|翻译|提示词优化/i
const sampling=/sampl|schedul|noise|guider|seed|采样|调度|种子/i
const geometry=/latent|resolution|dimensions|size.?control|分辨率|尺寸|比例/i
function consumers(graph,id){
 const names=new Set(),seen=new Set()
 function visit(source,depth){
  if(depth>6||seen.has(source))return
  seen.add(source)
  for(const [target,node] of Object.entries(graph))for(const [name,value] of Object.entries(node.inputs||{})){
   if(!isLink(value,graph)||String(value[0])!==source)continue
   if(!helper.test(node.class_type))names.add(name)
   if(/reroute|primitive/i.test(node.class_type))visit(target,depth+1)
  }
 }
 visit(String(id),0);return [...names]
}
export function buildUIModules(graph={},fields=[],catalog={}){
 graph||={}
 const sections={inputs:[],prompts:[],sampling:[]},groups=new Map(),usageCache=new Map(),counts=new Map()
 for(const f of fields)if(!f.path)counts.set(f.nodeId,(counts.get(f.nodeId)||0)+1)
 for(const field of fields){
  const node=graph[field.nodeId]||{},title=node._meta?.title||field.nodeTitle||node.class_type||'服务参数',context=node.class_type||''
  if(!usageCache.has(field.nodeId))usageCache.set(field.nodeId,consumers(graph,field.nodeId))
  const outputs=catalog[context]?.output||[],usage=usageCache.get(field.nodeId)
  let role=semantic(field.name)
  if(!role&&!field.path&&counts.get(field.nodeId)===1){
   const roles=[...new Set(usage.map(semantic).filter(Boolean))];if(roles.length===1)role=roles[0]
  }
  const isGeometry=['width','height','ratio'].includes(role)
  const isSampling=role&&!helper.test(context+' '+title)&&(isGeometry
   ?geometry.test(context+' '+title)||usage.some(n=>/latent|width|height|aspect_ratio/.test(n))||(!context&&role==='ratio')
   :sampling.test(context)||outputs.some(t=>['SAMPLER','SIGMAS','NOISE','GUIDER'].includes(t))||usage.some(n=>semantic(n)===role)||['sampler','scheduler'].includes(role))
  const isPrompt=['textarea','text'].includes(field.kind)&&(/^(text|prompt|positive|text_g|text_l|clip_l|t5xxl|string|value)$/i.test(field.name)||/提示词/.test(field.label))
  const hiddenPrompt=/negative|反向|负面|system.?prompt|固定提示词|系统提示词|template/i.test(field.name+' '+title+' '+field.label)||String(field.default||'').length>2048||usage.length>0&&usage.every(name=>/negative|system.?prompt/i.test(name))
  let section
  if(!field.customAdvanced){
   if(['image','video','audio'].includes(field.kind)&&!(field.virtualMask&&!field.maskReference))section='inputs'
   else if(isSampling&&!field.path)section='sampling'
   else if(isPrompt&&!role&&!hiddenPrompt&&!field.path)section='prompts'
  }
  if(section){
   const display={...field}
   if(section==='inputs'&&!field.virtualMask&&!field.customLabel&&!field.optional)display.label=({image:'参考图片',video:'参考视频',audio:'音频素材'})[field.kind]
   if(section==='sampling'&&!field.customLabel)display.label=labels[role]
   if(section==='prompts'){display.kind='textarea';if(!field.customLabel)display.label='正向提示词'}
   if(section==='sampling'&&['sampler','scheduler'].includes(role)&&display.kind!=='select'){
    display.kind='select';display.options=[String(field.default??'')];display.optionSource='当前仅有工作流中的值；同步控件选项后读取服务端列表。'
   }
   sections[section].push(display)
  }else{
   const id=String(field.nodeId||'service')
   if(!groups.has(id))groups.set(id,{id,title,className:context,fields:[]})
   groups.get(id).fields.push(field)
  }
 }
 return {...sections,advanced:[...groups.values()]}
}
