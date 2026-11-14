<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import GameIcon from './GameIcon.vue'
const props = defineProps({ field: Object, file: Object, modelValue: [String, Number], disabled: Boolean })
const emit = defineEmits(['file', 'update:modelValue'])
const preview = ref('')
watch(() => props.file, file => { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = file ? URL.createObjectURL(file) : '' }, { immediate: true })
onBeforeUnmount(() => { if (preview.value) URL.revokeObjectURL(preview.value) })
</script>
<template>
  <div class="media-input">
    <label class="media-drop" :class="{ filled: file }">
      <img v-if="preview && field.kind === 'image'" :src="preview" alt="已选参考图" />
      <video v-else-if="preview && field.kind === 'video'" :src="preview" controls playsinline preload="metadata" @click.stop />
      <audio v-else-if="preview && field.kind === 'audio'" :src="preview" controls @click.stop />
      <GameIcon v-else :name="field.kind === 'image' ? 'image' : 'upload'" :size="32" />
      <span>{{ file ? file.name : '点击选择' + field.label }}</span>
      <small v-if="file">{{ (file.size / 1024 / 1024).toFixed(1) }} MB</small>
      <input class="file-input" type="file" :accept="field.kind + '/*'" :disabled="disabled" :aria-label="field.label" @change="emit('file', $event.target.files?.[0] || null)" />
    </label>
    <button v-if="file" type="button" class="text-button" :disabled="disabled" @click="emit('file', null)">移除所选文件</button>
    <div v-else-if="modelValue" class="server-file">
      <small>服务端已有文件</small>
      <input :id="'field-' + field.id" :value="modelValue" :aria-label="field.label + '服务端文件名'" :disabled="disabled" @input="emit('update:modelValue', $event.target.value)" />
      <small>更换服务后请确认文件存在，或重新上传。</small>
    </div>
  </div>
</template>
