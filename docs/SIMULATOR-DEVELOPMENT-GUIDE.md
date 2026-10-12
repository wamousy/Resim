# Resim 模拟器开发文档

本文面向修改 Resim 源码、扩展输入模型、增加计算能力或重新构建发布包的开发者。下文命令均在 Resim 目录执行。

## 1. 目录结构与源码边界

```text
Resim/
├─ app/                 已发布的可运行程序
├─ src/
│  ├─ frontend/        Web 前端唯一源码
│  ├─ backend/         Python 引擎、API 和 Windows Host 源码
│  ├─ tests/           前端、后端与集成测试
│  └─ tools/           环境准备、开发运行、构建、验证和发布工具
└─ docs/
   ├─ SIMULATOR-USER-GUIDE.md
   ├─ SIMULATOR-DEVELOPMENT-GUIDE.md
   └─ SIMULATOR-HANDOVER.md
```

`src/frontend/` 是前端唯一编辑入口。`app/_internal/resim/static/` 是发布副本，不应单独修改。后端完整源码位于 `src/backend/`；`app/_internal` 中的内容属于构建产物。

## 2. 主要组件

### 2.1 Windows Host

`src/backend/desktop/ResimHost.cs` 构建为 `Resim.exe`，负责：

- 选择默认工程目录；
- 启动 `Resim.Engine.exe serve`；
- 等待健康检查；
- 打开浏览器；
- 提供 Windows 文件夹选择和打开目录能力；
- 在 Host 退出时回收子进程。

### 2.2 Python 引擎

`src/backend/entry.py` 是冻结程序入口，`src/backend/resim/` 包含核心实现：

- `schema.py`：Pydantic 输入模型和跨字段校验；
- `workspace.py`：工程发现、输入、运行记录、历史与旧目录兼容；
- `batches.py`：新批次与单方案保存，重复请求处理；
- `plan_files.py`：方案各自的双 YAML 输入快照；
- `maintenance.py`：离线校验、格式导出、工程打包与解包；
- `engine.py`：评估编排和报告生成；
- `optimizer.py`：自动分区与布局；
- `routing.py`、`metal_routing.py`、`wiring.py`：连接路径、金属资源和拥塞；
- `physical.py`：几何、面积和布局约束；
- `supply.py`：供电资源；
- `feasibility.py`、`explain.py`：问题分类与解释；
- `export.py`：JSON、YAML 和 HTML 导出；
- `server.py`：FastAPI 服务；
- `paths.py`：安装目录与工程目录解析。

顶层 `resim_search_policy.py` 保留双 YAML 存储接入、堆叠模型兼容及评估结果补充。`resim_policy_storage.py` 负责锁与事务，`resim_policy_stack.py` 负责堆叠检查，`resim_policy_portable.py` 负责打包与解包。导入 `resim` 时，`__init__.py` 通过幂等的 `apply()` 安装一次兼容策略；不要在业务代码中重复安装。

所有命令统一由 `resim/__main__.py` 解析，离线维护命令委托 `maintenance.py` 执行。已移除根据 `sys.argv` 提前截获命令的第二套解析流程。

### 2.3 Web 前端

前端以原生 ES Modules、HTML、CSS 和 Three.js 实现。主要职责包括：

- 工程和双 YAML 输入工作流；
- 2D/3D 布局显示与编辑；
- 连接、资源、计算过程和问题展示；
- 自动布局候选浏览；
- 历史结果和多方案对比；
- 已保存方案的报告查看和多方案对比。底层导出接口仍保留。

前端只负责草稿交互和展示。所有需要持久化或作为正式结果使用的计算必须由后端再次校验。

## 3. 页面到计算、保存的完整路径

```text
前端导入 YAML / 自定义 → architecture-io.js 合并运行输入
  → server.py 接收请求 → schema.py 校验
  → engine.py 调用几何、布线、供电与实现性计算
  → 堆叠检查和来源信息 → 前端布局、资源、实现难点
```

- 预览：`/api/preview`、`/api/layout/preview`、`/api/optimize/preview` 只计算，不创建项目或历史。
- 寻优：`optimizer.py` 生成不同候选，使用同一评估逻辑；浏览候选不等于保存。
- 保存：`batch-save.js` → `/api/batches/save-plan` → `batches.save_plan()`，重新评估并核对预览身份，再写入 项目/批次/方案。
- 保存批次逐个保存候选；保存方案可继续向当前批次追加。每个方案独立保存 inputs，不重复保存批次级输入。
- 旧 evaluate/optimize 命令和 API 仍兼容旧保存方式；新功能不要再新增另一套历史索引。

前端 app.js/workbench.js 负责页面编排；输入在 input-editor.js、structure-editor.js、technology-form.js；显示和选择在 viewer.js、core-view.js、object-details.js；候选浏览在 candidate-browser.js。正式评估以服务端为准。

## 4. 输入模型

当前支持三种相关表示：

- `resim-architecture/1`：独立芯片架构文件；
- `resim-technology/1`：独立工艺资源文件；
- `resim/0.1`：两者合并后的运行输入。

原 `docs/contracts` 是从代码导出的 JSON Schema 和 OpenAPI 副本，便于外部工具了解字段和接口，不是运行依赖。该目录已移除，权威定义在 Pydantic 模型与 FastAPI 路由中。集成测试从受测 EXE 导出到临时目录，检查后自动清理，不依赖文档副本。

外部对接确有需要时可临时导出：

```powershell
.\app\Resim.Engine.exe export-schemas --output src/tools/.artifacts/schemas
```

生成文件不需要放回 docs。

## 5. 本地开发

开发需要 Windows x64、Python 3.13 和 Node.js（当前验证环境为 24）。运行 `src/tools/setup-dev.ps1` 创建虚拟环境，安装 `src/backend/requirements-lock.txt` 中锁定的依赖。源码服务建议使用与安装版不同的端口和独立测试工程目录。

示例：

```powershell
.\src\tools\setup-dev.ps1
.\src\tools\dev.ps1 -Port 8771 -ProjectsDir C:\临时目录\ResimDevProjects
```

命令行入口支持：

```text
serve
validate
evaluate
optimize
check-inputs
export-schemas
pack-project
unpack-project
```

实际参数以 `python src/backend/entry.py <命令> --help` 或 `Resim.Engine.exe <命令> --help` 为准。

## 6. 开发工具与前端修改

| 工具 | 用途 |
| --- | --- |
| `setup-dev.ps1` | 安装锁定开发依赖 |
| `dev.ps1` | 从源码运行 Host 与计算服务 |
| `build.py` | 构建完整的新程序，不读取旧 app |
| `verify.mjs` | 测试指定构建，核对源码与产物 |
| `publish.ps1` | 发布已验证的构建，保留旧版用于回滚 |
| `lib/check-web.mjs` | 只读比较源码与发布前端 |
| `lib/http-listener.ps1` | 识别 Windows HTTP.sys 端口所属进程 |

修改前端后在源码服务中刷新页面；修改后端后重启源码服务。已删除前端单独复制到 app 的同步工具，避免程序和构建清单不一致。发布版本统一走完整构建、验证和发布。

可再生目录：`.venv` 是开发依赖；`.build` 是暂存构建和回滚包；`.artifacts` 是测试证据与临时导出；`__pycache__` 是 Python 缓存。不要删除正在运行的构建。发布验收后，`.build` 保留最新构建及一份回滚包即可。`.artifacts` 中明确标注的项目备份应单独保留，不能当作普通测试日志删除。

旧的 recovery 字节码、历史补丁构建脚本和重复启动脚本已删除，维护以完整源码为准。正式用户从 app/Resim.exe 或 app/启动Resim.cmd 启动。

## 7. 测试

`src/tests` 不是运行依赖，不会打包进 app；为后续开发保留。只交付使用人员时复制整个 app 即可；交付开发人员时应保留测试。删除测试不会让已构建程序无法运行，但完整发布验证将缺失或失败。fixtures 是测试专用输入，不是用户项目。

测试分为三层：

1. 前端单元测试：输入转换、堆叠、页面状态、候选和显示计算。
2. Python 测试：Schema、几何、路由、资源、优化器、存储事务和 API。
3. 集成测试：冻结程序、Host、真实端口、工程目录和发布包行为。

完整验收入口：

```powershell
node src/tools/verify.mjs
```

默认报告写入 `src/tools/.artifacts/verification.json`，并在同一目录生成 TAP、Python 文本和 JUnit XML。按功能命名时也必须使用该目录，例如：

```powershell
node src/tools/verify.mjs src/tools/.artifacts/chips-details-verification.json
```

`verify.mjs` 会拒绝把验证报告写入 `docs/`。验收报告属于临时构建证据，发布完成后可以归档到独立发布记录，不应混入长期文档。

与改动相关的测试全部通过后即可停止重复运行；只有出现新改动、失败或未解决风险时才扩大测试范围。

## 8. 构建与发布

构建工具位于 `src/tools/`。完整构建应从源码生成 `Resim.exe`、`Resim.Engine.exe`、Python 运行环境、静态前端和构建清单，不依赖旧发布目录中的引擎文件。

典型流程（release-new 必须是尚不存在的新构建名称）：

```powershell
.\src\tools\.venv\Scripts\python.exe src/tools/build.py --output src/tools/.build/release-new
$env:RESIM_APP_DIR = (Resolve-Path src/tools/.build/release-new/app).Path
try {
    node src/tools/verify.mjs src/tools/.artifacts/verification.json
    if ($LASTEXITCODE -ne 0) { throw '验证未通过，不能发布' }
} finally {
    Remove-Item Env:RESIM_APP_DIR -ErrorAction SilentlyContinue
}
.\src\tools\publish.ps1 -Application src/tools/.build/release-new/app -Verification src/tools/.artifacts/verification.json -Port 8770
```

如果安装版仍在运行，最后一条增加 `-ExpectedProcessId <当前 app/Resim.exe 的 PID>`。发布工具会核对进程、端口、源码哈希和受测 EXE，失败时回滚；不会覆盖用户项目。

注意：不设置 RESIM_APP_DIR 时验证的是现有 app，不是暂存构建。必须验证并发布同一份产物，发布后核对健康接口、默认项目路径和两个 EXE 的哈希。

## 9. 工程存储规则

- 工程以 `project.json.id` 识别；目录名和显示名称可以不同，不从解析后的目录名反推 ID。
- `_project-aliases.json` 只用于旧 ID 到新 ID 的兼容映射。
- Windows 使用以规范化项目根目录哈希命名的系统互斥锁，保留单机跨进程互斥、重入和超时；不在工程中生成 `.resim-store.lock`。非 Windows 开发环境的文件锁放在系统临时目录。切换锁实现时停止所有旧版实例，避免新旧版本同时保存同一工程。
- 工程当前输入与每次运行输入快照必须分开保存。
- 新页面使用 项目/批次/方案 目录，按批次与方案自身的 run.json 发现历史，不另外创建项目索引或 _batch_index。旧 runs 索引仅兼容旧结果。
- 外部结果目录被移动或删除后，不能继续把对应索引标记为可读取的已完成运行。
- 写入输入、元数据和结果时应使用原子替换或事务恢复策略。

## 10. 实现约束

开发时必须保持以下语义：

- 未知资源不能按零或无限大处理；
- 模块只与同一 die 上的模块检查平面重叠；
- 模块、halo、TSV 禁布区和显式预留区应分别建模，不能重复扣除面积；
- 逻辑位宽、物理线数、序列化通道数和带宽是不同量；
- HB 与 TSV 分开统计；
- 层间接口必须检查相邻关系、接触面、区域所有权和局部容量；
- 移动模块后必须重新计算端口位置、路径、线长、金属资源和跨层供给；
- 预览不得创建工程或历史记录；
- 保存必须生成独立运行目录，不能覆盖既有结果；
- 自动规划候选不能声称全局最优，除非求解器确实给出相应证明。

## 11. 增加新能力的步骤

1. 在 Schema 中明确字段、单位、默认值和未知值语义。
2. 添加跨字段引用和一致性检查。
3. 在评估器中实现计算，并保留可追溯的输入与公式。
4. 在导出结果和 API 中加入稳定字段。
5. 在前端显示结果及其限制，不在界面中重复实现权威计算。
6. 添加能够发现真实错误的测试。
7. 通过临时格式导出回归检查，更新受影响的主文档。
8. 完整构建、验证并发布同一份产物。

### 图纸参考参数与位宽输入

`architecture.reference_groups` 保存单模块或子系统的参考尺寸、资源总面积、单元数、引脚数量及来源。`modules` 引用现有模块 ID；记录不会新增模块、改变布局，或被累加为 die 面积。评估器只将 `area_estimate_um2` 与成员当前占地之和比较，产生 `REFERENCE_AREA_LOWER_BOUND`；缺少标准单元/宏拆分时仍保持面积利用率未知。保存结果的输入快照与资源 JSON 均保留这些记录。

连接指定 `data_wires` 时，可以将 `bandwidth_GBps`、`lane_rate_Gbps` 留空。布线继续按显式线数估算，吞吐率显示未知，报告产生 `LINK_RATE_UNKNOWN`。没有显式线数时，两项速率参数必须齐全，不能从逻辑位宽自动猜测物理线数。

未指定 pitch、没有 core 所属且具有总预算的 HB 区域视为全接口分布式说明，其估算连接落点采用端点中心的中点，不把所有核拉到说明矩形中心。TSV 仍经过对应预留区；这里没有实现 HB 单接点分配或物理签核。
