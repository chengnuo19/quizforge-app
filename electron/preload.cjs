const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectVault: () => ipcRenderer.invoke('dialog:selectVault'),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  readFileBuffer: (filePath) => ipcRenderer.invoke('fs:readFileBuffer', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  writeFileBuffer: (filePath, base64) => ipcRenderer.invoke('fs:writeFileBuffer', filePath, base64),
  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
  exists: (targetPath) => ipcRenderer.invoke('fs:exists', targetPath),
  copyBuiltin: (destPath) => ipcRenderer.invoke('fs:copyBuiltin', destPath),
  joinPath: (...paths) => ipcRenderer.invoke('path:join', ...paths),
  selectAndConvertDocumentToMarkdown: () => ipcRenderer.invoke('dialog:selectAndConvertDocument'),
  getScreenshotConfig: (customPath) => ipcRenderer.invoke('screenshot:getConfig', customPath),
  runScreenshotOrganizer: (payload) => ipcRenderer.invoke('screenshot:run', payload),
  stopScreenshotWatcher: () => ipcRenderer.invoke('screenshot:stopWatch'),
  setCurrentVault: (vaultPath) => ipcRenderer.invoke('reminders:setCurrentVault', vaultPath),
  getReminderStatus: () => ipcRenderer.invoke('reminders:getStatus'),
  saveReminderConfig: (config) => ipcRenderer.invoke('reminders:saveConfig', config),
  sendTestReminder: () => ipcRenderer.invoke('reminders:sendTest'),
  todosChanged: (todos) => ipcRenderer.invoke('reminders:todosChanged', todos),
  onTodosUpdated: (callback) => {
    const subscription = (event) => callback()
    ipcRenderer.on('todos-updated', subscription)
    return () => {
      ipcRenderer.removeListener('todos-updated', subscription)
    }
  }
})

contextBridge.exposeInMainWorld('markitdown', {
  selectAndConvertFile: () => ipcRenderer.invoke('markitdown:selectAndConvertFile'),
  saveMarkdownFile: (payload) => ipcRenderer.invoke('markitdown:saveMarkdownFile', payload),
  // Engine-aware conversion (MarkItDown | Docling) plus Docling's progress feed.
  selectAndConvertWithEngine: (payload) => ipcRenderer.invoke('document:selectAndConvert', payload),
  onConvertProgress: (callback) => {
    const subscription = (_event, line) => callback(line)
    ipcRenderer.on('document-convert-progress', subscription)
    return () => {
      ipcRenderer.removeListener('document-convert-progress', subscription)
    }
  },
})

contextBridge.exposeInMainWorld('ytdlp', {
  checkEnvironment: (options) => ipcRenderer.invoke('ytdlp:checkEnvironment', options),
  fetchVideoInfo: (url, options) => ipcRenderer.invoke('ytdlp:fetchVideoInfo', url, options),
  startDownload: (payload) => ipcRenderer.invoke('ytdlp:startDownload', payload),
  cancelDownload: () => ipcRenderer.invoke('ytdlp:cancelDownload'),
  extractSubtitles: (payload) => ipcRenderer.invoke('ytdlp:extractSubtitles', payload),
  selectDirectory: (title) => ipcRenderer.invoke('dialog:selectDirectory', title),
  openFolder: (dirPath) => ipcRenderer.invoke('shell:openFolder', dirPath),
  getConfig: () => ipcRenderer.invoke('ytdlp:getConfig'),
  saveConfig: (config) => ipcRenderer.invoke('ytdlp:saveConfig', config),
  updateBinary: (options) => ipcRenderer.invoke('ytdlp:updateBinary', options),
  onProgress: (callback) => {
    const subscription = (_event, data) => callback(data)
    ipcRenderer.on('ytdlp-progress', subscription)
    return () => {
      ipcRenderer.removeListener('ytdlp-progress', subscription)
    }
  },
  onLog: (callback) => {
    const subscription = (_event, line) => callback(line)
    ipcRenderer.on('ytdlp-log', subscription)
    return () => {
      ipcRenderer.removeListener('ytdlp-log', subscription)
    }
  },
})

contextBridge.exposeInMainWorld('videoSubtitle', {
  checkEnv: () => ipcRenderer.invoke('subtitle:checkEnv'),
  selectVideo: () => ipcRenderer.invoke('subtitle:selectVideo'),
  transcribe: (payload) => ipcRenderer.invoke('subtitle:transcribe', payload),
  saveProject: (videoPath, project) => ipcRenderer.invoke('subtitle:saveProject', videoPath, project),
  exportSrt: (payload) => ipcRenderer.invoke('subtitle:exportSrt', payload),
  burn: (payload) => ipcRenderer.invoke('subtitle:burn', payload),
  cancel: () => ipcRenderer.invoke('subtitle:cancel'),
  showItem: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  onProgress: (callback) => {
    const subscription = (_event, data) => callback(data)
    ipcRenderer.on('subtitle-progress', subscription)
    return () => {
      ipcRenderer.removeListener('subtitle-progress', subscription)
    }
  },
  onLog: (callback) => {
    const subscription = (_event, line) => callback(line)
    ipcRenderer.on('subtitle-log', subscription)
    return () => {
      ipcRenderer.removeListener('subtitle-log', subscription)
    }
  },
})

contextBridge.exposeInMainWorld('clipper', {
  getStatus: () => ipcRenderer.invoke('clipper:getStatus'),
  updateNotebooks: (notebooks) => ipcRenderer.invoke('clipper:updateNotebooks', notebooks),
  openExtensionDir: () => ipcRenderer.invoke('clipper:openExtensionDir'),
  onImportClip: (callback) => {
    const subscription = (_event, payload) => callback(payload)
    ipcRenderer.on('clipper:import-clip', subscription)
    return () => {
      ipcRenderer.removeListener('clipper:import-clip', subscription)
    }
  },
})

contextBridge.exposeInMainWorld('aiBridge', {
  status: (provider) => ipcRenderer.invoke('ai:status', provider),
  login: (provider) => ipcRenderer.invoke('ai:login', provider),
  logout: (provider) => ipcRenderer.invoke('ai:logout', provider),
  listModels: (provider) => ipcRenderer.invoke('ai:listModels', provider),
  complete: (provider, request) => ipcRenderer.invoke('ai:complete', provider, request),
})
