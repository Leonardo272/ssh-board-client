"""本地简易SSH服务器：用于客户端集成测试（shell/exec/sftp）"""
import os
import socket
import subprocess
import sys
import threading

import paramiko

HOST, PORT = '127.0.0.1', 2222
USER, PWD = 'test', 'test123'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sftp-root')


class SFTPHandle(paramiko.SFTPServerInterface):
    def _real(self, path):
        root = os.path.realpath(ROOT)
        real = os.path.realpath(os.path.join(root, path.lstrip('/').replace('\\', '/')))
        return real if real == root or real.startswith(root + os.sep) else root

    def list_folder(self, path):
        p = self._real(path)
        out = []
        for name in os.listdir(p):
            st = os.stat(os.path.join(p, name))
            a = paramiko.SFTPAttributes()
            a.st_mode = (0o040000 if os.path.isdir(os.path.join(p, name)) else 0o100000) | (st.st_mode & 0o777)
            a.st_size = st.st_size
            a.st_mtime = int(st.st_mtime)
            a.filename = name
            a.longname = name
            out.append(a)
        return out

    def stat(self, path):
        st = os.stat(self._real(path))
        a = paramiko.SFTPAttributes()
        a.st_mode = st.st_mode
        a.st_size = st.st_size
        a.st_mtime = int(st.st_mtime)
        return a

    def open(self, path, flags, attr):
        p = self._real(path)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return paramiko.SFTPHandle(os.open(p, flags))

    def remove(self, path):
        os.remove(self._real(path))

    def mkdir(self, path, attr):
        os.mkdir(self._real(path))

    def rmdir(self, path):
        os.rmdir(self._real(path))

    def chdir(self, path):
        self._real(path)


class Server(paramiko.ServerInterface):
    def __init__(self):
        self.event = threading.Event()

    def get_allowed_auths(self, username):
        return 'password'

    def check_auth_password(self, username, password):
        if (username, password) == (USER, PWD):
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED

    def check_channel_pty_request(self, *a):
        return True

    def check_channel_shell_request(self, channel):
        threading.Thread(target=self._shell, args=(channel,), daemon=True).start()
        return True

    def check_channel_exec_request(self, channel, command):
        threading.Thread(target=self._exec, args=(channel, command), daemon=True).start()
        return True

    def _shell(self, chan):
        proc = subprocess.Popen(['cmd.exe'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, shell=False)

        def pump():
            for b in iter(lambda: proc.stdout.read(1), b''):
                chan.send(b)
            chan.close()
        threading.Thread(target=pump, daemon=True).start()
        try:
            while True:
                data = chan.recv(4096)
                if not data:
                    break
                proc.stdin.write(data)
                proc.stdin.flush()
        except Exception:
            pass
        finally:
            proc.kill()

    def _exec(self, chan, command):
        try:
            cmd = command.decode('utf-8', 'ignore') if isinstance(command, bytes) else str(command)
            # 模拟Linux侧输出，用于同事任务提醒功能的链路验证
            if cmd.startswith('who;'):
                mock = (
                    'fmsh    pts/1        2026-09-27 09:00 (192.168.1.10)\n'
                    'myuser  pts/2        2026-09-27 09:05 (192.168.1.99)\n'
                    'SPLIT\n'
                    'USER             PID  %CPU %MEM ELAPSED     ARGS\n'
                    'fmsh            4960 200.0  1.2 05:32       python3 /home/fmsh/test_infer.py\n'
                    'myuser          5100   2.0  0.5 00:10       -bash\n'
                    'fmsh            4701   0.1  0.0 1-02:03:04  sshd: fmsh@pts/1\n'
                    'root               1   0.0  0.0 10:00:00    /sbin/init\n'
                    'root            4364   0.0  0.0 00:00       [kworker/2:0-events]\n'
                    'fmsh            4961 100.0  0.0 00:00       ps aux --sort=-%cpu\n'
                )
                chan.send(mock.encode('utf-8'))
                chan.send_exit_status(0)
                chan.close()
                return
            if cmd.startswith('printf'):
                chan.send(b'192.168.1.99 55555 22')
                chan.send_exit_status(0)
                chan.close()
                return
            r = subprocess.run(cmd, shell=True, capture_output=True, timeout=6)
            if r.stdout:
                chan.send(r.stdout)
            if r.stderr:
                chan.send_stderr(r.stderr)
        except Exception as e:
            chan.send_stderr(str(e).encode('utf-8', 'ignore'))
        finally:
            try:
                chan.send_exit_status(0)
            except Exception:
                pass
            chan.close()


def main():
    os.makedirs(os.path.join(ROOT, 'dirA'), exist_ok=True)
    with open(os.path.join(ROOT, 'hello.txt'), 'w', encoding='utf-8') as f:
        f.write('测试文件内容 test file\n')
    host_key = paramiko.RSAKey.generate(2048)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((HOST, PORT))
    sock.listen(5)
    print(f'SSH测试服务器 {HOST}:{PORT} user={USER} pwd={PWD}', flush=True)
    while True:
        client, addr = sock.accept()
        t = paramiko.Transport(client)
        t.add_server_key(host_key)
        t.set_subsystem_handler('sftp', paramiko.SFTPServer, SFTPHandle)
        try:
            t.start_server(server=Server())
        except Exception as e:
            print('server error:', e, file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
