import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'
import { Share } from '@capacitor/share'
import { saveThumb } from './storage'
export async function downloadOutput(output, onProgress = () => {}) {
  if (!/^https?:\/\//i.test(output.url)) throw new Error('不支持的文件地址')
  const filename = (output.filename || 'latula-result').replace(/[^a-zA-Z0-9._-]/g, '_')
  if (Capacitor.isNativePlatform()) {
    await Filesystem.mkdir({ path: 'latula', directory: Directory.Cache, recursive: true }).catch(() => {})
    const target = await Filesystem.getUri({ directory: Directory.Cache, path: 'latula/' + Date.now() + '-' + filename })
    const listener = await FileTransfer.addListener('progress', event => { if (event.contentLength > 0) onProgress(Math.round(event.bytes / event.contentLength * 100)) })
    try {
      await FileTransfer.downloadFile({ url: output.url, path: target.uri, progress: true })
      await Share.share({ title: '拉图 · 保存或分享作品', url: target.uri, dialogTitle: '选择保存位置或分享应用' })
    } finally { await listener.remove() }
    return
  }
  const response = await fetch(output.url)
  if (!response.ok) throw new Error('原文件暂不可用，HTTP ' + response.status)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
export function thumbKey(task, output) { return task.id + ':' + output.id }
export async function captureThumb(task, output) {
  if (output.kind === 'audio') return null
  return new Promise(resolve => {
    const media = document.createElement(output.kind === 'video' ? 'video' : 'img')
    let done = false
    const finish = result => { if (done) return; done = true; clearTimeout(timer); if (media.tagName === 'VIDEO') { media.pause(); media.removeAttribute('src'); media.load() } resolve(result) }
    const render = () => {
      try {
        const width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight
        if (!width || !height) return finish(null)
        const canvas = document.createElement('canvas')
        canvas.width = Math.min(400, width); canvas.height = Math.round(canvas.width * height / width)
        canvas.getContext('2d').drawImage(media, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(async blob => { if (blob) { try { await saveThumb(thumbKey(task, output), blob) } catch {} } finish(blob) }, 'image/jpeg', 0.78)
      } catch { finish(null) }
    }
    const timer = setTimeout(() => finish(null), 15000)
    media.crossOrigin = 'anonymous'
    media.onerror = () => finish(null)
    if (output.kind === 'video') {
      media.preload = 'metadata'; media.muted = true; media.playsInline = true
      media.onloadedmetadata = () => { media.currentTime = Math.min(0.05, (media.duration || 1) / 2) }
      media.onloadeddata = () => { if (!media.duration) render() }
      media.onseeked = render
    } else media.onload = render
    media.src = output.url
  })
}
export async function clearNativeCache() {
  if (Capacitor.isNativePlatform()) await Filesystem.rmdir({ directory: Directory.Cache, path: 'latula', recursive: true }).catch(() => {})
}
