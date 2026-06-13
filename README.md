# LOA METER CN

LOA METER CN 是一个面向国服《命运方舟》的桌面战斗统计界面项目。本仓库是公开发布版，主要包含 Electron + Vue 前端、窗口管理、历史记录展示和本地 UI 状态管理。

> 注意：公开仓库不包含核心抓包、协议解析、解密和协议映射实现。完整实时解析后端以发布包二进制形式提供，或由维护者在私有仓库中构建。

QQ 用户群: 491404064

## 功能

- 实时 DPS / 总伤害展示界面。
- 游戏内悬浮窗。
- 玩家、技能、Boss、BUFF、护盾等视图。
- 本地战斗历史与 SQLite 存储。
- 离线/外部后端调试模式。
- Electron 安装包构建配置。

## 公开仓库内容

```text
.
├── electron-app/              # Electron + Vue 前端
│   ├── src/main/              # Electron 主进程、窗口、IPC、历史库
│   ├── src/preload/           # preload bridge
│   └── src/renderer/          # Vue UI
├── docs/                      # 公开说明
├── README.md
└── .gitignore
```

## 不包含的内容

为了避免公开核心实现和敏感研究资料，本仓库不包含：

- 核心抓包后端。
- 协议解析与解密代码。
- 协议映射表和逆向文档。
- 游戏数据导出文件。
- 本地运行日志、抓包、回放数据。
- 打包后的 exe / installer。

## 开发环境

需要：

- Windows 10/11 x64。
- Node.js 18+。
- npm。

安装依赖：

```powershell
cd electron-app
npm ci
```

启动前端开发模式：

```powershell
npm run dev
```

默认情况下，前端会访问本地后端：

```text
http://127.0.0.1:8765
```

可以通过环境变量指定外部后端：

```powershell
$env:METER_BASE_URL = "http://127.0.0.1:8765"
npm run dev
```

## 构建

构建前端：

```powershell
cd electron-app
npm run build
```

生成 Electron 目录版：

```powershell
npm run dist:dir
```

生成安装器：

```powershell
npm run dist
```

公开仓库的构建产物只包含 UI。若需要完整实时解析能力，需要额外放入兼容的后端二进制，并设置对应的后端启动方式。

## 后端接口约定

UI 期望后端提供以下 HTTP 接口：

```text
GET  /state.json
GET  /state/stream
POST /reset
POST /shutdown
```

返回数据结构以当前 UI 类型定义为准。公开仓库不提供这些接口的生产实现。

## 隐私与日志

完整版本会在本地保存诊断日志和战斗记录。公开反馈问题时，请先检查日志中是否包含角色名、服务器信息或其他个人数据。

## 免责声明

本项目仅用于学习研究和个人使用。网络捕获、第三方工具和游戏覆盖层可能违反游戏服务条款。使用者需自行承担风险。
