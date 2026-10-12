# Resim v1.0

**面向芯片架构决策的资源模拟器**：评估架构的实现难点，以三维可视化辅助前端 partition 与 floorplan 规划。

Resim 将芯片架构、工艺资源和布局约束合并为可检查的模型，用于比较不同布局的资源代价。当前版本为 **1.0.0**，提供 Windows 可执行程序、完整源码和交接文档。

[下载 v1.0](https://github.com/wamousy/Resim/releases/tag/v1.0) · [使用文档](docs/SIMULATOR-USER-GUIDE.md) · [开发文档](docs/SIMULATOR-DEVELOPMENT-GUIDE.md) · [交接文档](docs/SIMULATOR-HANDOVER.md)

## 主要功能

- **架构输入**：导入独立的架构 YAML 与工艺 YAML，或在网页中自定义 die、core、模块、连接和布局约束。
- **布局规划**：整片、单 core、多层和单层视图；显示正背面、TSV/HB 接口；支持模块位置调整与对象详情。
- **连接与资源评估**：估算模块面积、利用率、线长、线束、金属层容量、拥塞、跨层接口、功耗与供电资源。
- **实现难点**：定位越界、重叠、间距与容量违例，列出待补数据和修改建议。
- **自动分区与布局**：使用 OR-Tools CP-SAT 搜索候选，并使用同一套资源模型评估。
- **结果管理**：独立保存当前方案或一批候选，查看历史及选择多方案对比。

## 快速开始

运行环境为 **Windows x64**。使用发布包不需要安装 Python 或 Node.js。

1. 在 [Releases](https://github.com/wamousy/Resim/releases/tag/v1.0) 下载 `Resim-v1.0-windows-x64.zip` 并完整解压。
2. 双击 `app/启动Resim.cmd` 或 `app/Resim.exe`。
3. 浏览器将打开本地页面，默认地址为 `http://127.0.0.1:8770/`。
4. 在“架构输入”中打开项目文件夹或新建项目，提供架构与工艺资源。
5. 查看布局、连接、资源和实现难点；需要自动规划时，在“布局规划”中生成候选。
6. 在“结果管理”中命名并保存方案或批次。

请保留整个 `app` 目录，不能仅复制一个 EXE。`app/_internal` 是运行依赖。用户项目应存放在程序目录外，默认使用相邻的 `ResimProjects`。

也可克隆整个仓库后启动：

```powershell
git clone https://github.com/wamousy/Resim.git
cd Resim
.\app\Resim.exe
```

## 输入与输出

| 输入 | 内容 |
| --- | --- |
| 芯片架构 `chip-architecture.yml` | chip/die/core/module 层级、端口、拓扑、位宽与容量、初始布局、约束、堆叠朝向和搜索配置 |
| 工艺资源 `technology.yml` | 模块资源参数、金属层线宽与间距、布线容量、TSV/HB 和供电参数 |

架构与工艺分别使用 `resim-architecture/1` 和 `resim-technology/1`。程序版本升级为 1.0.0 不改变这些文件格式标识。

输出包含布局与分区方案、资源计算结果、约束违例及实现难点。网页预览和自动生成候选不会自动保存历史；“保存方案”保存当前正在浏览的方案，“保存批次”保存本批次的多个方案。

```text
项目文件夹/
├─ project.json
├─ inputs/
│  ├─ chip-architecture.yml
│  └─ technology.yml
└─ 自定义批次名称/
   ├─ run.json
   └─ 自定义方案名称/
      ├─ inputs/                         该方案的两份输入快照
      ├─ run.json                        方案身份及保存状态
      ├─ floorplan.svg                   各层布局图
      ├─ resource-report.json            资源计算数据
      ├─ implementation-difficulties.md  实现难点
      └─ report.html                     可阅读的评估报告
```

每个方案采用相同结构。项目 ID、显示名称和文件夹名称可以不同，项目 ID 不能重复。

## 仓库结构

```text
Resim/
├─ app/                    已构建的 Windows 程序
├─ src/
│  ├─ frontend/            页面与三维显示
│  ├─ backend/             输入、计算、API、存储和 Windows Host
│  ├─ tests/               前端、后端、集成测试与测试样例
│  └─ tools/               环境准备、开发运行、构建、验证和发布
├─ docs/                   使用、开发与交接文档
├─ .gitignore
└─ README.md
```

`src` 是代码修改入口，`app` 由源码构建生成，不直接编辑发布副本。测试不参与程序运行，但保留用于后续迭代。格式定义来自代码，仓库不保留重复的 `docs/contracts`；需要时可以按需导出。

本次仓库整理以 **`Resim v1.0` 单次提交**作为起点，`v1.0` 标签标记该交付快照。用户项目、历史评估、虚拟环境、构建缓存和验证日志不纳入 Git。仓库保留完整 `app`，Release 同时提供方便使用人员下载的程序包。

## 开发与构建

开发环境：Windows x64、Python 3.13、Node.js 24；依赖版本锁定在 [requirements-lock.txt](src/backend/requirements-lock.txt)。以下命令在仓库根目录执行。

```powershell
# 首次准备开发环境
.\src\tools\setup-dev.ps1

# 使用独立端口与测试项目运行源码版
.\src\tools\dev.ps1 -Port 8771 -ProjectsDir C:\ResimDevProjects
```

构建一个新版本（输出目录必须尚不存在）：

```powershell
.\src\tools\.venv\Scripts\python.exe src/tools/build.py --output src/tools/.build/release-new
$env:RESIM_APP_DIR = (Resolve-Path src/tools/.build/release-new/app).Path
try {
    node src/tools/verify.mjs src/tools/.artifacts/verification.json
    if ($LASTEXITCODE -ne 0) { throw '验证未通过，不能发布' }
} finally {
    Remove-Item Env:RESIM_APP_DIR -ErrorAction SilentlyContinue
}
.\src\tools\publish.ps1 -Application src/tools/.build/release-new/app -Verification src/tools/.artifacts/verification.json
```

安装版正在运行时，发布命令还需要 `-ExpectedProcessId <当前 Resim.exe 的 PID>`。发布工具核对受测构建、源码与 EXE，失败时回滚。完整流程与源码调用关系见[开发文档](docs/SIMULATOR-DEVELOPMENT-GUIDE.md)。

## 适用范围

Resim 用于架构定义期与早期物理规划，**不能替代详细布线或 EDA 签核**。未知参数保留为未知，不作为零或无限容量；布局搜索不承诺全局最优。面积、功耗及互联资源的精度取决于输入工艺数据和标定质量。详细时序、IR drop、热耦合等能力仍需外部工具或后续扩展。

## 第三方组件

主要组件包括 Three.js、FastAPI、Pydantic、NumPy、Shapely、OR-Tools 与 ruamel.yaml。第三方许可随 [app/licenses](app/licenses)、[前端 vendor](src/frontend/vendor) 和测试工艺资料保存。仓库目前未为 Resim 自身指定开源许可证；第三方许可证不代表本项目整体的授权条款。
