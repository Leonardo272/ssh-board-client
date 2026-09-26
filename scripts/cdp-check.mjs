// 通过CDP检查渲染页面是否正常加载
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
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
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  }
};
const call = (method, params = {}) => new Promise(res => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const expr = `JSON.stringify({
  readyState: document.readyState,
  hasTerminal: typeof Terminal !== 'undefined',
  hasBridge: !!window.bridge,
  hasXtermDom: !!document.querySelector('.xterm'),
  termWrapHtml: document.getElementById('termWrap').innerHTML.slice(0, 160),
  formVisible: !document.getElementById('connectOverlay').classList.contains('hidden'),
  error: window.__err || ''
})`;
await call('Runtime.enable');
const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(r.result.result.value);
await sleep(500);
if (exceptions.length) console.log('EXCEPTIONS: ' + exceptions.join(' | '));
ws.close();
process.exit(0);
