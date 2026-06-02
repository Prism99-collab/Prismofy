const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prismofy', {
  // invoke (request/response)
  fetchInfo: (urls, cookies) => ipcRenderer.invoke('fetch-info', urls, cookies),
  startDownload: (opts) => ipcRenderer.invoke('start-download', opts),
  stopDownload: () => ipcRenderer.invoke('stop-download'),
  chooseFolder: (current) => ipcRenderer.invoke('choose-folder', current),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  defaultDownloadFolder: () => ipcRenderer.invoke('default-download-folder'),

  // fire-and-forget
  quit: () => ipcRenderer.send('quit-app'),
  hide: () => ipcRenderer.send('hide-panel'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setHeight: (h) => ipcRenderer.send('set-height', h),
  uiConfig: (cfg) => ipcRenderer.send('ui-config', cfg),

  // events (main -> renderer)
  onSetupState: (cb) => ipcRenderer.on('setup-state', (_e, p) => cb(p)),
  onFfmpegAvailable: (cb) => ipcRenderer.on('ffmpeg-available', (_e, p) => cb(p)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, p) => cb(p)),
  onDownloadError: (cb) => ipcRenderer.on('download-error', (_e, p) => cb(p)),
});
