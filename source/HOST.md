# Windows 本地程序入口

`Resim.exe` 是轻量 Windows 入口，`Resim.Engine.exe` 保留原计算引擎。入口转发原 CLI 命令；`serve` 将计算引擎放在临时回环端口，对外继续提供原端口（默认 8770），增加同源目录浏览/创建接口。现有静态页面、评估、历史与结果导出由原引擎处理。

- `GET /api/output-folders?path=...`：浏览已有目录，空路径为项目根目录。
- `POST /api/output-folders/create`：`{parent, name}`，原子创建单个子目录并返回真实路径。
- 两个接口均要求 `X-Resim-Local: 1`；如提供 Origin，必须匹配本地页面。没有 CORS 开放。
- 不提供删除、覆盖、移动、执行命令或任意文件内容读取接口。目录名拒绝路径穿越及 Windows 保留名。
- 子引擎归属于 Windows Job Object；入口退出时同时终止子引擎，避免残留进程。程序不安装全局服务、URL ACL 或额外运行时。

源文件 `ResimHost.cs` 使用 Windows 自带 .NET Framework 编译。在 Resim 目录运行：

```powershell
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /optimize+ /reference:System.Web.Extensions.dll "/out:$PWD\Resim.Host.test.exe" "$PWD\source\ResimHost.cs"
node --test tests/output-folders.test.mjs
```

集成测试启动独立端口，使用临时项目和结果目录，验证真实创建、Unicode/空格路径、重名、越界名称、同源限制及实际评估落盘，最后清理测试目录。Windows 受限执行环境可能不支持 HttpListener，需在普通本地环境运行。测试通过后，停止当前 Resim 入口，将测试入口替换为 `Resim.exe`；保留 `Resim.Engine.exe` 与 `_internal` 的相对位置。更新引擎时替换 `Resim.Engine.exe`，前端依然位于 `_internal/resim/static/`。
