<script setup>
import { computed } from 'vue'
import WorkflowField from './WorkflowField.vue'
import ReferenceInputs from './ReferenceInputs.vue'
const props=defineProps({fields:Array,values:Object,files:Object,disabled:Boolean})
const emit=defineEmits(['file','value','mask','clearMask','notice'])
const groups=computed(()=>[...new Set(props.fields.filter(f=>f.mediaGroup).map(f=>f.mediaGroup))].map(id=>({id,fields:props.fields.filter(f=>f.mediaGroup===id)})))
</script>
<template>
 <ReferenceInputs v-for="group in groups" :key="group.id" :fields="group.fields" :values="values" :files="files" :disabled="disabled" hide-source @file="(f,v)=>emit('file',f,v)" @value="(f,v)=>emit('value',f,v)" @mask="f=>emit('mask',f)" @clear-mask="f=>emit('clearMask',f)" @notice="emit('notice',$event)" />
 <WorkflowField v-for="field in fields.filter(f=>!f.mediaGroup)" :key="field.id" :field="field" :model-value="values[field.id]" :file="files[field.id]" :mask="files[field.id+'::$mask']" :disabled="disabled" hide-source @file="emit('file',field,$event)" @update:model-value="emit('value',field,$event)" @mask="emit('mask',field)" @clear-mask="emit('clearMask',field)" />
</template>
