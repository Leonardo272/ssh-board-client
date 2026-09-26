# 开发板SSH监控客户端

## 交付产物
- `dist/SSH Board Client 1.0.0.exe`：免安装单文件版，双击直接用
- `dist/SSH Board Client Setup 1.0.0.exe`：NSIS 安装包（备选）

目标机器无需 Node/Python 等任何环境。

## 功能
 登录面板：IP / 端口 / 用户名 / 密码，可勾选保存账户（密码经 Windows DPAPI 加密后存本机 `%APPDATA%\ssh-board-client\config.json`，仅当前 Windows 用户可解密）
- 左侧：SFTP 文件浏览、上传、下载（双击目录进入，双击文件下载）
- 中间：xterm 256 色终端，自适应窗口
- 右侧（10s 刷新）：已连接 IP（自己的连接标注“本机”）、Top16 CPU 进程、内存/Swap 用量

## 稳定性设计
- 监控命令 8s 超时强杀 + busy 互斥，上一轮未完成则跳过本轮，绝不堆积
- 单命令输出上限 200KB；终端回滚 2000 行，防止内存膨胀
- SSH keepalive 15s×3 判定断线，断线后弹遮罩手动重连，不自动冲击板子
- 单实例运行，重连前销毁全部旧连接句柄

## 开发
```bash
npm install
npm start        # 开发运行
npm run dist     # 重新打包 exe
```

首次安装 electron 二进制慢时，参考 `scripts/setup-electron.ps1`。

## 测试脚本
- `scripts/smoke-full.ps1`：启动 + 页面加载 + 连接失败路径验证
- `scripts/smoke-portable.ps1`：打包后 exe 冒烟验证
