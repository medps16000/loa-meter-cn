# 后端接口说明

本公开仓库只提供 UI，不提供实时解析后端。UI 通过 HTTP/SSE 读取本地后端状态，默认地址为：

```text
http://127.0.0.1:8765
```

开发时可以覆盖地址：

```powershell
$env:METER_BASE_URL = "http://127.0.0.1:8765"
npm run dev
```

## 必要接口

```text
GET  /state.json
GET  /state/stream
POST /reset
POST /shutdown
```

`/state.json` 返回当前快照，`/state/stream` 使用 SSE 推送同样结构的增量状态。`/reset` 用于手动清空当前战斗，`/shutdown` 用于打包版退出时请求后端停止。

## 常用字段

UI 会容忍字段缺失，但后端至少应提供当前战斗状态和玩家聚合数据：

```ts
type MeterState = {
  status?: string
  raidName?: string
  bossName?: string
  elapsedSeconds?: number
  totalDamage?: number
  dps?: number
  damageReliability?: 'reliable' | 'waiting' | 'unreliable'
  uiRows?: PlayerRow[]
  skillTotals?: SkillRow[]
  sourceSkillRows?: SkillRow[]
  bossHp?: BossHpRow[]
}
```

常见扩展字段：

```ts
type PlayerRow = {
  id?: string | number
  name: string
  classId?: number
  itemLevel?: number
  damage?: number
  dps?: number
  share?: number
  critRate?: number
  frontRate?: number
  backRate?: number
  shieldDamage?: number
  stagger?: number
  destruction?: number
}
```

技能行可包含：

```ts
type SkillRow = {
  skillId?: number
  name: string
  icon?: string
  damage?: number
  shieldDamage?: number
  stagger?: number
  destruction?: number
  hits?: number
  critRate?: number
  frontRate?: number
  backRate?: number
}
```

## 打包版后端

私有完整包会把后端二进制放在 Electron `resources/backend/` 下，Electron 主进程只负责启动和关闭该外置进程。公开仓库不包含该二进制，也不包含任何抓包、解密、协议解析、材料捕获或 opcode 映射代码。
