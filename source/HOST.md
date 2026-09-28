# Windows 本地程序入口

`Resim.exe` 是轻量 Windows 入口，`Resim.Engine.exe` 是计算引擎。入口转发原 CLI 命令；`serve` 将计算引擎放在临时回环端口，对外继续提供原端口（默认 8770），增加同源目录浏览/创建接口。现有静态页面、评估、历史与结果导出由引擎处理。启动网页应使用 `Resim.exe serve`，直接启动 Engine 不含目录选择服务。

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

## 候选数量策略

旧引擎的 `Search.candidates` 有人为设置的 `le=10`。`resim_search_policy.py` 通过启动钩子移除此字段上限，并重新构建 Search / Project 输入校验；正整数校验、网格、资源检查和原有时间预算保持不变。CLI、YAML、网页预览和寻优均使用同一策略。求解器仍通过排除已求得的坐标/Die 分配枚举不同方案；仅当排除之后返回 INFEASIBLE 才说明当前离散空间已穷尽，超时数量不是最大值。

由于本地保留的是打包引擎及原模块字节码，`build_search_engine.py` 向现有 PyInstaller CArchive 插入上述有源码的启动钩子。构建会校验 Python 版本、档案边界和入口名称，逐项确认原始档案内容及 bootloader 未改；不替换求解器或评估代码。CArchive 格式依据 [PyInstaller 官方读取器](https://github.com/pyinstaller/pyinstaller/blob/develop/PyInstaller/archive/readers.py)。

```powershell
python source/build_search_engine.py
node --test tests/planning-controls.test.mjs tests/search-capacity.test.mjs
.\source\update-engine.ps1 -ExpectedProcessId <当前8770监听进程ID> -Port 8770
```

使用 Python 3.13 构建 `Resim.Engine.next.exe`；测试从独立临时目录启动新引擎，验证 12 个不同候选真实落盘、百万级请求数量输入校验、非法数量拒绝、固定布局搜索穷尽。更新脚本核对监听进程和路径，保留原项目目录，失败时恢复原引擎。成功后可删除 staging 文件；已安装引擎不依赖本机 Python。

## 新版工程输入

同一启动钩子将工程存储切换为 `inputs/chip-architecture.yml` 与 `inputs/technology.yml`。工程载入时合并并执行原有 `Project` 校验；保存评估或寻优后再拆分回两份新版输入。合并后的 `resim/0.1` 只保留在各次运行目录中用于结果复现，工程根目录不再维护旧版 `inputs/architecture.yml`。

双文件中的 `stack.die_faces` 在载入时校验并编码给引擎，保存时从兼容块还原为显式 `stack`，与网页下载格式一致。新建项目 ID 使用请求上下文保存，避免不同调用共用实例变量；这不代表多文件存储已具备完整事务或通过高并发压力测试。

更新脚本识别直接监听及 Windows HTTP.sys 两种模式。TCP 显示 PID 4 时，`http-listener.ps1` 要求同一请求队列中同时匹配目标应用 PID 和 127.0.0.1 端口；不能确认时拒绝更新。

完整检查执行 `node source/verify.mjs`。测试使用 `tests/fixtures/minimal-project.mjs` 的合成输入，不要求存在使用人员的示例工程。正式交接和源码缺口见 [docs/HANDOVER.md](../docs/HANDOVER.md)。
