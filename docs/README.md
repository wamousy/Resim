# Resim 0.12.0

芯片架构阶段的资源估算与三维布局规划工具，用于识别实现难点、辅助 partition 和 floorplan 决策。

| 目录 | 内容 |
| --- | --- |
| [app](../app/) | 可执行程序、启动文件和运行依赖；使用人员只需此文件夹 |
| [src](../src/) | 完整源代码：`frontend/` 前端、`backend/` 后端、`tests/` 测试、`tools/` 开发工具 |
| [docs](./) | 使用说明、工作交接、格式契约与验证记录 |

用户工程与示例继续单独放在 `Resim` 旁的 `ResimProjects/`；结果保存位置在网页中配置。`.git` 和 `.gitignore` 是版本管理元数据。

双击 [app/启动Resim.cmd](../app/启动Resim.cmd) 或 [app/Resim.exe](../app/Resim.exe) 即可打开页面。程序已经运行时会复用已有服务。分发时必须复制整个 `app`，不能只复制 exe；运行不需要单独安装 Node 或 Python。

后端缺失的 18 个模块和 12 份原测试源码已恢复；现在从 src 独立构建整个 app，不读取旧引擎，也不加载归档字节码。恢复依据见 [source-recovery.json](source-recovery.json)。前端以 `src/frontend/` 为唯一编辑入口，app 内的网页是构建副本。

在仓库目录也可运行：

```powershell
.\src\tools\start.ps1 -OpenBrowser
```

该入口默认打开浏览器，使用 `-NoBrowser` 可只启动服务。目录识别使用原有 ResimProjects。命令行可显式指定项目目录：

```powershell
.\app\Resim.exe serve --port 8770 --projects-dir "..\ResimProjects" --open-browser
```

开始源码开发，在 `Resim` 目录执行：

```powershell
.\src\tools\setup-dev.ps1
.\src\tools\dev.ps1
```

源码服务默认使用 8771 端口，安装版默认 8770；建议开发时通过 `-ProjectsDir` 指定独立工程目录。完整构建、回归和整包发布见开发指南，当前验收证据见 [verification.json](verification.json)。

文档入口：[开发与构建指南](DEVELOPMENT.md) · [工作交接](HANDOVER.md) · [实施状态与剩余任务](RELEASE-0.12.md) · [输入与接口](API-CONTRACT.md) · [Windows 入口](HOST.md)。
