const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_EVENTS = [
  'shell:data', 'shell:closed',
  'ssh:error', 'ssh:closed', 'ssh:client-info',
  'sftp:ready', 'monitor:data', 'monitor:fast'
];

contextBridge.exposeInMainWorld('bridge', {
  connect: (cfg) => ipcRenderer.invoke('ssh:connect', cfg),
  disconnect: () => ipcRenderer.invoke('ssh:disconnect'),
  shellWrite: (data) => ipcRenderer.send('shell:write', data),
  shellResize: (dims) => ipcRenderer.send('shell:resize', dims),
  sftpPwd: () => ipcRenderer.invoke('sftp:pwd'),
  sftpList: (p) => ipcRenderer.invoke('sftp:list', p),
  sftpDownload: (p) => ipcRenderer.invoke('sftp:download', p),
  sftpUpload: (dir) => ipcRenderer.invoke('sftp:upload', dir),
  sftpMkdir: (p) => ipcRenderer.invoke('sftp:mkdir', p),
  sftpTouch: (p) => ipcRenderer.invoke('sftp:touch', p),
  sftpDelete: (p) => ipcRenderer.invoke('sftp:delete', p),
  configList: () => ipcRenderer.invoke('config:list'),
  configFill: (id) => ipcRenderer.invoke('config:fill', id),
  configSave: (a) => ipcRenderer.invoke('config:save', a),
  configDelete: (id) => ipcRenderer.invoke('config:delete', id),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: (t) => ipcRenderer.send('clip:write', t),
  on: (ch, cb) => {
    if (ALLOWED_EVENTS.includes(ch)) {
      ipcRenderer.on(ch, (_e, data) => cb(data));
    }
  }
});
