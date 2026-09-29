# 输入格式与本地 API 契约

版本：0.12.0。本机工具集成约定，不代表已支持多用户网络服务。

## 输入

| 文件 | 版本 | 结构契约 |
| --- | --- | --- |
| 芯片架构 | resim-architecture/1 | [chip-architecture.schema.json](contracts/chip-architecture.schema.json) |
| 工艺资源 | resim-technology/1 | [technology.schema.json](contracts/technology.schema.json) |
| 合并运行输入 | resim/0.1 | [project.schema.json](contracts/project.schema.json) |

JSON Schema 2020-12，额外字段默认拒绝。长度 µm、面积输入 µm²/展示 mm²、功耗 W、电流 A、位宽 bit。null 表示未知，0 表示已知零值。位宽、物理线数和传输带宽不是同一参数。

原生 `stack.die_faces` 允许 up/down/unknown，Die ID 必须存在。旧 description 兼容块可载入，新结果不再写入。独立 Schema 只校验结构，跨文件引用和堆叠几何使用以下命令：

```powershell
.\app\Resim.exe check-inputs --architecture chip-architecture.yml --technology technology.yml
```

退出码 0 表示无格式或堆叠 error，仍可能有 unknown；1 表示失败。格式错误返回 `errors:[{path,message}]`，堆叠问题在 issues。检查通过不代表物理签核。

## 计算 API

路径、方法、请求体以 [engine.openapi.json](contracts/engine.openapi.json) 为准。维护时用 `export-schemas --output docs/contracts` 从引擎重新生成。

| 接口 | 行为 |
| --- | --- |
| GET /api/health、/api/schema | 服务版本、根目录与合并输入结构 |
| POST /api/validate | YAML 校验，无历史写入 |
| POST /api/preview | YAML 评估预览，无历史写入 |
| POST /api/layout/preview | 合并布局对象预览，无历史写入 |
| POST /api/optimize/preview | 网页生成候选，计算但不创建工程或写入历史 |
| POST /api/evaluate | 兼容旧调用，保存独立方案、输入快照与报告 |
| POST /api/batches/save-plan | 网页保存入口；创建/追加一个批次内方案，核对预览、保留输入及派生关联 |
| GET /api/projects/{id}/batches/{batch_id} | 读取批次元数据、用于恢复配置的 base_yaml 与实际 batch_dir |
| POST /api/optimize | 兼容已有程序集成：求解并持久化整次搜索；网页不再调用此接口 |
| GET /api/projects | 扫描默认根目录下一级项目文件夹，并合并本次运行已打开的外部项目 |
| POST /api/projects/open | `{project_dir:绝对路径}`，验证并打开已有项目；返回项目元数据，不复制文件、不生成项目索引 |
| GET /api/projects/{id}/input | 合并输入；可能迁移旧格式或恢复提交日志 |
| GET /api/projects/{id}/runs | 历史；可能将异常 running 标为 interrupted |
| GET /api/projects/{id}/runs/{run}/result | 读取已保存结果，不重新计算 |

YAML 请求提供 yaml 字符串，可选 project_id、project_name、project_dir、output_dir、run_name、result_folder_name，具体以 OpenAPI 为准；layout/preview 提交完整项目对象。引擎 YAML 上限 4 MB，Host 请求体上限 8 MB。输入错误通常为 HTTP 422 和 detail；旧接口 detail 结构尚未统一。

运行状态 running/completed/failed/interrupted 与报告状态 violations/incomplete/within_model_constraints 分开；completed 不表示没有实现违例。部分旧接口未声明强类型响应，OpenAPI 空响应 schema 不是“无返回内容”。正式集成应固定版本并校验所需字段；统一错误码和响应类型仍待完善。

## Windows 目录服务

由 Resim.exe 提供，未包含在引擎 OpenAPI 中：

- GET `/api/output-folders?path=...`：浏览目录，缺省为项目根目录。
- POST `/api/output-folders/create`：`{parent,name}`，创建一个不存在的子目录。
- 需要 `X-Resim-Local: 1`；Origin 存在时须与回环页面一致，无 CORS。
- 创建目录不触发仿真，后续保存才写结果。

详见 [HOST.md](HOST.md)。上述请求头不构成网络身份认证，存储锁也不替代多用户权限。

`run_name` 是结果显示名称，与 project_name 分开；可选，提供时必须为 1–120 字符且不含控制字符。前后空白会裁剪，空名称返回 422。仅提供 `run_name` 的旧调用继续使用自动编号目录。

`project_dir` 是完整新项目的绝对路径，空字符串使用默认项目目录。只能选择空目录或不存在的目录，不能嵌套在其他项目中；已有 project_id 时不能修改位置。项目的 project.json、inputs 两份 YAML 和结果子文件夹全部保存在此目录，旧持久化接口另有 runs 目录。API 项目列表与 storage 返回真实 `project_dir`。CLI 的 init/evaluate/optimize 对应 `--project-dir`。

工程发现以各项目自己的 `project.json` 为准，文件夹名称不必等于 id。新项目不再写 `_project-location.json` 或独立项目索引；旧登记与别名文件只兼容读取。`GET /api/projects` 忽略无效或无关目录；多个不同文件夹使用同一项目编号时返回 422，避免错误归属。外部项目经 `POST /api/projects/open` 验证输入后加入当前服务的内存列表，服务重启即忘记外部路径。404 表示目录或输入缺失，422 表示元数据、输入或编号冲突。Windows Host 上的打开请求需 `X-Resim-Local: 1`，Origin 存在时必须与页面同源。

服务按配置的根目录复用 ProjectStore；不得在每个请求重新创建实例，否则会丢失本次打开的外部路径。项目复制后若原件仍在发现范围内，不能用相同编号同时打开副本。项目搬迁/改名后，批次与项目内旧结果按新目录读取，历史内容不改写；原本外置的旧结果仍使用其原外部路径，跨机器交接请用 pack-project。CLI 可通过 `--projects-dir <项目的父目录>` 配合 `--project <内部编号>` 载入已有自定义文件夹。

兼容接口的 `result_folder_name` 指定项目内的实际结果子文件夹名：`<project_dir>/<名称>`。支持中文与空格，最多 120 个 UTF-16 单元；拒绝路径分隔符、Windows 禁用字符/设备名及句点结尾。CLI 对应 `--result-folder-name`；新版网页使用下述批次接口。报告、布局、输入快照和 run.json 直接写入此子文件夹。已存在的目录、文件，以及 inputs/runs 等项目保留名，自动追加 ` (2)`、` (3)` 等，不覆盖原内容。

旧 API 的 `output_dir` 仅保留兼容，网页不再发送或读取旧目录偏好。它不能与 project_dir 同时指定，也不能将采用 `project-folder/1` 布局的新项目结果外置。历史目录按原索引读取，不自动迁移；不传 result_folder_name 的旧调用仍使用原运行目录结构。

`storage.results_dir` 是实际报告目录，`storage.result_folder_name` 是包含重名后缀的最终文件夹名。命名保存使用 `results_subdir: "."`；旧存储使用 `"results"`。旧接口使用 `runs/<run_id>/run.json` 指针，新批次接口直接读取批次清单。集成方应使用 `results_dir`，仅对旧响应回退到 `run_dir/results`，不要推测目录名。

## 批次与方案保存

`POST /api/batches/save-plan` 每次提交一个方案；网页批量保存顺序调用此接口，逐项更新进度。请求包含：

| 字段 | 含义 |
| --- | --- |
| `project_id` / `project_name` / `project_dir` | 已有项目 ID，或新项目名称及完整目录；已有 ID 时不能传 project_dir |
| `batch_id` / `batch_name` | `batch-<UUID>`，由前端同一次探索持续复用；批次文件夹显示名称 |
| `base_yaml` | 本次探索配置参照输入；v2 历史恢复时可使用同批次任一方案的完整输入，placements 不参与配置族校验 |
| `yaml` / `preview_plan_id` | 待保存方案的完整输入及其预览 plan_id；后端重算核对 |
| `source_key` / `plan_name` | 方案来源标识（网页为 `layout-<plan_id>`）及其独立文件夹名称 |
| `kind` / `search_metadata` | manual 或 optimize；搜索状态、耗时、生成数量等摘要 |
| `candidate_metadata` | 可选的该候选求解状态、目标值、下界和差距等信息 |
| `parent_record_id` / `parent_source_key` | 可选的同批次已保存父方案 ID / 父方案来源标识 |

响应为 `{batch, report, reused}`，report.storage 含实际 project_dir / batch_dir / results_dir、batch_id、run_id 与父方案关联。新批次 run.json 使用 resim-batch/2，含配置族哈希、初始输入哈希（仅校验信息，不保存初始布局副本）、搜索配置、引擎来源和方案清单。batch_id 是批次，兼容 runs API 的 run_id 是单方案记录；不可混用。GET batch 的 base_yaml 从首个已保存方案重建，不能解释为原始搜索起点；v1 仍返回原冻结输入。

同批次 source_key 与输入哈希相同的重试返回原记录且 reused=true。批次名称不能在追加时更改。方案仅允许 placements 与显示名称不同，架构、工艺、约束和搜索配置变化必须用新 batch_id；旧 v1 还校验完整 base_yaml 哈希。父记录必须属于同批次。输入不匹配、过期预览及无效名称返回 422。search_metadata / candidate_metadata 是客户端搜索记录，不是服务端签名证据。

文件先写入批次内临时目录，准备完毕后提交方案文件和原子的批次清单。批次清单是提交点，历史从实际批次和方案元数据读取，不再创建 runs/<id> 指针或 _batch-index。旧指针兼容读取并按方案 ID 去重，不补写索引。异常清理本次未提交目录；批量操作不是跨所有方案的整体事务，失败前已提交的方案保留。断电时遗留临时目录的自动回收、整批取消/恢复仍待完善。

首次保存后不会用候选覆盖项目 inputs；新批次只存方案清单，每方案独立 inputs/chip-architecture.yml + technology.yml。磁盘上的 resource-report.json 使用 resim-report/2，省略 project 并附 input_files；结果 API 验证输入哈希、重建 project，网页和比较接口格式不变。历史 export 新增 floorplan.svg（旧格式可按报告即时生成）；layout.yml 和 report.json 仍按需返回完整数据。便携包保留独立方案输入和派生关系。旧 evaluate/optimize 和 v1 批次沿用原输出结构。

project_name 仅为显示名，project_dir 为准确的项目保存位置；指定位置时不拼接 project_name。省略位置时生成 project-随机编号目录，与名称无关。历史接口路径中的 runs 表示记录集合，不要求新版网页项目存在物理 runs 文件夹；旧接口持久化布局保持兼容。便携包导入纯批次项目也不生成重复索引目录。
