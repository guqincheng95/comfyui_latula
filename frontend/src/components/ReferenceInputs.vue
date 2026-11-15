<script setup>
import { computed } from 'vue'
import WorkflowField from './WorkflowField.vue'
import GameIcon from './GameIcon.vue'
const props = defineProps({ fields: Array, values: Object, files: Object, disabled: Boolean, hideSource: Boolean })
const emit = defineEmits(['file', 'value', 'mask', 'clearMask', 'notice'])
const visible = computed(() => {
  const empty = props.fields.find(f => !props.files[f.id] && !props.values[f.id])
  return props.fields.filter(f => !f.optional || props.files[f.id] || props.values[f.id] || f === empty)
})
function add(event) {
  const files = [...(event.target.files || [])], available = props.fields.filter(f => !props.files[f.id] && !props.values[f.id])
  for (let i = 0; i < Math.min(files.length, available.length); i++) emit('file', available[i], files[i])
  if (files.length > available.length) emit('notice', '超出此节点可用参考图端口数量，未加入多余文件')
  event.target.value = ''
}
</script>
<template>
  <section class="reference-rack"><div class="section-heading"><div><h3>多图参考</h3><small>{{ hideSource ? "" : fields[0]?.nodeTitle + " · " }}{{ fields.length }} 个图像入口，依端口顺序提交</small></div><GameIcon name="image" /></div>
    <label class="wood-button reference-add"><GameIcon name="add" :size="18" />批量添加参考图<input type="file" accept="image/*" multiple :disabled="disabled" aria-label="批量添加参考图" @change="add" /></label>
    <WorkflowField v-for="(field, index) in visible" :key="field.id" :field="{...field,label: field.optional ? '参考图 ' + (fields.indexOf(field) + 1) + '（可选）' : field.label}" :model-value="values[field.id]" :file="files[field.id]" :mask="files[field.id + '::$mask']" :disabled="disabled" :hide-source="hideSource" @update:model-value="emit('value',field,$event)" @file="emit('file',field,$event)" @mask="emit('mask',field)" @clear-mask="emit('clearMask',field)" />
  </section>
</template>
