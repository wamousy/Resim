# Windows 本地程序入口

双击 `app/Resim.exe` 或 `app/启动Resim.cmd` 启动服务并打开浏览器。相同端口、相同工程目录已有服务时复用该服务。仓库内默认使用 Resim 旁的 ResimProjects；独立分发时默认使用 app 旁的 ResimProjects。

```powershell
.\app\Resim.exe serve --port 8770 --projects-dir "..\ResimProjects" --open-browser
```

`Resim.exe` 的源码位于 `src/backend/desktop/ResimHost.cs`，负责启动计算引擎、代理网页/API、提供目录浏览服务。`Resim.Engine.exe` 由 Python 源码打包，必须连同 `_internal` 使用。直接启动 Engine 不包含目录选择接口。

## 目录服务

- `GET /api/output-folders?path=...`：浏览目录，空路径为工程根目录。
- `POST /api/output-folders/create`：输入 `{parent, name}`，创建单个子目录并返回真实路径。
- 两个接口要求 `X-Resim-Local: 1`；如果提供 Origin，必须匹配本地页面。没有开放 CORS。
- 不提供删除、覆盖、移动或执行命令接口；拒绝路径穿越及 Windows 保留名称。
- 子引擎属于 Windows Job Object，入口退出时一并终止；不安装全局服务或 URL ACL。

## 源码开发模式

执行 `src/tools/dev.ps1` 编译开发入口，默认监听 8771，通过虚拟环境 Python 运行 `src/backend/entry.py`，前端直接来自 `src/frontend`。开发模式同样支持目录选择。入口通过 `RESIM_ENGINE_PYTHON`、`RESIM_ENGINE_SCRIPT` 接收源码路径；开发脚本结束时恢复原环境变量。

Python 改动后重启服务，前端改动后刷新页面。刷新前保存需要保留的草稿。

## 完整构建与更新

步骤见 [DEVELOPMENT.md](DEVELOPMENT.md)。`build.py` 从源码及锁定依赖生成完整 app，不向旧二进制插入补丁。`verify.mjs` 检查源码匹配和回归，`publish.ps1` 替换整包；不要只替换 Engine.exe 而沿用另一版本的 `_internal`。

发布工具只停止经路径和端口验证的目标进程。HTTP.sys 显示 TCP PID 4 时，额外核对同一请求队列中的程序 PID 与地址。旧 app 完整保存在 `src/tools/.build/previous-app-*`；启动失败会尝试恢复旧包与服务。测试和发布需在支持 Windows HttpListener 的普通本地环境执行。

## 后端初始化

`resim/__init__.py` 初始化 0.12 兼容策略一次：原生 stack、双文件输入、候选数量、恢复锁及追溯信息。这些策略全部是 `src/backend` 下的 Python 源码，与核心模块一起打包。后续可逐项合入核心模块，迁移时保持 Web、CLI、库调用及历史数据兼容。

输入、历史与求解边界见 [HANDOVER.md](HANDOVER.md)。完整运行目录事务、求解任务取消仍待完善。
