# LOA METER CN

LOA METER CN 是一个面向国服《命运方舟》的桌面战斗统计界面。本仓库是公开版，主要包含 Electron + Vue 前端、悬浮窗、历史记录、图标资源和本地 UI 状态管理。

> 公开仓库不包含核心抓包、协议解析、解密、材料捕获、opcode 映射、逆向文档和运行日志。完整实时解析后端由维护者在私有仓库中构建，并以发布包二进制形式分发。

## 功能

- 实时 DPS / 总伤害 / 秒伤展示。
- 游戏内悬浮窗，支持锁定、穿透、透明度和紧凑模式。
- 玩家、技能、BUFF、DEBUFF、护盾等统计视图。
- 瘫痪、部位破坏、盾伤等扩展字段展示，前提是后端提供对应数据。
- 本地战斗历史、SQLite 存储和历史投影到悬浮窗。
- 外部后端调试模式。

## 目录

```text
.
├── electron-app/              # Electron + Vue UI
│   ├── src/main/              # Electron 主进程、窗口、IPC、历史库
│   ├── src/preload/           # preload bridge
│   └── src/renderer/          # Vue UI、悬浮窗、图标资源
├── docs/                      # 公开说明
├── README.md
└── .gitignore
```

## 不包含

以下内容不会进入公开仓库：

- 核心抓包 worker。
- 协议解析、解密、材料/seed 处理代码。
- opcode map、IDA 记录、逆向笔记。
- 游戏数据导出、私有运行日志、抓包和回放数据。
- 生产后端二进制和完整安装器资源。

## 开发

需要 Windows 10/11 x64、Node.js 18+ 和 npm。

```powershell
cd electron-app
npm ci
npm run dev
```

默认后端地址：

```text
http://127.0.0.1:8765
```

可以通过环境变量指定外部后端：

```powershell
$env:METER_BASE_URL = "http://127.0.0.1:8765"
npm run dev
```

## 构建 UI

```powershell
cd electron-app
npm run build
```

生成目录版：

```powershell
npm run dist:dir
```

生成安装器：

```powershell
npm run dist
```

公开仓库的安装器只包含 UI 壳。若要获得实时解析能力，需要额外提供兼容的本地后端，并按 `docs/BACKEND.md` 的接口契约提供状态服务。

## 隐私

完整版本会在本机保存战斗历史和诊断日志。提交 issue 或分享日志前，请先确认其中没有角色名、服务器、队伍信息或其他个人数据。

## 免责声明

本项目仅用于学习研究和个人使用。网络捕获、第三方工具、覆盖层或相关行为可能违反游戏服务条款，使用者需自行承担风险。
