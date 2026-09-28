# Resim
面向芯片架构阶段的资源估算与三维布局规划工具，用于发现实现难点、辅助模块分区和 floorplan 决策。

**交接总入口：[模拟器使用与开发交接文档](docs/HANDOVER.md)**。包含功能完成度、输入输出、计算口径、代码地图、维护步骤、测试证据和按优先级排列的待完善任务。

在程序目录启动：

```powershell
.\Resim.exe serve --port 8770 --projects-dir "..\ResimProjects" --open-browser
```

维护人员运行 `node source/verify.mjs`，检查结果保存至 [docs/verification.json](docs/verification.json)。本次检查为 51 项自动测试和 29 个前端文件语法检查全部通过。

当前为架构级估算，不能代替后端物理实现签核。发布包的原始 Python 后端目前只保留字节码，尚不具备完整源码重建条件；此项已列为交接最高优先级缺口。

使用说明：[架构输入与历史结果](INPUT-WORKFLOW.md)。

芯片架构与工艺库可分别导入 YAML，或通过网页定义 Die、模块与连接。结果管理支持历史运行及候选方案间的对比。

在“架构输入 → 定义项目 → 结果保存位置”中选择已有文件夹，或新建文件夹后直接用于保存结果。每次保存生成独立记录。

运行程序时请将 `Resim.exe`、`Resim.Engine.exe` 与 `_internal` 保持在同一目录。入口实现与维护说明见 [Windows 本地程序入口](source/HOST.md)。
