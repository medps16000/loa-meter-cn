LOA METER CN 是一个面向国服《命运方舟》的 Windows 实时战斗统计工具。它通过本机网络捕获解析战斗事件，并在 Electron 桌面窗口和浮窗中展示实时 DPS、玩家伤害、技能明细、Boss 伤害、增益和护盾统计。

## 功能

- 实时伤害与 DPS 统计。
- 游戏内可用的悬浮窗。
- 玩家、技能、Boss、BUFF、护盾等视图。
- 本地保存战斗历史，方便复盘。
- 在 Boss 目标明确时使用 Boss-only 统计口径。
- 支持玩家名称、source、召唤物、投射物 owner、队伍归属解析。
- 支持离线回放，用于排查日志和协议更新问题。
- 支持打包为 Windows 安装器。

## 环境要求

普通用户：

- Windows 10/11 x64。
- 管理员权限，用于本机网络捕获。
- 从 Release 页面下载最新版安装包。

开发者：

- Python 3.10+。
- Node.js 18+。
- `pydivert`。
- 运行所需数据文件：
  - `oo2net_9_win64.dll`
  - `oodle_state.bin`
  - `lostark_cn_python/out_json/Skill.json`
  - `lostark_cn_python/out_json/SkillEffect.json`
  - `lostark_cn_python/out_json/Npc.json`

## 快速开始

安装最新版后，在进入副本或战斗区域前启动 LOA METER CN。

运行日志和诊断数据默认写入：

```text
%LOCALAPPDATA%\LOA_METER_CN\runs\YYYYMMDD_HHMMSS
```

如果遇到无数据、伤害异常、名字缺失等问题，反馈时请尽量提供对应的完整 run 目录，尤其是：

```text
runs\YYYYMMDD_HHMMSS\captures\
runs\YYYYMMDD_HHMMSS\logs\
```

## 从源码运行

安装 Python 捕获依赖：

```powershell
python -m pip install pydivert
```

安装 Electron 依赖：

```powershell
cd electron-app
npm ci
```

回到项目根目录启动：

```powershell
.\start_cn_live_meter_electron.bat
```

该入口会启动本地后端和 Electron UI。

## 打包安装器

在项目根目录运行：

```powershell
.\build_installer.ps1
```

安装包输出目录：

```text
electron-app\release\
```

常用参数：

```powershell
.\build_installer.ps1 -SkipBackend
.\build_installer.ps1 -DirOnly
```

- `-SkipBackend`：复用已有 PyInstaller 后端 exe。
- `-DirOnly`：只生成 unpacked 目录，方便快速测试。

## 项目结构

```text
.
├── electron-app/              # Electron + Vue UI
├── protocol/                  # 协议解析和运行时常量
├── scripts/                   # 后端、启动器、捕获和回放工具
├── lostark_cn_python/out_json # 技能和 NPC 元数据
├── newdocs/                   # 当前协议记录、工作流和发布说明
├── build_installer.ps1        # 安装器构建脚本
└── start_cn_live_meter_electron.bat
```

## 常见问题

### 没有数据显示

- 确认以管理员权限运行。
- 确认游戏已连接到支持的服务器端口。
- 确认进副本之前主程序上无报错。
- 反馈时提供最新的 `%LOCALAPPDATA%\LOA_METER_CN\runs\...` 目录。

### 伤害延迟出现

工具需要等到可信的会话材料和 zone seed 后才展示伤害。这样做是为了避免用旧密钥或默认 seed 解出错误伤害。

### 第二把或切阶段后没数据

通常是游戏创建了新的网络 flow，而工具没有及时捕获新的握手或 seed。请保留完整 run 目录用于排查。

### 玩家名字或队伍识别不对

请提供 run 目录和游戏内队伍截图。玩家身份需要多条链路互证，游戏更新后可能需要重新校准。

## 隐私说明

LOA METER CN 会在本地保存诊断日志和战斗记录。这些文件可能包含：

- 角色名。
- 战斗数据。
- 服务器端点。
- 本机捕获到的包元数据。

工具不会自动上传这些数据。公开分享日志前，请先确认内容是否适合公开。


## 免责声明

本项目仅用于学习研究和个人使用。网络捕获、第三方工具和游戏覆盖层可能违反游戏服务条款。使用者需自行承担风险。
