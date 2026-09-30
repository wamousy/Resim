# Resim 模拟器开发文档

本文面向修改 Resim 源码、扩展输入模型、增加计算能力或重新构建发布包的开发者。

## 1. 目录结构与源码边界

```text
Resim/
├─ app/                 已发布的可运行程序
├─ src/
│  ├─ frontend/        Web 前端唯一源码
│  ├─ backend/         Python 引擎、API 和 Windows Host 源码
│  ├─ tests/           前端、后端与集成测试
│  └─ tools/           构建、校验、同步和发布工具
└─ docs/
   ├─ contracts/       生成的 Schema 与 OpenAPI
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
- `workspace.py`：工程、运行记录、锁、外部结果目录和历史读取；
- `engine.py`：评估编排和报告生成；
- `optimizer.py`：自动分区与布局；
- `routing.py`、`metal_routing.py`、`wiring.py`：连接路径、金属资源和拥塞；
- `physical.py`：几何、面积和布局约束；
- `supply.py`：供电资源；
- `feasibility.py`、`explain.py`：问题分类与解释；
- `export.py`：JSON、YAML 和 HTML 导出；
- `server.py`：FastAPI 服务；
- `paths.py`：安装目录与工程目录解析。

顶层 `resim_policy_*.py` 文件处理双 YAML、存储事务、堆叠兼容、工程打包和搜索策略。

### 2.3 Web 前端

前端以原生 ES Modules、HTML、CSS 和 Three.js 实现。主要职责包括：

- 工程和双 YAML 输入工作流；
- 2D/3D 布局显示与编辑；
- 连接、资源、计算过程和问题展示；
- 自动布局候选浏览；
- 历史结果和多方案对比；
- JSON、布局 YAML 和 HTML 报告下载。

前端只负责草稿交互和展示。所有需要持久化或作为正式结果使用的计算必须由后端再次校验。

## 3. 输入模型

当前支持三种相关表示：

- `resim-architecture/1`：独立芯片架构文件；
- `resim-technology/1`：独立工艺资源文件；
- `resim/0.1`：两者合并后的运行输入。

对应机器契约位于：

- `docs/contracts/chip-architecture.schema.json`
- `docs/contracts/technology.schema.json`
- `docs/contracts/project.schema.json`
- `docs/contracts/engine.openapi.json`

修改 Pydantic 模型或 API 后必须重新导出契约，并检查真实工程能够往返读取。集成测试直接读取芯片架构 Schema，因此不要把 `docs/contracts` 当作普通说明文件删除。

## 4. 本地开发

建议使用项目自带虚拟环境；若需重建环境，按照 `src/tools/requirements.lock` 安装锁定版本。源码服务建议使用与安装版不同的端口和独立测试工程目录。

示例：

```powershell
.\Resim\src\tools\.venv\Scripts\python.exe .\Resim\src\backend\entry.py serve --port 8771 --projects-dir C:\临时目录\ResimProjects
```

命令行入口支持：

```text
serve
validate
evaluate
optimize
export-schemas
pack-project
unpack-project
```

实际参数以 `python src/backend/entry.py <命令> --help` 或 `Resim.Engine.exe <命令> --help` 为准。

## 5. 前端修改与同步

修改 `src/frontend/` 后先运行前端测试，再同步到发布目录：

```powershell
node .\Resim\src\tools\sync-web.mjs
```

完整验证会检查源码前端和 `app/_internal/resim/static/` 是否一致。不要通过直接修改发布副本修复问题，否则下次构建会覆盖改动。

## 6. 测试

测试分为三层：

1. 前端单元测试：输入转换、堆叠、页面状态、候选和显示计算。
2. Python 测试：Schema、几何、路由、资源、优化器、存储事务和 API。
3. 集成测试：冻结程序、Host、真实端口、工程目录和发布包行为。

完整验收入口：

```powershell
node .\Resim\src\tools\verify.mjs
```

默认报告写入 `src/tools/.artifacts/verification.json`，并在同一目录生成 TAP、Python 文本和 JUnit XML。按功能命名时也必须使用该目录，例如：

```powershell
node .\Resim\src\tools\verify.mjs .\Resim\src\tools\.artifacts\chips-details-verification.json
```

`verify.mjs` 会拒绝把验证报告写入 `docs/`。验收报告属于临时构建证据，发布完成后可以归档到独立发布记录，不应混入长期文档。

与改动相关的测试全部通过后即可停止重复运行；只有出现新改动、失败或未解决风险时才扩大测试范围。

## 7. 构建与发布

构建工具位于 `src/tools/`。完整构建应从源码生成 `Resim.exe`、`Resim.Engine.exe`、Python 运行环境、静态前端和构建清单，不依赖旧发布目录中的引擎文件。

典型流程：

```powershell
.\Resim\src\tools\.venv\Scripts\python.exe .\Resim\src\tools\build.py
node .\Resim\src\tools\verify.mjs .\Resim\src\tools\.artifacts\release-verification.json
.\Resim\src\tools\publish.ps1 -Application <暂存app目录> -Verification <验证报告> -ExpectedProcessId <当前入口PID> -Port 8770
```

构建和发布脚本的参数可能调整，执行前应查看脚本帮助或源码。发布前必须确认验证报告对应即将复制的同一个构建，发布后再次检查 `/api/health` 和两个 EXE 的哈希。

## 8. 工程存储规则

- 工程以 `project.json.id` 识别；目录名和显示名称可以不同，不从解析后的目录名反推 ID。
- `_project-aliases.json` 只用于旧 ID 到新 ID 的兼容映射。
- Windows 使用以规范化项目根目录哈希命名的系统互斥锁，保留单机跨进程互斥、重入和超时；不在工程中生成 `.resim-store.lock`。非 Windows 开发环境的文件锁放在系统临时目录。切换锁实现时停止所有旧版实例，避免新旧版本同时保存同一工程。
- 工程当前输入与每次运行输入快照必须分开保存。
- 自定义结果目录只改变新结果的位置；工程内索引仍用于发现历史。
- 外部结果目录被移动或删除后，不能继续把对应索引标记为可读取的已完成运行。
- 写入输入、元数据和结果时应使用原子替换或事务恢复策略。

## 9. 实现约束

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

## 10. 增加新能力的步骤

1. 在 Schema 中明确字段、单位、默认值和未知值语义。
2. 添加跨字段引用和一致性检查。
3. 在评估器中实现计算，并保留可追溯的输入与公式。
4. 在导出结果和 API 中加入稳定字段。
5. 在前端显示结果及其限制，不在界面中重复实现权威计算。
6. 添加能够发现真实错误的测试。
7. 更新生成契约和三份主文档。
8. 完整构建、验证并发布同一份产物。

### 图纸参考参数与位宽输入

`architecture.reference_groups` 保存单模块或子系统的参考尺寸、资源总面积、单元数、引脚数量及来源。`modules` 引用现有模块 ID；记录不会新增模块、改变布局，或被累加为 die 面积。评估器只将 `area_estimate_um2` 与成员当前占地之和比较，产生 `REFERENCE_AREA_LOWER_BOUND`；缺少标准单元/宏拆分时仍保持面积利用率未知。保存结果的输入快照与资源 JSON 均保留这些记录。

连接指定 `data_wires` 时，可以将 `bandwidth_GBps`、`lane_rate_Gbps` 留空。布线继续按显式线数估算，吞吐率显示未知，报告产生 `LINK_RATE_UNKNOWN`。没有显式线数时，两项速率参数必须齐全，不能从逻辑位宽自动猜测物理线数。

未指定 pitch、没有 core 所属且具有总预算的 HB 区域视为全接口分布式说明，其估算连接落点采用端点中心的中点，不把所有核拉到说明矩形中心。TSV 仍经过对应预留区；这里没有实现 HB 单接点分配或物理签核。
