# Resim 0.12.0

芯片架构阶段的资源估算与三维布局规划工具，用于识别实现难点、辅助 partition 和 floorplan 决策。

| 目录 | 内容 |
| --- | --- |
| `app/` | 完整运行程序和随包依赖 |
| `src/` | Windows 入口与可维护 Python 扩展源码 |
| `tools/` | 启动、构建、更新和验收脚本 |
| `tests/` | 自动测试与合成测试输入 |
| `docs/` | 使用说明、交接、格式契约与验证记录 |
| `../ResimProjects/` | 独立的用户工程与示例 |

前端源码唯一维护位置为 `app/_internal/resim/static/`。原后端目前只有打包引擎与字节码，尚不能从完整源码重建。

双击根目录的 `启动Resim.cmd` 或 `app/Resim.exe` 即可打开页面。程序已经运行时会复用已有服务。

在仓库目录也可运行：

```powershell
.\tools\start.ps1 -OpenBrowser
```

该入口默认打开浏览器，使用 `-NoBrowser` 可只启动服务。目录识别使用原有 ResimProjects。命令行可显式指定项目目录：

```powershell
.\app\Resim.exe serve --port 8770 --projects-dir "..\ResimProjects" --open-browser
```

文档入口：[交接文档](docs/HANDOVER.md) · [本次实施与剩余任务](docs/RELEASE-0.12.md) · [输入与接口](docs/API-CONTRACT.md)。

验收：`node tools/verify.mjs`，需要 Node 与 Python 3.13。结果见 [verification.json](docs/verification.json)。使用人员运行模拟器不需要单独安装 Node 或 Python，只需完整 app 文件夹。
