<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { getThumb } from '../lib/storage'
import { captureThumb, thumbKey } from '../lib/media'
import GameIcon from './GameIcon.vue'
const props = defineProps({ task: Object, output: Object })
const src = ref(''), failed = ref(false)
let live = true
onMounted(async () => {
  if (!props.output) return
  try {
    const blob = await getThumb(thumbKey(props.task, props.output)) || await captureThumb(props.task, props.output)
    if (blob && live) src.value = URL.createObjectURL(blob)
  } catch {}
})
onBeforeUnmount(() => { live = false; if (src.value) URL.revokeObjectURL(src.value) })
</script>
<template><div class="task-thumb"><img v-if="src && !failed" :src="src" alt="作品缩略图" @error="failed = true" /><img v-else-if="output?.kind === 'image' && !failed" :src="output.url" loading="lazy" alt="作品" @error="failed = true" /><div v-else class="thumb-placeholder"><GameIcon :name="output?.kind === 'video' ? 'play' : 'image'" :size="30" /><small>{{ output ? '预览待载入' : '暂无结果' }}</small></div><span v-if="output?.kind === 'video'" class="video-mark"><GameIcon name="play" :size="14" />视频</span></div></template>
