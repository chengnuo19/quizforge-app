function getApi() {
  if (typeof window === 'undefined') return null
  return window.videoSubtitle || null
}

function requireApi() {
  const api = getApi()
  if (!api) throw new Error('仅在桌面版可用。')
  return api
}

export function canUseVideoSubtitle() {
  const api = getApi()
  return !!api && typeof api.transcribe === 'function' && typeof api.burn === 'function'
}

export async function checkSubtitleEnv() {
  return await requireApi().checkEnv()
}

export async function selectVideo() {
  return await requireApi().selectVideo()
}

export async function transcribeVideo(payload) {
  return await requireApi().transcribe(payload)
}

export async function saveSubtitleProject(videoPath, project) {
  return await requireApi().saveProject(videoPath, project)
}

export async function exportSrtFile(payload) {
  return await requireApi().exportSrt(payload)
}

export async function burnVideo(payload) {
  return await requireApi().burn(payload)
}

export async function cancelSubtitleJob() {
  const api = getApi()
  if (!api) return false
  return await api.cancel()
}

export async function showInFolder(filePath) {
  const api = getApi()
  if (!api) return false
  return await api.showItem(filePath)
}

export function onSubtitleProgress(callback) {
  const api = getApi()
  if (!api || typeof api.onProgress !== 'function') return () => {}
  return api.onProgress(callback)
}

export function onSubtitleLog(callback) {
  const api = getApi()
  if (!api || typeof api.onLog !== 'function') return () => {}
  return api.onLog(callback)
}
