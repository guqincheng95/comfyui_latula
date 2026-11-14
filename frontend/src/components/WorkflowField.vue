<script setup>
import PromptInput from './PromptInput.vue'
import MediaInput from './MediaInput.vue'
defineProps({ field: Object, modelValue: [String, Number, Boolean], file: Object, disabled: Boolean })
defineEmits(['update:modelValue', 'file'])
</script>
<template>
  <div class="field-group">
    <label :for="'field-' + field.id">{{ field.label }}<small v-if="field.nodeTitle">{{ field.nodeTitle }}</small></label>
    <MediaInput v-if="['image','video','audio'].includes(field.kind)" :field="field" :model-value="modelValue" :file="file" :disabled="disabled" @file="$emit('file', $event)" @update:model-value="$emit('update:modelValue', $event)" />
    <PromptInput v-else-if="field.kind === 'textarea'" :field="field" :model-value="modelValue" :disabled="disabled" @update:model-value="$emit('update:modelValue', $event)" />
    <select v-else-if="field.kind === 'select'" :id="'field-' + field.id" :value="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.value)"><option v-for="option in field.options" :key="option" :value="option">{{ option }}</option></select>
    <label v-else-if="field.kind === 'toggle'" class="switch-row"><span>{{ modelValue ? '开启' : '关闭' }}</span><input :id="'field-' + field.id" type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)" /></label>
    <input v-else :id="'field-' + field.id" :type="field.kind === 'number' ? 'number' : /key|token|secret|password/i.test(field.name) ? 'password' : 'text'" :value="modelValue" :min="field.min" :max="field.max" :step="field.step" :disabled="disabled" @input="$emit('update:modelValue', field.kind === 'number' && $event.target.value !== '' ? Number($event.target.value) : $event.target.value)" />
    <small v-if="['seed','noise_seed'].includes(field.name)">填 -1 时，每次提交会生成新的种子并记入历史。</small>
  </div>
</template>
