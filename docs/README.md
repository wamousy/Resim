# Resim 0.12.0

芯片架构阶段的资源估算与三维布局规划工具，用于识别实现难点、辅助 partition 和 floorplan 决策。

| 目录 | 内容 |
| --- | --- |
| [app](../app/) | 可执行程序、启动文件和运行依赖；使用人员只需此文件夹 |
| [src](../src/) | 可维护源代码；包含 `web/` 前端、`tools/` 开发工具和 `tests/` 测试 |
| [docs](./) | 使用说明、工作交接、格式契约与验证记录 |

用户工程与示例继续单独放在 `Resim` 旁的 `ResimProjects/`；结果保存位置在网页中配置。`.git` 和 `.gitignore` 是版本管理元数据。

双击 [app/启动Resim.cmd](../app/启动Resim.cmd) 或 [app/Resim.exe](../app/Resim.exe) 即可打开页面。程序已经运行时会复用已有服务。分发时必须复制整个 `app`，不能只复制 exe；运行不需要单独安装 Node 或 Python。

**源码边界：** 前端以 `src/web/` 为唯一编辑入口，`app/_internal/resim/static/` 是随程序分发的副本。原后端目前只有打包引擎与字节码，尚不能从完整源码重建；缺口与待办见交接文档。C# 入口和新增 Python 扩展均有源码。

在仓库目录也可运行：

```powershell
.\src\tools\start.ps1 -OpenBrowser
```

该入口默认打开浏览器，使用 `-NoBrowser` 可只启动服务。目录识别使用原有 ResimProjects。命令行可显式指定项目目录：

```powershell
.\app\Resim.exe serve --port 8770 --projects-dir "..\ResimProjects" --open-browser
```

修改前端后，从 `Resim` 目录执行同步和验收：

```powershell
node src/tools/sync-web.mjs
node src/tools/verify.mjs
```

`sync-web.mjs` 将前端源文件发布到 app，并移除 app 静态目录中源码已删除的文件；`--check` 只核对，不修改。验收检查源码与运行副本一致、语法及自动测试，需要 Node 和 Python 3.13，结果见 [verification.json](verification.json)。

文档入口：[工作交接](HANDOVER.md) · [本次实施与剩余任务](RELEASE-0.12.md) · [输入与接口](API-CONTRACT.md) · [启动与构建](HOST.md)。
