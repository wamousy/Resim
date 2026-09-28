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
| POST /api/evaluate、/api/optimize | 保存评估或求解候选、快照与报告 |
| GET /api/projects | 工程列表 |
| GET /api/projects/{id}/input | 合并输入；可能迁移旧格式或恢复提交日志 |
| GET /api/projects/{id}/runs | 历史；可能将异常 running 标为 interrupted |
| GET /api/projects/{id}/runs/{run}/result | 读取已保存结果，不重新计算 |

YAML 请求提供 yaml 字符串，可选 project_id、project_name、output_dir，具体以 OpenAPI 为准；layout/preview 提交完整项目对象。引擎 YAML 上限 4 MB，Host 请求体上限 8 MB。输入错误通常为 HTTP 422 和 detail；旧接口 detail 结构尚未统一。

运行状态 running/completed/failed/interrupted 与报告状态 violations/incomplete/within_model_constraints 分开；completed 不表示没有实现违例。部分旧接口未声明强类型响应，OpenAPI 空响应 schema 不是“无返回内容”。正式集成应固定版本并校验所需字段；统一错误码和响应类型仍待完善。

## Windows 目录服务

由 Resim.exe 提供，未包含在引擎 OpenAPI 中：

- GET `/api/output-folders?path=...`：浏览目录，缺省为项目根目录。
- POST `/api/output-folders/create`：`{parent,name}`，创建一个不存在的子目录。
- 需要 `X-Resim-Local: 1`；Origin 存在时须与回环页面一致，无 CORS。
- 创建目录不触发仿真，后续保存才写结果。

详见 [HOST.md](HOST.md)。上述请求头不构成网络身份认证，存储锁也不替代多用户权限。
