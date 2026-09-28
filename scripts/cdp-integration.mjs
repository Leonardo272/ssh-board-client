// 本地SSH服务器集成测试：连接→SFTP→监控面板→断线
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pages;
for (let i = 0; i < 10; i++) {
  try { pages = await (await fetch('http://127.0.0.1:9222/json')).json(); break; }
  catch (e) { if (i === 9) throw e; await sleep(2000); }
}
const page = pages.find(p => p.type === 'page' && p.url.includes('index.html'));
if (!page) { console.log('NO_PAGE'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
const call = (method, params = {}) => new Promise(res => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) {
    console.log('EVAL异常:', JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  }
  return r.result.result?.value;
};
await call('Runtime.enable');

console.log('登录本地测试服务器…');
await evalJs(`(function(){
  document.getElementById('host').value = '127.0.0.1';
  document.getElementById('port').value = '2222';
  document.getElementById('username').value = 'test';
  document.getElementById('password').value = 'test123';
  document.getElementById('btnLogin').click();
  return true;
})()`);

let ok = false;
for (let i = 0; i < 10; i++) {
  await sleep(1000);
  const state = await evalJs(`JSON.stringify({
    connected: !document.getElementById('connectOverlay').classList.contains('hidden') === false,
    connInfo: document.getElementById('connInfo').textContent,
    pathInput: document.getElementById('pathInput').value,
    fileRows: document.querySelectorAll('#fileList .frow').length,
    nameColWidth: Math.round((document.querySelector('#fileList .frow:not(.head) .name') || {}).getBoundingClientRect?.()?.width || 0),
    mem: (document.getElementById('memBody') || {}).textContent?.slice(0, 60) || '',
    cpu: (document.getElementById('tab-cpu') || {}).textContent?.slice(0, 60) || '',
    npu: (document.getElementById('tab-npu') || {}).textContent?.slice(0, 80) || ''
  })`);
  console.log(`${i + 1}s ${state}`);
  const s = JSON.parse(state);
  if (s.fileRows > 1) { ok = true; break; }
}
await sleep(12000); // 等一轮监控tick
const finalState = await evalJs(`JSON.stringify({
  ipList: document.getElementById('ipList').textContent.slice(0, 80),
  procBadge: document.getElementById('procBadge').textContent,
  alert: document.querySelector('#procList .alert')?.textContent || '',
  alertRow: document.querySelector('#procList .alertrow')?.textContent || '',
  svcRow: [...document.querySelectorAll('#procList .alertrow')].map(r => r.textContent).find(t => t.includes('9981')) || '',
  psSelfFiltered: ![...document.querySelectorAll('#procList .trow')].some(r => r.textContent.includes('--sort=-%cpu')),
  falseAlarm: [...document.querySelectorAll('#procList .alertrow')].some(r => r.textContent.includes('avahi') || r.textContent.includes('cups')),
  mem: (document.getElementById('memBody') || {}).textContent?.slice(0, 60) || '',
  cpu: (document.getElementById('tab-cpu') || {}).textContent?.slice(0, 60) || '',
  npu: (document.getElementById('tab-npu') || {}).textContent?.slice(0, 80) || ''
})`);
console.log('监控面板:', finalState);
console.log('JS异常:', exceptions.length ? exceptions.join(' || ') : '无');
console.log(ok ? 'INTEGRATION_OK' : 'INTEGRATION_FAIL');
ws.close();
process.exit(ok ? 0 : 1);
