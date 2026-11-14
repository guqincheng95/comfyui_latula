<script setup>
defineProps({ field: Object, modelValue: [String, Number], disabled: Boolean })
defineEmits(['update:modelValue'])
</script>
<template><textarea :id="'field-' + field.id" :value="modelValue" :disabled="disabled" rows="4" :placeholder="field.label" @input="$emit('update:modelValue', $event.target.value)" /></template>
