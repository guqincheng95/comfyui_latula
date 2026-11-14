import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
let connection
export function db() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const req = indexedDB.open('latula-v1', 1)
    req.onupgradeneeded = () => { for (const name of ['config', 'tasks', 'thumbs']) req.result.createObjectStore(name) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error('无法打开本地记录，请检查设备存储空间'))
  })
  return connection
}
export async function entry(store, mode, action) {
  const connection = await db()
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(store, mode)
    const request = action(transaction.objectStore(store))
    transaction.oncomplete = () => resolve(request?.result)
    transaction.onerror = () => reject(transaction.error || new Error('本地记录保存失败'))
    transaction.onabort = () => reject(transaction.error || new Error('本地记录保存失败'))
  })
}
export const loadTasks = () => entry('tasks', 'readonly', store => store.getAll())
export const saveTask = task => entry('tasks', 'readwrite', store => store.put(JSON.parse(JSON.stringify(task)), task.id))
export const removeTask = id => entry('tasks', 'readwrite', store => store.delete(id))
export const getThumb = id => entry('thumbs', 'readonly', store => store.get(id))
export const saveThumb = (id, blob) => entry('thumbs', 'readwrite', store => store.put(blob, id))
export const clearThumbs = () => entry('thumbs', 'readwrite', store => store.clear())
export async function loadConfig() {
  if (Capacitor.isNativePlatform()) {
    const item = await Preferences.get({ key: 'latula-config-v1' })
    if (item.value) return JSON.parse(item.value)
  }
  return (await entry('config', 'readonly', store => store.get('main'))) || {}
}
export async function saveConfig(config) {
  const serialized = JSON.stringify(config)
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: 'latula-config-v1', value: serialized })
  else await entry('config', 'readwrite', store => store.put(JSON.parse(serialized), 'main'))
}
