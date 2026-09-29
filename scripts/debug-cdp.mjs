const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
const page = pages.find(p => p.url.includes('index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
console.log(await ev(`(async()=>{
  document.getElementById('host').value='127.0.0.1';
  document.getElementById('port').value='2222';
  document.getElementById('username').value='test';
  document.getElementById('password').value='test123';
  document.getElementById('btnLogin').click();
  await new Promise(r=>setTimeout(r,5000));
  return JSON.stringify({
    conn: document.getElementById('connInfo').textContent,
    path: document.getElementById('pathInput').value,
    rows: document.querySelectorAll('#fileList .frow').length,
    ip: document.getElementById('ipList').textContent.slice(0,30)
  });
})()`));
ws.close();
process.exit(0);
