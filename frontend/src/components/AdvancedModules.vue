<script setup>
import { ref } from 'vue'
import ModuleFields from './ModuleFields.vue'
defineProps({groups:Array,values:Object,files:Object,disabled:Boolean})
const emit=defineEmits(['file','value','mask','clearMask','notice'])
const open=ref(false),expanded=ref({})
function toggle(event){if(event.target===event.currentTarget)open.value=event.currentTarget.open}
function toggleNode(event,id){if(event.target===event.currentTarget)expanded.value[id]=event.currentTarget.open}
</script>
<template>
 <details class="parchment advanced-modules" @toggle="toggle"><summary>高级设置 · {{ groups.length }} 个节点</summary><template v-if="open"><p class="muted">按原节点收纳，展开查看。未修改的参数沿用工作流原值。</p>
  <details v-for="group in groups" :key="group.id" class="advanced-node" :data-node-id="group.id" :open="!!expanded[group.id]" @toggle="toggleNode($event,group.id)"><summary><strong>{{ group.title }}</strong><small>节点 {{ group.id }} · {{ group.fields.length }} 项</small></summary>
   <ModuleFields v-if="expanded[group.id]" :fields="group.fields" :values="values" :files="files" :disabled="disabled" @file="(f,v)=>emit('file',f,v)" @value="(f,v)=>emit('value',f,v)" @mask="f=>emit('mask',f)" @clear-mask="f=>emit('clearMask',f)" @notice="emit('notice',$event)" />
  </details></template>
 </details>
</template>
