const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const MONITOR_INTERVAL_MS = 10000; // 监控刷新间隔
const EXEC_TIMEOUT_MS = 8000;      // 单条监控命令超时
const KEEPALIVE_MS = 15000;        // SSH心跳间隔
const MAX_OUTPUT = 200 * 1024;     // 单命令输出上限200KB

let win = null;
let conn = null;
let shellStream = null;
let sftp = null;
let monitorTimer = null;
let monitorBusy = false;
let lastLogin = null; // 保存最近一次登录参数供重连

/* ---------- 配置存储（密码DPAPI加密） ---------- */

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch (e) { return { accounts: [] }; }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

function encryptPassword(pwd) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(pwd).toString('base64');
  } catch (e) { return null; }
}

function decryptPassword(b64) {
  try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); }
  catch (e) { return ''; }
}

function accountList(cfg) {
  return (cfg.accounts || []).map(a => ({
    id: a.id, host: a.host, port: a.port, username: a.username, hasPass: !!a.encPass
  }));
}

/* ---------- 窗口 ---------- */

function send(ch, data) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'SSH Board Client',
    backgroundColor: '#141821',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

/* ---------- SSH命令执行（带超时与输出上限） ---------- */

function execCommand(cmd, timeoutMs = EXEC_TIMEOUT_MS) {
  return acquireExecSlot().then(() => new Promise((resolve, reject) => {
    if (!conn) return reject(new Error('SSH未连接'));
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errout = '', done = false;
      const finish = (fn, arg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(() => {
        try { stream.close(); } catch (e) {}
        finish(resolve, { out, errout, code: -1, timeout: true });
      }, timeoutMs);
      stream.on('data', d => {
        out += d.toString('utf8');
        if (out.length > MAX_OUTPUT) {
          try { stream.close(); } catch (e) {}
          finish(resolve, { out: out.slice(0, MAX_OUTPUT), errout, code: -1, truncated: true });
        }
      });
      stream.stderr.on('data', d => { errout += d.toString('utf8'); });
      stream.on('error', e => finish(reject, e));
      stream.on('close', code => finish(resolve, { out, errout, code }));
    });
  })).finally(releaseExecSlot);
}

/* ---------- exec并发限制（≤2），防止同时打开过多channel导致SSH流损坏 ---------- */

let execActive = 0;
const execQueue = [];
function pumpExecQueue() {
  while (execActive < 2 && execQueue.length) { execActive++; execQueue.shift()(); }
}
function acquireExecSlot() {
  return new Promise(r => { execQueue.push(r); pumpExecQueue(); });
}
function releaseExecSlot() { execActive--; pumpExecQueue(); }

/* ---------- 监控采集（busy互斥，绝不堆积） ---------- */

const CMDS = {
  // 四项合并为单条exec：减少channel数量与板上进程开销
  all: "echo <<<IPS>>>; (ss -tnp state established 2>/dev/null || (netstat -antp 2>/dev/null | grep ESTABLISHED)) | head -n 40; " +
       "echo <<<PROCS>>>; ps aux --sort=-%cpu | head -n 16; " +
       "echo <<<MEM>>>; free -b; " +
       "echo <<<SES>>>; who; " +
       "echo <<<SESPS>>>; ps -eo user:16,pid,pcpu,pmem,etime:12,args --sort=-pcpu | head -n 200; " +
       "echo <<<END>>>",
};

async function monitorTick() {
  monitorBusy = true;
  try {
    const r = await execCommand(CMDS.all);
    const sec = (n) => { const p = r.out.split(`<<<${n}>>>`); return p[1] || ''; };
    send('monitor:data', {
      ips: sec('IPS'), procs: sec('PROCS'), mem: sec('MEM'),
      sessions: sec('SES') + 'SPLIT' + sec('SESPS'),
      ts: Date.now()
    });
  } catch (e) {
    // 单次采集失败静默跳过，连接级错误由 error/close 事件处理
  } finally {
    monitorBusy = false;
  }
}

function startMonitor() {
  stopMonitor();
  monitorTick();
  monitorTimer = setInterval(monitorTick, MONITOR_INTERVAL_MS);
}

function stopMonitor() {
  if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
  monitorBusy = false;
}

/* ---------- 连接生命周期 ---------- */

function cleanupConnection() {
  stopMonitor();
  if (shellStream) { try { shellStream.close(); } catch (e) {} shellStream = null; }
  if (sftp) { try { sftp.end(); } catch (e) {} sftp = null; }
  if (conn) { const c = conn; conn = null; try { c.end(); } catch (e) {} }
}

function doConnect(cfg) {
  return new Promise((resolve) => {
    const host = String(cfg.host || '').trim();
    const port = parseInt(cfg.port, 10) || 22;
    const username = String(cfg.username || '').trim();
    const password = String(cfg.password || '');
    if (!host || !username || !password) return resolve({ ok: false, error: '请填写完整连接信息' });

    cleanupConnection();
    lastLogin = { host, port, username, password };

    const c = new Client();
    let settled = false;
    conn = c;

    c.on('ready', () => {
      // 获取本机出口IP（SSH_CLIENT），用于IP面板标注"本机"
      conn.exec('printf %s "$SSH_CLIENT"', (err, stream) => {
        if (err) return;
        let s = '';
        stream.on('data', d => { s += d.toString('utf8'); });
        stream.on('close', () => send('ssh:client-info', s.trim()));
      });
      c.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, sh) => {
        if (err) {
          cleanupConnection();
          if (!settled) { settled = true; resolve({ ok: false, error: '打开终端失败: ' + err.message }); }
          return;
        }
        shellStream = sh;
        sh.on('data', d => send('shell:data', d));
        sh.on('close', () => send('shell:closed', null));
        c.sftp((err, s) => {
          if (!err) { sftp = s; send('sftp:ready', null); }
        });
        startMonitor();
        if (!settled) { settled = true; resolve({ ok: true }); }
      });
    });

    c.on('error', (err) => {
      send('ssh:error', err.message);
      if (!settled) { settled = true; cleanupConnection(); resolve({ ok: false, error: err.message }); }
      else cleanupConnection();
    });

    c.on('close', () => {
      if (conn === c) { stopMonitor(); shellStream = null; sftp = null; conn = null; }
      send('ssh:closed', null);
    });

    c.connect({
      host, port, username, password,
      readyTimeout: 15000,
      keepaliveInterval: KEEPALIVE_MS,
      keepaliveCountMax: 3
    });
  });
}

/* ---------- IPC ---------- */

ipcMain.handle('ssh:connect', (_e, cfg) => doConnect(cfg || {}));

ipcMain.handle('ssh:disconnect', () => {
  lastLogin = null;
  cleanupConnection();
  return { ok: true };
});

ipcMain.on('shell:write', (_e, data) => {
  if (shellStream && data) {
    try { shellStream.write(Buffer.from(data)); } catch (e) {}
  }
});

ipcMain.on('shell:resize', (_e, dims) => {
  if (shellStream && dims && dims.cols > 0 && dims.rows > 0) {
    try { shellStream.setWindow(dims.rows, dims.cols, 0, 0); } catch (e) {}
  }
});

ipcMain.handle('sftp:pwd', async () => {
  if (!sftp) throw new Error('SFTP未就绪');
  return new Promise((res, rej) => sftp.realpath('.', (e, p) => e ? rej(e) : res(p)));
});

ipcMain.handle('sftp:list', async (_e, p) => {
  if (!sftp) throw new Error('SFTP未就绪');
  return new Promise((res, rej) => {
    sftp.readdir(p || '.', (err, list) => {
      if (err) return rej(err);
      const items = list.map(f => ({
        name: f.filename,
        size: f.attrs.size,
        mtime: (f.attrs.mtime || 0) * 1000,
        isDir: f.attrs.isDirectory(),
        mode: f.attrs.mode
      }));
      items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
      res(items);
    });
  });
});

ipcMain.handle('sftp:download', async (_e, remotePath) => {
  if (!sftp) throw new Error('SFTP未就绪');
  if (!win) return { ok: false, error: '窗口已关闭' };
  const name = remotePath.split('/').pop() || 'file';
  const r = await dialog.showSaveDialog(win, { defaultPath: name });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  return new Promise((res) => {
    sftp.fastGet(remotePath, r.filePath, (err) => {
      if (err) res({ ok: false, error: err.message });
      else res({ ok: true, local: r.filePath });
    });
  });
});

ipcMain.handle('sftp:upload', async (_e, remoteDir) => {
  if (!sftp) throw new Error('SFTP未就绪');
  if (!win) return { ok: false, error: '窗口已关闭' };
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const local = r.filePaths[0];
  const base = local.split(/[\\/]/).pop();
  const remote = (remoteDir || '.') + '/' + base;
  return new Promise((res) => {
    sftp.fastPut(local, remote, (err) => {
      if (err) res({ ok: false, error: err.message });
      else res({ ok: true, remote });
    });
  });
});

/* ---------- 文件管理：新建/删除 ---------- */

ipcMain.handle('sftp:mkdir', async (_e, p) => {
  if (!sftp) throw new Error('SFTP未就绪');
  return new Promise((res, rej) => sftp.mkdir(p, e => e ? rej(e) : res(true)));
});

ipcMain.handle('sftp:touch', async (_e, p) => {
  if (!sftp) throw new Error('SFTP未就绪');
  // open(path,'w')：存在则截断，不存在则创建空文件
  return new Promise((res, rej) => sftp.open(p, 'w', (e, h) => {
    if (e) return rej(e);
    sftp.close(h, () => res(true));
  }));
});

async function sftpRmTree(p) {
  const st = await new Promise((res, rej) => sftp.stat(p, (e, s) => e ? rej(e) : res(s)));
  if (st.isDirectory()) {
    const list = await new Promise((res, rej) => sftp.readdir(p, (e, l) => e ? rej(e) : res(l)));
    for (const item of list) await sftpRmTree(p + '/' + item.filename);
    await new Promise((res, rej) => sftp.rmdir(p, e => e ? rej(e) : res()));
  } else {
    await new Promise((res, rej) => sftp.unlink(p, e => e ? rej(e) : res()));
  }
}

ipcMain.handle('sftp:delete', async (_e, p) => {
  if (!sftp) throw new Error('SFTP未就绪');
  if (!p || p === '/' || p === '.') throw new Error('拒绝删除根目录');
  return sftpRmTree(p);
});

ipcMain.handle('config:list', async () => accountList(loadConfig()));

/* ---------- 剪贴板（主进程API，不受浏览器权限限制） ---------- */

ipcMain.handle('clip:read', () => require('electron').clipboard.readText());
ipcMain.on('clip:write', (_e, text) => { try { require('electron').clipboard.writeText(String(text || '')); } catch (e) {} });

ipcMain.handle('config:fill', async (_e, id) => {
  const a = (loadConfig().accounts || []).find(x => x.id === id);
  if (!a) return null;
  return { host: a.host, port: a.port, username: a.username, password: a.encPass ? decryptPassword(a.encPass) : '' };
});

ipcMain.handle('config:save', async (_e, arg) => {
  const cfg = loadConfig();
  cfg.accounts = cfg.accounts || [];
  const host = String(arg.host || '').trim();
  const port = parseInt(arg.port, 10) || 22;
  const username = String(arg.username || '').trim();
  const id = `${host}:${port}:${username}`;
  const item = { id, host, port, username };
  if (arg.password && arg.savePass) {
    const enc = encryptPassword(String(arg.password));
    if (enc) item.encPass = enc; // 加密失败则不落盘密码
  }
  const i = cfg.accounts.findIndex(x => x.id === id);
  if (i >= 0) cfg.accounts[i] = Object.assign({}, cfg.accounts[i], item);
  else cfg.accounts.push(item);
  const saved = saveConfig(cfg);
  return { ok: saved, accounts: accountList(cfg), encAvailable: safeStorage.isEncryptionAvailable() };
});

ipcMain.handle('config:delete', async (_e, id) => {
  const cfg = loadConfig();
  cfg.accounts = (cfg.accounts || []).filter(x => x.id !== id);
  saveConfig(cfg);
  return accountList(cfg);
});

/* ---------- 应用生命周期 ---------- */

// 测试模式：独立userData目录，避免与用户正在运行的实例发生单实例锁冲突
if (process.env.SBC_TEST_USER_DATA) {
  try { app.setPath('userData', process.env.SBC_TEST_USER_DATA); } catch (e) {}
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.disableHardwareAcceleration(); // 规避部分显卡驱动导致的渲染崩溃

  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { cleanupConnection(); app.quit(); });
  app.on('before-quit', () => cleanupConnection());
  app.on('quit', () => cleanupConnection());
}
