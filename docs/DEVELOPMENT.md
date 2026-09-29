# Resim 源码开发与构建指南

更新：2026-09-29。以下命令均在 Resim 根目录执行。版本仍为 0.12.0，数据格式不因目录重组而改变。

## 1. 四个源码目录

```text
src/
├─ frontend/                   网页、3D、样式与前端依赖
│  ├─ index.html / app.js
│  ├─ viewer.js / layout-model.js / core-view.js
│  └─ vendor/                 Three.js、js-yaml 及来源和许可证
├─ backend/                    可直接运行和重建的后端
│  ├─ entry.py                CLI / 服务入口
│  ├─ pyproject.toml          包定义与 pytest 配置
│  ├─ requirements-lock.txt   固定依赖版本
│  ├─ desktop/ResimHost.cs    Windows 入口与目录服务
│  ├─ resim/                  核心计算、校验、API、导出和工程存储
│  └─ resim_*policy*.py       0.12 兼容与存储扩展
├─ tests/
│  ├─ frontend/               前端规则与状态测试
│  ├─ backend/                Python 核心、API、存储和故障测试
│  ├─ integration/            真实 Windows 程序与落盘测试
│  └─ fixtures/               冻结输入、LEF、来源、许可证与哈希
└─ tools/
   ├─ setup-dev.ps1 / dev.ps1 环境准备与源码运行
   ├─ build.py / publish.ps1  整包构建与发布
   ├─ verify.mjs              统一验收和证据输出
   ├─ start.ps1 / sync-web.mjs 安装版启动与前端副本同步
   ├─ recovery/               恢复证据和已停用工具，仅供溯源
   ├─ .venv/                 本机开发环境，不纳入 Git
   └─ .build/                构建产物和发布备份，不纳入 Git
```

业务代码不混入测试和开发工具；安装包不包含测试、构建脚本或恢复字节码。app 是构建产物，不是编辑入口。用户工程和模拟结果放在独立目录。

## 2. 后端职责与调用链

| 入口 / 模块 | 责任 |
| --- | --- |
| `desktop/ResimHost.cs` | 本地入口、目录服务、反向代理、子进程生命周期 |
| `entry.py` → `resim/__main__.py` | CLI、服务、评估、寻优、输入检查和工程迁移 |
| `resim/server.py` | HTTP API、预览、项目和运行操作 |
| `resim/schema.py` | 架构、工艺、布局与约束模型及校验 |
| `resim/engine.py` | 汇总资源、跨层接口与问题清单 |
| `physical.py` / `routing.py` / `metal_routing.py` / `wiring.py` | 间距、路径、逐金属层容量与线面积 |
| `supply.py` / `feasibility.py` | 供电预算与实现性诊断 |
| `optimizer.py` | CP-SAT 模块 Die 分配、布局枚举及候选复核 |
| `workspace.py` / `export.py` | 工程、历史、JSON/YAML/HTML 报告 |
| `lef.py` / `explain.py` / `methodology.py` | LEF 读取、计算依据与模型说明 |
| `resim_search_policy.py` | 初始化兼容层、双 YAML API、指纹和维护命令 |
| `resim_policy_stack.py` | 朝向、F2F/B2B、HB/TSV 检查 |
| `resim_policy_storage.py` | 输入日志、锁与恢复 |
| `resim_policy_portable.py` | 归档校验与工程路径重定位 |

公共库入口为 `import resim`，初始化自动且幂等。前端通过 HTTP 使用统一评估引擎。部分前端预览几何有对应实现，使用前后端一致性测试校验。兼容层仍会替换部分函数，是后续重构项；它不依赖旧二进制或字节码。

## 3. 环境准备与源码启动

需要 Windows x64、Python 3.13、Node.js（本次验证 v24.19.0）及 Windows .NET Framework C# 编译器。锁文件固定 41 项依赖版本，首次安装需要访问包源。无需安装前端 npm 包。

```powershell
.\src\tools\setup-dev.ps1
.\src\tools\dev.ps1 -Port 8771 -ProjectsDir "..\ResimDevProjects"
```

`setup-dev.ps1 -Python <python.exe路径>` 可指定 Python 3.13。开发脚本默认打开浏览器；`-NoBrowser` 只启动服务。关闭服务窗口或 Ctrl+C 结束。

只调试 Python 计算接口时：

```powershell
.\src\tools\.venv\Scripts\python.exe src/backend/entry.py --help
.\src\tools\.venv\Scripts\python.exe src/backend/entry.py serve --port 8772 --projects-dir "..\ResimDevProjects"
```

直接启动 Python 不包含 Windows 目录选择服务，完整网页联调请用 dev.ps1。当前支持源码检出开发与 Windows app 分发；没有含完整网页资产的独立 wheel 发布流程。

## 4. 构建与验收

```powershell
.\src\tools\.venv\Scripts\python.exe src/tools/build.py --output src/tools/.build/release-example
$env:RESIM_APP_DIR=(Resolve-Path src/tools/.build/release-example/app).Path
node src/tools/verify.mjs docs/staging-verification.json
Remove-Item Env:RESIM_APP_DIR
```

构建输出必须是 `.build` 下不存在的新目录。生成的 app 包含 exe、运行依赖、网页、许可证和 build-manifest.json。过程只读取源码和开发环境，不读取旧 app，不修改正在使用的程序和工程。

manifest 记录源码 SHA-256、后端指纹和依赖版本。固定依赖用于复建相同功能，不承诺不同机器生成逐字节相同的 exe。

验收核对前端语法、源文件与包内副本、构建来源，并执行 Node 和 Python 测试。测试使用独立临时目录，不依赖或改写使用人员工程。临时目录使用短路径避免 Windows 路径长度限制，保留失败现场便于排查。

输出 JSON、Node TAP、Python 文本和 JUnit XML，必须退出码 0 且 `passed=true`。当前数量和文件哈希见 [verification.json](verification.json)。环境受限不能启动 HttpListener 时，在普通本地环境重试，不省略集成测试。

单独运行后端测试：

```powershell
.\src\tools\.venv\Scripts\python.exe -m pytest -c src/backend/pyproject.toml
```

## 5. 发布整包

确认没有进行中的评估或寻优，并保存页面草稿。核实目标进程完整路径与 PID，然后运行：

```powershell
.\src\tools\publish.ps1 -Application src/tools/.build/release-example/app -Verification docs/staging-verification.json -ExpectedProcessId <目标Resim入口PID> -Port 8770
node src/tools/verify.mjs
```

未运行时省略 ExpectedProcessId，可通过 `-ProjectsDir` 指定工程目录。运行中升级保留原工程目录，核对源码、验收结果、exe 哈希，复制整包后再停止目标入口。旧 app 保存在 `.build/previous-app-*`；启动失败尝试回滚。Windows 文件占用或权限仍可能阻止目录重命名；失败时检查保留的旧包与错误，不混用新旧 `_internal`。

发布会短暂中断本地服务，不搬迁工程或结果。安装后重新验收，更新 `docs/verification.*`，不能拿指向 staging 的报告代替安装版验证。

本地快速预览可用 `node src/tools/sync-web.mjs` 同步前端到 app，但这会使旧构建清单失效；正式交付应整包重建。

## 6. 恢复依据与后续边界

18 个后端模块从本地开发补丁及文本修改记录恢复，恢复基线与原 Python 3.13 字节码规范化指令匹配；没有运行时反编译或字节码加载。依据见 [source-recovery.json](source-recovery.json)。之后加入新目录适配、0.12 初始化和源码指纹；恢复基线哈希与当前构建哈希用途不同。

同时恢复 12 份原 Python 测试源码，修订路径和既有格式迁移预期，补充自包含工艺/工程输入和源码加载检查。历史字节码留在 tools/recovery 作核对证据，程序与测试不导入它。旧二进制插入补丁工具已停用归档。

回归还修复了非法输入提前创建项目目录的问题。恢复源码不等于提高了物理估算精度：真实工艺标定、完整运行事务、任务取消、详细绕障和热/电气签核仍按 [HANDOVER.md](HANDOVER.md) 的清单继续推进。
