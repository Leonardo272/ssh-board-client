// 验证连接失败路径：错误提示正常、应用不崩溃
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find(p => p.type === 'page' && p.url.includes('index.html'));
if (!page) { console.log('NO_PAGE'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const call = (method, params = {}) => new Promise(res => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result.result?.value;
};

await evalJs(`(function(){
  document.getElementById('host').value = '192.0.2.1';
  document.getElementById('port').value = '22';
  document.getElementById('username').value = 'root';
  document.getElementById('password').value = 'x';
  document.getElementById('btnLogin').click();
  return true;
})()`);
console.log('已提交登录，等待失败回显…');
for (let i = 0; i < 12; i++) {
  await sleep(2000);
  const state = await evalJs(`JSON.stringify({
    err: document.getElementById('connError').textContent,
    overlayHidden: document.getElementById('connectOverlay').classList.contains('hidden'),
    btn: document.getElementById('btnLogin').textContent
  })`);
  const s = JSON.parse(state);
  console.log(`${(i + 1) * 2}s ${state}`);
  if (s.err) { console.log('FAIL_PATH_OK'); ws.close(); process.exit(0); }
}
console.log('FAIL_PATH_TIMEOUT');
ws.close();
process.exit(1);
