import { Capacitor, registerPlugin } from '@capacitor/core'
const vault = registerPlugin('LatulaCredentials')
let sessionKey = ''
export async function getRunningHubKey() {
  if (Capacitor.isNativePlatform()) return (await vault.get()).value || ''
  return sessionKey
}
export async function setRunningHubKey(value) {
  const key = String(value || '').trim()
  if (!key || /\s/.test(key) || key.length > 4096) throw new Error('请输入有效的 RunningHub API Key，不要包含空格或换行')
  if (Capacitor.isNativePlatform()) await vault.set({ value: key })
  else sessionKey = key // Browser preview never persists API credentials.
}
export async function clearRunningHubKey() {
  if (Capacitor.isNativePlatform()) await vault.clear()
  sessionKey = ''
}
