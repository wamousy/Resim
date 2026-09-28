# 0.12.0 实施状态与迁移说明

日期：2026-09-28。对应 HANDOVER.md 第 12 节。本次保留原面积、路由和 CP-SAT 数值求解器，新增功能都有独立源码和回归测试。

## 1. 目录与交付

Resim 分为三个业务目录：`app/` 存放完整运行程序；`src/` 存放可维护源码，测试和工具归入 `src/tests/`、`src/tools/`；`docs/` 存放说明、交接和验证记录。用户工程 `ResimProjects` 保持原位置。前端源码唯一编辑入口为 `src/web/`，通过 `node src/tools/sync-web.mjs` 发布到 `app/_internal/resim/static/`，完整验收会检查两者一致。

使用人员只需要 app 全部内容，包括 `_internal`，双击其中的 `启动Resim.cmd` 或 `Resim.exe`；不要加入 `.next.exe` 或测试入口。维护人员另接收 src 和 docs。`src/tools/start.ps1` 与仓库内 exe 均默认使用 Resim 旁的原工程目录；独立复制 app 后默认使用 app 旁的 ResimProjects，也可显式指定 `--projects-dir`。

## 2. 原清单实施状态

| 编号 | 状态 | 本次交付及剩余边界 |
| --- | --- | --- |
| P0-01 完整后端源码 | 待资料 | 保留字节码，新增扩展都有源码；仍缺原始 Python 工程、依赖锁及从零打包方案。 |
| P0-02 schema / 堆叠统一 | 本版完成 | 正式 stack 字段、旧格式迁移；Web、API、CLI、新 JSON/HTML 共用引擎规则。旧文件不改写。 |
| P1-01 真实工程与工艺参数 | 待资料 | 未补造真实功耗、面积、TSV/HB 和校准数据。 |
| P1-02 事务与恢复 | 部分完成 | 双输入与 manifest 恢复日志、写入锁、中断运行标记。完整 run 目录跨文件/跨磁盘原子提交和断点续算仍未实现。 |
| P1-03 便携工程与指纹 | 本机验收通过 | 外置结果收集、校验、重定位；版本、引擎/schema 哈希、依赖版本及模型指纹。已验证迁移到新根目录后继续模拟；另一台 Windows 机器仍需验收。 |
| P1-04 schema 与 API 契约 | 部分完成 | 三份 JSON Schema、生成的 OpenAPI、离线双文件语义检查和字段路径错误。旧 API 响应模型和统一错误码仍不完整。 |
| P1-05 校准与不确定度 | 仅追溯框架 | 报告标记 calibration=unverified、accuracy_interval=null；保留工艺来源与输入哈希。未产生真实误差区间。 |
| P1-06 取消/进度/配额 | 待实现 | 当前同步求解缺少安全取消协议，需要独立任务进程和持久状态；终止页面请求不代表求解已停止。 |
| P2-01 真实路由反馈 | 待模型与样本 | 未加入全局绕障、过孔优化或网表反馈。 |
| P2-02 热 / IR / EM | 待模型与参数 | 功耗密度不是温度，未增加签核分析。 |
| P2-03 长表与三维联动 | 间距表完成 | 每页 25/50/100 条，模块 ID 搜索、通过/不足筛选；点击模块定位 Core/Die。其余长表后续逐步处理。 |
| P2-04 状态拆分与验收 | 部分完成 | 验证入口加入 Python 故障测试、并发、迁移及跨入口一致性。完整状态拆分、CI、全面浏览器自动回归仍待完成。 |
| P2-05 多用户安全 | 未开放 | 仍为本地单用户工具；存储锁不等于权限、配额或审计体系。 |

## 3. 新命令

以下在仓库目录执行。示例命令未自动对用户工程执行打包或导入。

### 离线输入检查

```powershell
.\app\Resim.exe check-inputs --architecture "..\ResimProjects\blx-scheme1\inputs\chip-architecture.yml" --technology "..\ResimProjects\blx-scheme1\inputs\technology.yml"
```

不写入工程或历史。格式及堆叠无 error 时退出码 0，允许 issues 中有待补数据；失败为 1。字段错误包含类似 `architecture.dies.0.width_um` 的路径。JSON Schema 只覆盖结构，跨文件引用和堆叠关系使用此命令检查。

### 工程打包与迁移

```powershell
.\app\Resim.exe pack-project --project-dir "..\ResimProjects\blx-scheme1" --output "..\ResimDelivery\blx-scheme1.zip"
.\app\Resim.exe unpack-project --archive "..\ResimDelivery\blx-scheme1.zip" --projects-dir "..\ResimImported"
.\app\Resim.exe serve --projects-dir "..\ResimImported" --port 8771
```

导出收集双输入、manifest、内部及外置运行。缺失外置目录时明确报错；正在运行时拒绝。先在页面查看历史，让异常终止的 running 记录恢复为 interrupted。

导入拒绝覆盖已有同 ID 工程，检查文件哈希、清单、路径穿越、大小写冲突、Windows 保留名及 2 GiB 总大小限制。导入全部成功后才公布工程；失败清理临时目录。运行归入新工程内部 runs，JSON 路径更新；输入快照、资源值和计算来源保持不变。`import-receipt.json` 保留原路径及包哈希。旧 HTML 是原历史文件，可能仍含原路径文字；网页历史和后续计算使用新 JSON 路径。

完整 ZIP 通过同目录硬链接独占发布，需支持硬链接的文件系统（本次为 NTFS），不支持时明确失败。哈希用于完整性检查，不是来源签名。包不包含程序运行时、原始 PDK 或其他外部校准文件，应另行交接。

### 导出格式契约

```powershell
.\app\Resim.exe export-schemas --output docs/contracts
```

生成芯片架构、工艺和合并输入三份 JSON Schema，以及引擎 OpenAPI。详见 [API-CONTRACT.md](API-CONTRACT.md)。

## 4. 保存与恢复语义

输入提交先写 `.resim-input-transaction.json`，包含三份完整内容和校验和，再逐份原子替换。读取时发现日志会先恢复，完成后移除。损坏日志停止读取并报错，不悄悄覆盖输入。

工程库保存串行执行；进程退出后文件锁释放，默认等待 30 秒。读取可能等待当前求解，超时后应待操作结束再重试。不支持绕过程序的外部编辑与保存同时发生。

取得库锁后，历史读取把残留 running 标为 interrupted，保留已有结果，不标成 completed、不续算或删除。完整结果目录仍使用原导出流程，不承诺跨目录 ACID、硬件断电持久性或所有失败阶段自动修复。

报告中的 provenance.input_sha256 对规范化项目 JSON 计算；run.json 原有 input_sha256 对当次输入文本计算。二者分别用于模型输入和原始文本追溯，不能直接互比。

## 5. 验证与后续交接

执行 `node src/tools/verify.mjs`，需要 Node 和 Python 3.13；Windows 目录服务测试需要普通本地环境支持 HttpListener。

- 在输入提交的四个边界分别真实终止进程，恢复完整同一代输入。
- 三个进程各保存 12 次，锁内读取未出现混代。
- API、CLI、保存 JSON、HTML、Web 的堆叠问题与汇总一致，保留未知值和旧格式兼容。
- 真实外置结果打包、导入新根目录并继续模拟，快照和计算值保持不变。
- 损坏/越界包拒绝且不留下半套工程；离线输入错误带字段路径。
- 26,500 条间距记录分页筛选，仅绘制选中页。

计数及文件哈希见 [verification.json](verification.json)，完整记录见 [verification.tap](verification.tap) 和 [verification.python.txt](verification.python.txt)。

2026-09-28 浏览器实测：已载入 BLX 536 模块工程，B/L/X 仍各 800 mm²；B Die 的 15,400 条间距只绘制 50 行，搜索 core00__rssram 得到 175 条并可翻到第 2 页；点击模块切换到 core00 / bdie 并显示对象详情。浏览器错误日志为空。升级后的预览未覆盖用户历史记录。

下一步优先找回原后端源码，再将运行保存和求解任务管理移入正式后端。新增扩展 `src/resim_policy_*.py` 已由构建工具嵌入引擎，不依赖外置源码运行。
