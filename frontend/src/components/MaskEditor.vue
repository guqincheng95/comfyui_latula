<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import GameIcon from './GameIcon.vue'
const props = defineProps({ file: Object, mask: Object })
const emit = defineEmits(['save', 'close'])
const view = ref(null), radius = ref(24), erase = ref(false), error = ref(''), saving = ref(false)
let image, width = 0, height = 0, base, strokes = [], current = null, sourceUrl, maskUrl
const layer = document.createElement('canvas')
const overlay = document.createElement('canvas')
async function load(url) { const img = new Image(); img.src = url; await img.decode(); return img }
function redraw() {
  const canvas = view.value, ctx = canvas.getContext('2d'), paint = layer.getContext('2d', { willReadFrequently: true })
  paint.clearRect(0, 0, layer.width, layer.height)
  if (base) paint.drawImage(base, 0, 0, layer.width, layer.height)
  for (const stroke of [...strokes, ...(current ? [current] : [])]) {
    if (stroke.clear) { paint.clearRect(0, 0, layer.width, layer.height); continue }
    if (stroke.invert) {
      const data = paint.getImageData(0, 0, layer.width, layer.height)
      for (let i = 0; i < data.data.length; i += 4) { data.data[i] = 255; data.data[i + 1] = 255; data.data[i + 2] = 255; data.data[i + 3] = 255 - data.data[i + 3] }
      paint.putImageData(data, 0, 0); continue
    }
    paint.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
    paint.strokeStyle = '#fff'; paint.fillStyle = '#fff'; paint.lineWidth = stroke.size; paint.lineCap = 'round'; paint.lineJoin = 'round'
    paint.beginPath(); paint.moveTo(...stroke.points[0]); for (const point of stroke.points.slice(1)) paint.lineTo(...point); paint.stroke()
    for (const point of stroke.points.length === 1 ? stroke.points : []) { paint.beginPath(); paint.arc(...point, stroke.size / 2, 0, Math.PI * 2); paint.fill() }
    paint.globalCompositeOperation = 'source-over'
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  if (overlay.width !== layer.width || overlay.height !== layer.height) { overlay.width = layer.width; overlay.height = layer.height }
  const tint = overlay.getContext('2d'); tint.globalCompositeOperation = 'source-over'; tint.clearRect(0,0,overlay.width,overlay.height); tint.drawImage(layer, 0, 0); tint.globalCompositeOperation = 'source-in'; tint.fillStyle = 'rgba(238,75,85,.55)'; tint.fillRect(0, 0, overlay.width, overlay.height)
  ctx.drawImage(overlay, 0, 0)
}
function point(event) { const bounds = view.value.getBoundingClientRect(); return [(event.clientX - bounds.left) * layer.width / bounds.width, (event.clientY - bounds.top) * layer.height / bounds.height] }
function down(event) {
  if (!image || saving.value) return
  event.preventDefault(); try { view.value.setPointerCapture(event.pointerId) } catch { /* synthetic pointers or older WebViews */ }
  const bounds = view.value.getBoundingClientRect()
  current = { erase: erase.value, size: Number(radius.value) * layer.width / bounds.width, points: [point(event)] }; redraw()
}
function move(event) { if (!current) return; event.preventDefault(); current.points.push(point(event)); redraw() }
function up() { if (current) { strokes.push(current); current = null; redraw() } }
function action(kind) { up(); if (kind === 'undo') strokes.pop(); else strokes.push({ [kind]: true }); redraw() }
async function save() {
  saving.value = true
  try {
    up()
    const output = document.createElement('canvas'); output.width = width; output.height = height
    const ctx = output.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); ctx.drawImage(layer, 0, 0, width, height)
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('遮罩导出失败')
    emit('save', new File([blob], 'latula-mask-' + Date.now() + '.png', { type: 'image/png' }))
  } catch (e) { error.value = e.message } finally { saving.value = false }
}
onMounted(async () => {
  try {
    sourceUrl = URL.createObjectURL(props.file); image = await load(sourceUrl); width = image.naturalWidth; height = image.naturalHeight
    if (width * height > 24000000) throw new Error('遮罩编辑暂支持 2400 万像素以内图片，请先缩小图片')
    const scale = Math.min(1, 2048 / Math.max(width, height))
    view.value.width = layer.width = Math.max(1, Math.round(width * scale)); view.value.height = layer.height = Math.max(1, Math.round(height * scale))
    if (props.mask) {
      maskUrl = URL.createObjectURL(props.mask); const stored = await load(maskUrl)
      base = document.createElement('canvas'); base.width = layer.width; base.height = layer.height
      const ctx = base.getContext('2d', { willReadFrequently: true }); ctx.drawImage(stored, 0, 0, base.width, base.height)
      const pixels = ctx.getImageData(0, 0, base.width, base.height)
      for (let i = 0; i < pixels.data.length; i += 4) { const alpha = pixels.data[i]; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255; pixels.data[i + 3] = alpha }
      ctx.putImageData(pixels, 0, 0)
    }
    redraw()
  } catch (e) { error.value = e.message }
})
onBeforeUnmount(() => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (maskUrl) URL.revokeObjectURL(maskUrl) })
</script>
<template>
  <div class="modal-scrim mask-scrim"><section class="parchment mask-editor" role="dialog" aria-modal="true" aria-label="遮罩画板">
    <div class="section-heading"><div><h2>遮罩画板</h2><small>红色区域修改，其他区域保留。原图 RGB 不被涂改。</small></div><button class="icon-button" aria-label="关闭遮罩画板" :disabled="saving" @click="emit('close')"><GameIcon name="close" /></button></div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <canvas ref="view" aria-label="绘制遮罩" class="mask-canvas" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" />
    <div class="mask-tools"><button class="wood-button small" :class="{ selected: !erase }" @click="erase = false">画笔</button><button class="wood-button small" :class="{ selected: erase }" @click="erase = true">橡皮</button><button class="text-button" @click="action('undo')">撤销</button><button class="text-button" @click="action('invert')">反选</button><button class="text-button" @click="action('clear')">清空</button></div>
    <label class="brush-size">画笔大小<input aria-label="画笔大小" type="range" min="3" max="100" v-model="radius" /></label>
    <button class="gold-button wide" :disabled="!!error || saving" @click="save">{{ saving ? '正在保存…' : '保存遮罩' }}</button>
  </section></div>
</template>
