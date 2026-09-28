/* global Terminal, FitAddon */
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.bridge; // 注意：contextBridge属性不可配置，不能再用const bridge同名声明

/* ---------- 状态 ---------- */

let term = null;
let fit = null;
let connected = false;
let currentPath = '';
let myClientIp = '';
let lastOfflineReason = '';
const decoder = new TextDecoder('utf-8');

/* ---------- 工具 ---------- */

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + 'B';
  const u = ['K', 'M', 'G', 'T'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n >= 100 ? 0 : 1) + u[i];
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function posixJoin(dir, name) {
  if (dir === '/' ) return '/' + name;
  return (dir || '.') + '/' + name;
}

function posixParent(p) {
  if (!p || p === '/') return '';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 终端 ---------- */

function initTerminal() {
  term = new Terminal({
    scrollback: 2000, // 限制回滚行数防内存膨胀
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: { background: '#0f131c', foreground: '#d7dde8', cursor: '#7ea6e8' }
  });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('terminal'));
  fit.fit();
  term.onData(d => api.shellWrite(new TextEncoder().encode(d)));

  const onResize = () => {
    if (!term || !connected) return;
    try {
      fit.fit();
      api.shellResize({ cols: term.cols, rows: term.rows });
    } catch (e) {}
  };
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe($('termWrap'));
}

/* ---------- 账户管理 ---------- */

async function refreshAccounts(selectId) {
  const list = await api.configList();
  const sel = $('savedSelect');
  sel.innerHTML = '<option value="">— 选择已保存账户 —</option>';
  for (const a of list) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${a.username}@${a.host}:${a.port}${a.hasPass ? ' 🔒' : ''}`;
    sel.appendChild(o);
  }
  if (selectId) sel.value = selectId;
}

$('savedSelect').addEventListener('change', async () => {
  const id = $('savedSelect').value;
  if (!id) return;
  const info = await api.configFill(id);
  if (info) {
    $('host').value = info.host;
    $('port').value = info.port;
    $('username').value = info.username;
    $('password').value = info.password || '';
    $('savePass').checked = !!info.password;
  }
});

$('btnDelete').addEventListener('click', async () => {
  const id = $('savedSelect').value;
  if (!id) return toast('请先选择要删除的账户', true);
  await api.configDelete(id);
  await refreshAccounts();
  toast('已删除');
});

/* ---------- 连接 ---------- */

async function doLogin() {
  const cfg = {
    host: $('host').value.trim(),
    port: parseInt($('port').value, 10) || 22,
    username: $('username').value.trim(),
    password: $('password').value
  };
  if (!cfg.host || !cfg.username || !cfg.password) {
    $('connError').textContent = '请填写完整连接信息';
    return;
  }
  $('btnLogin').disabled = true;
  $('btnLogin').textContent = '连接中…';
  $('connError').textContent = '';
  const r = await api.connect(cfg);
  $('btnLogin').disabled = false;
  $('btnLogin').textContent = '登录';
  if (!r.ok) {
    $('connError').textContent = r.error || '连接失败';
    return;
  }
  if ($('savePass').checked) {
    const s = await api.configSave({ ...cfg, savePass: true });
    if (s.ok) {
      await refreshAccounts(`${cfg.host}:${cfg.port}:${cfg.username}`);
      if (!s.encAvailable) toast('本机不支持密码加密，仅保存了账号信息', true);
    }
  }
  onConnected(cfg);
}

function onConnected(cfg) {
  connected = true;
  $('connectOverlay').classList.add('hidden');
  $('offlineOverlay').classList.add('hidden');
  $('connInfo').textContent = `已连接 ${cfg.username}@${cfg.host}:${cfg.port}　监控刷新10s`;
  if (term) { term.reset(); term.focus(); }
}

function onDisconnected(reason) {
  if (!connected) return;
  connected = false;
  if (reason) lastOfflineReason = reason;
  $('offlineReason').textContent = lastOfflineReason || '网络中断或开发板重启';
  $('offlineOverlay').classList.remove('hidden');
}

$('connectForm').addEventListener('submit', (e) => { e.preventDefault(); doLogin(); });
$('btnDisconnect').addEventListener('click', async () => {
  await api.disconnect();
  connected = false;
  $('offlineOverlay').classList.add('hidden');
  $('connectOverlay').classList.remove('hidden');
  $('connInfo').textContent = '';
});
$('btnReconnect').addEventListener('click', () => {
  $('offlineOverlay').classList.add('hidden');
  $('connectOverlay').classList.remove('hidden');
});

/* ---------- 主进程事件 ---------- */

api.on('shell:data', (chunk) => {
  if (term) term.write(decoder.decode(chunk, { stream: true })); // 流式解码防中文截断
});
api.on('shell:closed', () => onDisconnected('远端终端已关闭'));
api.on('ssh:error', (msg) => { lastOfflineReason = msg; onDisconnected(msg); });
api.on('ssh:closed', () => onDisconnected());
api.on('ssh:client-info', (info) => { myClientIp = (info || '').split(/\s+/)[0] || ''; });
api.on('sftp:ready', async () => {
  try {
    currentPath = await api.sftpPwd();
    await loadDir(currentPath);
  } catch (e) { toast('SFTP初始化失败: ' + e.message, true); }
});
api.on('monitor:data', renderMonitor);

/* ---------- 文件面板 ---------- */

async function loadDir(p) {
  try {
    const items = await api.sftpList(p);
    currentPath = p;
    $('pathInput').value = p;
    const rows = ['<div class="frow head"><span class="name">名称</span><span class="num">大小</span><span class="num">修改时间</span></div>'];
    for (const f of items) {
      const perm = (f.isDir ? 'd' : '-') + (f.mode || 0).toString(8).slice(-3);
      rows.push(
        `<div class="frow${f.isDir ? ' dir' : ''}" data-name="${esc(f.name)}" data-dir="${f.isDir ? 1 : 0}" title="${esc(f.name)} | 权限 ${perm} | ${fmtTime(f.mtime)}">` +
        `<span class="name">${f.isDir ? '📁 ' : '📄 '}${esc(f.name)}</span>` +
        `<span class="num">${f.isDir ? '-' : fmtSize(f.size)}</span>` +
        `<span class="num">${fmtTime(f.mtime)}</span></div>`
      );
    }
    $('fileList').innerHTML = rows.join('');
  } catch (e) {
    const msg = String(e.message || e);
    if (/permission|denied|failure/i.test(msg)) {
      // /root等目录受Linux权限保护（通常仅root账号可读）
      toast(`无权限访问 ${p}：受Linux权限保护，请用root账号登录或联系板子管理员`, true);
    } else {
      toast('读取目录失败: ' + msg, true);
    }
  }
}

$('fileList').addEventListener('dblclick', async (e) => {
  const row = e.target.closest('.frow');
  if (!row || row.classList.contains('head')) return;
  const name = row.dataset.name;
  if (row.dataset.dir === '1') {
    await loadDir(posixJoin(currentPath, name));
  } else {
    const r = await api.sftpDownload(posixJoin(currentPath, name));
    if (r.ok) toast('已下载: ' + r.local);
    else if (!r.canceled) toast('下载失败: ' + (r.error || '未知错误'), true);
  }
});

$('btnUp').addEventListener('click', () => { const p = posixParent(currentPath); if (p) loadDir(p); });
$('btnRefresh').addEventListener('click', () => { if (currentPath) loadDir(currentPath); });
$('btnGo').addEventListener('click', () => { const p = $('pathInput').value.trim(); if (p) loadDir(p); });
$('pathInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnGo').click(); });
$('btnUpload').addEventListener('click', async () => {
  if (!currentPath) return toast('SFTP未就绪', true);
  const r = await api.sftpUpload(currentPath);
  if (r.ok) { toast('已上传: ' + r.remote); await loadDir(currentPath); }
  else if (!r.canceled) toast('上传失败: ' + (r.error || '未知错误'), true);
});

/* ---------- 监控渲染 ---------- */

function parseIpLines(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s || /^(State|Recv-Q|Active|Proto)/i.test(s)) continue;
    // 提取 ip:port（IPv4或[IPv6]:port）
    const pairs = [...s.matchAll(/(\[?[0-9a-fA-F:.]+\]?):(\d+)/g)].map(m => m[0]);
    if (pairs.length < 2) continue;
    const local = pairs[pairs.length - 2];
    const peer = pairs[pairs.length - 1];
    let proc = '';
    const m = s.match(/users:\(\("([^",]+)",pid=(\d+)/);
    if (m) proc = `${m[1]}(${m[2]})`;
    else {
      const n = s.match(/\s\d+\/([^\s]+)\s*$/);
      if (n) proc = n[1];
    }
    const peerIp = peer.replace(/^\[|\]?:\d+$/g, '');
    // 过滤板内回环自连（127.x / ::1），只显示外部连接，避免干扰"查同事"
    if (peerIp.startsWith('127.') || peerIp === '::1') continue;
    rows.push({ local, peer, proc, mine: peerIp === myClientIp });
  }
  return rows;
}

function parseProcs(text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  for (let i = 1; i < lines.length; i++) { // 跳过表头
    const p = lines[i].trim().split(/\s+/);
    if (p.length < 11) continue;
    rows.push({
      user: p[0], pid: p[1], cpu: p[2], mem: p[3],
      cmd: p.slice(10).join(' ')
    });
  }
  return rows;
}

/* ---------- 同事任务识别 ---------- */

const SYS_USERS = new Set(['root','daemon','avahi','avahi-autoipd','dbus','messagebus','message+','polkitd','polkitd+',
  'systemd','systemd-network','systemd-resolve','systemd-journald','systemd-timesync','systemd-udevd',
  'nobody','uuidd','chrony','ntp','sshd','udev','rpc','rpcuser','statd','fwupd','sync','mail','news',
  'proxy','backup','list','gnats','irc','syslog','dnsmasq','tss','sssd','ntpsec','Debian-exim',
  'cups','cups-browsed','lp','lpadmin','geoclue','rtkit','colord','pulse','gdm','lightdm',
  'udisks','upower','saned','nmbd','smbd','rpcbind','at','atd','cron','crond','Debian-gdm']);

const MONITOR_SELF = /ps aux --sort|ps -eo user|--sort=-%cpu|grep ESTABLISHED/;

// root用户态系统进程（无路径前缀的守护进程）
const ROOT_SYS_CMD = /^(systemd|\/sbin\/init|\(sd-pam\)|udev|systemd-[a-z]+d|dhclient|wpa_supplicant|agetty|login|cron|atd|dbus-daemon|rsyslogd|udevd|sshd: |avahi-daemon|cups-browsed|cupsd|nmbd|smbd|rpcbind)/;

function isSystemProc(user, cmd) {
  if (cmd.startsWith('[')) return true; // 内核线程 kworker/rcu等
  if (MONITOR_SELF.test(cmd)) return true; // 监控命令自身，防误报
  if (/^sshd: /.test(cmd)) return false; // 会话进程单独归类
  if (user !== 'root' && SYS_USERS.has(user)) return true; // 非root系统账号一律视为系统进程
  if (user === 'root') {
    if (ROOT_SYS_CMD.test(cmd)) return true;
    if (/^(\/sbin|\/usr\/sbin|\/usr\/lib|\/lib|\/run)/.test(cmd)) return true;
  }
  return false;
}

function isTaskProc(user, cmd) {
  if (isSystemProc(user, cmd)) return false;
  if (/^sshd: /.test(cmd)) return false;
  if (/^-?(ba|z|da|a)?sh$/.test(cmd.trim())) return false; // 交互shell不算任务
  return true;
}

function parseSessions(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(l => l && l !== 'SPLIT').map(l => {
    const m = l.match(/^(\S+)\s+(\S+)\s+(.+?)\s+\(([^)]+)\)$/);
    if (m) return { user: m[1], tty: m[2], time: m[3], ip: m[4] };
    const m2 = l.match(/^(\S+)\s+(\S+)\s+(.+)$/);
    return m2 ? { user: m2[1], tty: m2[2], time: m2[3], ip: '' } : null;
  }).filter(Boolean);
}

function parseTasks(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  for (let i = 1; i < lines.length; i++) { // 跳过表头
    const m = lines[i].trim().match(/^(\S+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (m) out.push({ user: m[1], pid: m[2], cpu: m[3], mem: m[4], etime: m[5], cmd: m[6].trim() });
  }
  return out;
}

function renderColleagueAlert(sessionsText, tasksText, ipRows) {
  const myUser = $('username').value.trim();
  const sessions = parseSessions(sessionsText);
  const tasks = parseTasks(tasksText).filter(t => isTaskProc(t.user, t.cmd));
  // 同事在线 = 其他IP的SSH会话，或其他账号的登录
  const others = sessions.filter(s => (s.ip && s.ip !== myClientIp) || (!s.ip && s.user !== myUser) || (s.ip === myClientIp && s.user !== myUser));
  // 同事任务 = 非我账号的活跃任务进程
  const otherTasks = tasks.filter(t => t.user !== myUser);
  // 外部服务连接：非SSH(22)端口被外部IP使用（如icraft-server:9981），说明同事在用板子
  const svcConns = (ipRows || []).filter(r => !r.local.endsWith(':22') && !r.mine);
  const uniqSvc = [...new Set(svcConns.map(s =>
    `${s.proc || '未知服务'}(:${s.local.split(':').pop()}) ← ${s.peer.split(':')[0]}`))];

  let cls = 'ok', badge = '● 空闲', html = '';
  if (otherTasks.length || uniqSvc.length) {
    cls = 'busy'; badge = '● 同事使用中';
    html = `<div class="alert busy">⚠️ 检测到其他用户活动（任务${otherTasks.length}个/服务连接${uniqSvc.length}个）：</div>` +
      otherTasks.slice(0, 6).map(t =>
        `<div class="alertrow" title="${esc(t.cmd)}"><span class="u">${esc(t.user)}</span> PID ${esc(t.pid)} | CPU ${esc(t.cpu)}% | 已运行 ${esc(t.etime)} | ${esc(t.cmd.length > 46 ? t.cmd.slice(0, 46) + '…' : t.cmd)}</div>`
      ).join('');
    if (otherTasks.length > 6) html += `<div class="alertrow">…等共 ${otherTasks.length} 个任务</div>`;
    html += uniqSvc.slice(0, 4).map(s => `<div class="alertrow"><span class="u">服务</span> ${esc(s)}</div>`).join('');
  } else if (others.length) {
    cls = 'warn'; badge = '● 同事在线';
    const uniq = [...new Set(others.map(s => `${s.user}${s.ip ? '(' + s.ip + ')' : '(本地)'}`))];
    html = `<div class="alert warn">🟡 ${uniq.length} 个其他用户在线（未见任务）：${esc(uniq.join('、'))}</div>`;
  } else {
    html = `<div class="alert ok">✅ 无其他用户任务，板子空闲</div>`;
  }
  $('procBadge').textContent = badge;
  $('procBadge').className = 'tag ' + cls;
  return html;
}

function parseMem(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (!p.length) continue;
    if (p[0] === 'Mem:' && p.length >= 3) {
      out.total = +p[1]; out.used = +p[2];
      out.available = p.length >= 7 ? +p[6] : null;
    } else if (p[0] === 'Swap:' && p.length >= 3) {
      out.swapTotal = +p[1]; out.swapUsed = +p[2];
    }
  }
  return out;
}

function memBar(used, total, warn, crit) {
  const pct = total > 0 ? Math.min(100, used / total * 100) : 0;
  const cls = pct >= crit ? 'crit' : (pct >= warn ? 'warn' : '');
  return `<div class="bar ${cls}"><div style="width:${pct.toFixed(1)}%"></div></div>`;
}

function renderMonitor(d) {
  // 已连接IP
  const ips = parseIpLines(d.ips);
  const ipHtml = ips.length ? [
    '<div class="trow head"><span>对方IP:端口 → 板子端口</span><span style="text-align:right">进程</span></div>',
    ...ips.map(x =>
      `<div class="trow" title="对方 ${esc(x.peer)} → 本地 ${esc(x.local)}">` +
      `<span class="ellipsis${x.mine ? ' me' : ''}">${esc(x.peer)} → :${esc(x.local.split(':').pop())}${x.mine ? '（本机）' : ''}</span>` +
      `<span class="ellipsis" style="text-align:right;color:#8b97ad">${esc(x.proc)}</span></div>`
    )
  ].join('') : '<div class="empty">无已建立的连接</div>';
  $('ipList').innerHTML = ipHtml;
  const t = new Date(d.ts);
  $('ipTime').textContent = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;

  // 进程
  const sesParts = String(d.sessions || '').split('SPLIT');
  const alertHtml = renderColleagueAlert(sesParts[0] || '', sesParts[1] || '', ips);
  const procs = parseProcs(d.procs).filter(p => !MONITOR_SELF.test(p.cmd)); // 过滤监控命令自身
  const myRow = (u) => (u === $('username').value.trim() ? ' class="ellipsis procme"' : ' class="ellipsis"');
  $('procList').innerHTML = [
    alertHtml,
    '<div class="trow head"><span>用户</span><span>PID</span><span style="text-align:right">CPU%</span><span style="text-align:right">MEM%</span><span>命令</span></div>',
    ...procs.map(x =>
      `<div class="trow" title="${esc(x.cmd)}">` +
      `<span${myRow(x.user)}>${esc(x.user)}</span>` +
      `<span class="ellipsis">${esc(x.pid)}</span>` +
      `<span class="ellipsis" style="text-align:right">${esc(x.cpu)}</span>` +
      `<span class="ellipsis" style="text-align:right">${esc(x.mem)}</span>` +
      `<span class="ellipsis">${esc(x.cmd.length > 42 ? x.cmd.slice(0, 42) + '…' : x.cmd)}</span></div>`
    )
  ].join('');

  // 内存
  const m = parseMem(d.mem);
  if (m.total) {
    const avail = m.available != null ? m.available : (m.total - m.used);
    $('memBody').innerHTML = `
      <div class="memrow">
        <div class="lab"><span>物理内存</span><span>${fmtSize(m.used)} / ${fmtSize(m.total)}（可用 ${fmtSize(avail)}）</span></div>
        ${memBar(m.used, m.total, 70, 90)}
      </div>
      ${m.swapTotal ? `
      <div class="memrow">
        <div class="lab"><span>Swap</span><span>${fmtSize(m.swapUsed)} / ${fmtSize(m.swapTotal)}</span></div>
        ${memBar(m.swapUsed, m.swapTotal, 50, 80)}
      </div>` : ''}`;
  }
}

/* ---------- 启动 ---------- */

initTerminal();
refreshAccounts();
term.focus();
