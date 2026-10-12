"""User-facing model definitions stored in JSON and readable reports."""


def describe_methods(project):
    r,s=project.resources,project.search
    return dict(
        technology=dict(name=r.technology,source=r.technology_provenance,metal_layers=len(r.metals),
            builtin_reference='内置 Nangate45 参考提取自 OpenROAD-flow-scripts 的 NangateOpenCellLibrary.tech.lef（金属几何）和 NangateOpenCellLibrary.macro.lef（单元尺寸）；原件保存在 ResimProjects/_references/sources/nangate45，版本与哈希见 sources/manifest.json。' if 'nangate45' in r.technology.lower() else '本工程工艺按输入来源声明；程序不推断为内置参考库。',
            scope='本工程使用输入中的单元/硬宏面积、金属 width/pitch 等资源参数；运行时不自动综合网表或调用完整 PDK。',
            tsv_source=r.tsv.provenance if r.tsv else '未提供 TSV 工艺',notes=r.notes),
        utilization=dict(default_target=.65,
            definition='实际标准单元利用率 = 标准单元面积 / (模块矩形面积 − 硬宏面积)。',
            ownership='target_cell_utilization 是架构/后端设定的规划参数，不是工艺库规定；省略时程序默认 65%。示例的 55%/65% 用于演示，需实际实现数据校准。',
            requirement='最低模块占地 = 标准单元面积 / 目标利用率 + 硬宏面积。die.max_utilization 限制整层有效区占用，含义不同。'),
        routing=dict(name='模块边缘端口 Manhattan 估算',
            description='port_locations 可指定端口所在边和边内相对位置；缺省选择朝向对端/TSV 的边中点。绑定连接经过指定通道中心线；按允许金属层分配轨道预算，逐层检查容量。避开起终端模块内部，但尚未绕开全部模块、禁布区或完成引脚分配。'),
        signals=dict(name='信号 TSV 需求（逐接口累加）',
            formula='Σ连接[合计物理线数 × 跨越的相邻 die 接口数]',
            example='64 根物理信号线从 L0 到 L2，跨过两个相邻接口，累计需求为 128 个信号 TSV 接口位置；不是 128 条独立逻辑连接。',
            exclusions='包含数据、控制和冗余线；不包含电源与地。不等于已放置孔数，也不是已确定的工艺孔结构。'),
        optimization=dict(algorithm='Google OR-Tools CP-SAT',grid_um=s.grid_um,time_limit_s=s.time_limit_s,candidates=s.candidates,
            objective=('J = Σ(latency_weight × (平面延迟系数 × 中心/通道代理距离 + tier_ps × 跨层数))；整数目标精度 0.001 ps' if s.objective=='latency' else 'J = wirelength_weight × Σ(N × D网格整数) + tier_crossing_weight × Σ(N × 跨层接口数)'),
            wirelength_weight=s.wirelength_weight,tier_crossing_weight=s.tier_crossing_weight,
            constraints='每模块唯一 die、允许层、固定位置、同组同层、边界、不重叠、模块间距、外围 halo、通道禁占、绑定通道的 die 归属和分层截面线数容量、预留区、有效区占用上限、已知功耗、供电与 TSV 容量、跨层数限制。',
            limitations='保持模块长宽、TSV 区域和供电端口固定，不切分模块。模块尺寸向上取整到网格，搜索代理距离 D 为网格包络中心 Manhattan 距离的 2/grid_um 倍；绑定通道时改为中心到入口、通道全长、出口到中心的距离，通道端点取整到半网格，并比较两个通行方向；边缘端口路径、TSV 接入绕行、每层网格拥塞和其它实现性限制由统一评估器复核，超载候选不被接受。未知功耗不会形成完整约束。',
            optimality='OPTIMAL 只证明该离散模型的代理目标最优；FEASIBLE 表示找到解但未证明最优。后续候选排除了先前解，其界限仅对剩余解空间有效。不能据此宣称真实芯片布局全局最优。',
            ranking=('延迟模式按违例、缺失项、实际边缘路径的加权估算延迟排序。' if s.objective=='latency' else '复核后先按违例数、缺失项数排序，再按 wirelength_weight×实际边缘路径加权线长 + tier_crossing_weight×grid_um/2×跨层信号需求排序。'),
            improvement='缩小网格、增加搜索时间、比较不同权重/种子，可探索更好的候选但不保证改善；需要接入更准确的布线和后端反馈后才能判断物理质量。'))
