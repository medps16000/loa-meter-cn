# 后端说明

本公开仓库不包含实时解析后端。

UI 默认读取本地后端接口：

```text
GET  /state.json
GET  /state/stream
POST /reset
POST /shutdown
```

开发时可以通过环境变量指定后端地址：

```powershell
$env:METER_BASE_URL = "http://127.0.0.1:8765"
npm run dev
```

打包后的应用如果需要自动启动后端，可以提供兼容的后端二进制，并通过：

```powershell
$env:LOA_METER_BACKEND_EXE = "D:\path\to\LOA_METER_BACKEND.exe"
```

公开仓库不提供抓包、协议解析、解密或协议映射实现。
