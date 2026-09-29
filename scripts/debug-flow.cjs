// 最小复现主进程行为：printf exec → shell → sftp → 并行监控exec
const { Client } = require('F:/run_llm_skill/ssh-board-client/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  console.log('ready');
  c.exec('printf %s "$SSH_CLIENT"', (err, s) => {
    if (err) console.log('printf exec err', err.message);
    else s.on('close', () => console.log('printf closed')).on('data', d => console.log('SSH_CLIENT=', d.toString()));
  });
  c.shell({ term: 'xterm-256color' }, (err, sh) => {
    if (err) return console.log('shell err', err.message);
    console.log('shell ok');
    sh.on('data', d => process.stdout.write('[sh]' + d.toString().slice(0, 40)));
    setTimeout(() => c.sftp((err2, sftp) => {
      console.log('sftp cb err=', err2 ? err2.message : 'none');
      if (!err2) sftp.realpath('.', (e, p) => console.log('realpath:', e ? e.message : p));
    }), 300);
    setTimeout(() => {
      // 完整复刻主进程全部命令（含会触发cmd.exe行为的监控命令）
      const cmds = [
        "grep '^cpu' /proc/stat; echo SPLIT; sleep 1; grep '^cpu' /proc/stat; cat /proc/loadavg",
        "(ss -tnp state established 2>/dev/null || (netstat -antp 2>/dev/null | grep ESTABLISHED)) | head -n 40",
        'ps aux --sort=-%cpu | head -n 16',
        'free -b',
        'who; echo SPLIT; ps -eo user:16,pid,pcpu,pmem,etime:12,args --sort=-pcpu | head -n 200'
      ];
      Promise.all(cmds.map(x => new Promise(res => {
        c.exec(x, (err3, st) => {
          if (err3) { console.log('exec err', x, err3.message); return res(); }
          let o = '';
          st.on('data', d => o += d.toString());
          st.on('close', () => { console.log('exec done:', x, '->', o.trim()); res(); });
        });
      }))).then(() => { console.log('ALL EXEC DONE'); process.exit(0); });
    }, 600);
  });
});
c.on('error', e => console.log('conn err', e.message));
c.connect({ host: '127.0.0.1', port: 2222, username: 'test', password: 'test123' });
setTimeout(() => { console.log('TIMEOUT-EXIT（有步骤挂起）'); process.exit(1); }, 15000);
