# Resim
A simulator for 3D chips Display  and resource evaluation

使用说明：[架构输入与历史结果](INPUT-WORKFLOW.md)。

芯片架构与工艺库可分别导入 YAML，或通过网页定义 Die、模块与连接。结果管理支持历史运行及候选方案间的对比。

在“架构输入 → 定义项目 → 结果保存位置”中选择已有文件夹，或新建文件夹后直接用于保存结果。每次保存生成独立记录。

运行程序时请将 `Resim.exe`、`Resim.Engine.exe` 与 `_internal` 保持在同一目录。入口实现与维护说明见 [Windows 本地程序入口](source/HOST.md)。
