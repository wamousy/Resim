"""Auditable formulas and numerical substitutions generated with each report."""


def fmt(value):
    return '未知' if value is None else format(value,'.8g')


def explain_metrics(report):
    project=report['project']
    tsv=project['resources']['tsv']
    availability=project['resources']['routing_availability']
    result=[]
    for die in report['dies']:
        if die.get('display_platform'):continue
        modules=[m for m in report['modules'] if m['die']==die['id']]
        reserve_rects=[dict(id=b['id'],kind='禁布区',**{k:b[k] for k in ['x_um','y_um','width_um','height_um']}) for b in project['constraints']['blockages'] if b['die']==die['id']]
        reserve_rects += [dict(id=r['id'],kind='TSV 预留区',**{k:r[k] for k in ['x_um','y_um','width_um','height_um']}) for r in project['floorplan']['tsv_regions'] if r.get('interconnect','TSV') != 'HB' and die['id'] in (r['lower_die'],r['upper_die'])]
        reserve_rects += [dict(id=c['id'],kind='布线通道',**{k:c[k] for k in ['x_um','y_um','width_um','height_um']}) for c in project['constraints'].get('routing_channels',[]) if c['die']==die['id']]
        usable=die['area_mm2']-die['reserved_area_mm2']
        metrics=[]
        def add(key,title,formula,substitution,note):
            metrics.append(dict(key=key,title=title,formula=formula,substitution=substitution,note=note))
        add('die_area','Die 面积','宽 × 高 ÷ 10⁶',f"{fmt(die['width_um'])} × {fmt(die['height_um'])} ÷ 10⁶ = {fmt(die['area_mm2'])} mm²",'输入尺寸以 µm 为单位；1 mm² = 10⁶ µm²。')
        add('module_area','模块占地','本 die 上模块矩形的并集，与 die 外形求交后的面积',
            f"模块矩形面积相加 {fmt(sum(m['footprint_um2'] for m in modules)/1e6)} mm² → 去重、裁剪后 {fmt(die['module_area_mm2'])} mm²",
            '模块重叠和越界单独报告。这个面积包括与预留区重合的部分，不包括互联金属面积。')
        add('reserved','预留面积','TSV 区域、禁布区与显式布线通道的并集，再裁剪到 die 边界',
            f"{len(reserve_rects)} 个区域，面积直接相加 {fmt(sum(r['width_um']*r['height_um'] for r in reserve_rects)/1e6)} mm² → 并集面积 {fmt(die['reserved_area_mm2'])} mm²",
            '区域重合只计算一次；相邻接口的 TSV 区域可能在同一 die 上重合。这里没有把信号线面积当作禁布面积扣除。')
        add('utilization','有效区占用率','预留区外的模块占地并集 ÷ (die 面积 − 预留面积)',
            f"{fmt(die['usable_module_area_mm2'])} ÷ ({fmt(die['area_mm2'])} − {fmt(die['reserved_area_mm2'])}) = {fmt(None if die['footprint_utilization'] is None else die['footprint_utilization']*100)}%",
            f"模块与预留区重合 {fmt(die['reserved_overlap_mm2'])} mm²，另报违例；不是标准单元利用率。")
        add('free','剩余可布局面积','die 面积 − 预留面积 − 预留区外模块占地',
            f"{fmt(usable)} − {fmt(die['usable_module_area_mm2'])} = {fmt(die['free_area_mm2'])} mm²",'负值显示为 0；布线金属可以位于模块上方，不能再直接扣减到此值。')
        terms=' + '.join(f"{m['id']}:{fmt(m['power_W'])}" for m in modules) or '0'
        add('power','功耗 / 余量','Pdie = Σ 模块输入功耗；余量 = die 功耗预算 − Pdie',
            f"{terms} = {fmt(die['power_W'])} W；{fmt(die['power_budget_W'])} − {fmt(die['power_W'])} = {fmt(die['power_margin_W'])} W",
            '功耗来自输入，不是按模型负载计算的电路功耗；任一模块功耗缺失时总功耗与余量为未知。移动只改变归属统计。')
        grid=next(g for g in report['congestion'] if g['die']==die['id'])
        peak=grid.get('peak_cell')
        sub=f"峰值金属层 {grid.get('peak_layer')}，网格 ({peak['x']},{peak['y']})，需求 {fmt(peak['demand_tracks'])} / 容量 {fmt(peak['capacity_tracks'])} = {fmt(die['peak_congestion'])}" if peak else '缺少金属资源，无法计算。'
        add('congestion','峰值拥塞','max所有金属层、所有网格(D层格 / C层格)；C = floor(网格横向尺寸 / pitch × 该层可用比例)',sub,
            '每段需求 = 已分配到该层的线数 × 格内长度 / 该方向格长。分层可用比例优先于全局比例；容量为 0 且存在需求时直接报违例，不以其它层余量抵消。通道另检查完整线束同时占轨。')
        interface=next((v for v in report['interfaces'] if v['lower_die']==die['id']),None)
        if interface:
            r=interface['region'];pitch=max(tsv['pitch_um'],tsv['bond_pitch_um']) if tsv else None
            capacity=f"floor({fmt(r['width_um'])}/{fmt(pitch)}) × floor({fmt(r['height_um'])}/{fmt(pitch)}) = {fmt(interface['capacity'])}" if r and pitch else '缺少 TSV 参数或预留区域，容量未知'
            add('tsv','向上一层 TSV 用量 / 容量','用量 = 信号 + 电源 + 地；容量 = floor(Wregion/p) × floor(Hregion/p)，p=max(TSV pitch, bond pitch)',
                f"{die['id']} → {interface['upper_die']}：{interface['signal_vias']} + {fmt(interface['power_vias'])} + {fmt(interface['ground_vias'])} = {fmt(interface['total_vias'])}；容量：{capacity}",
                f"信号 = 穿过本接口的各连接总线数之和。电源 = ceil(I穿越×1000/I单TSV毫安)，地同数；当前 I穿越={fmt(interface['current_A'])} A，单 TSV={fmt(tsv['max_current_mA'] if tsv else None)} mA。跨多层的连接在每个经过的接口计一次。")
        else:
            add('tsv','向上一层 TSV 用量 / 容量','仅计算相邻 die 接口','顶部：没有向上的接口。','顶部仍可能使用向下的 TSV，计入下一层的向上接口。')
        w=die['wire_area']
        add('wire_area','互联面积需求','金属面积 = Σ(N×w×L)；轨道面积 = Σ(N×pitch×L)',
            f"金属面积 {fmt(w['metal_area_um2'])} µm²；轨道面积 {fmt(w['track_area_um2'])} µm²",'仅模块间连接；按已分配金属层逐段求和。多金属层需求不等于 die 平面占地；显式通道按矩形计入预留面积。')
        result.append(dict(die=die['id'],metrics=metrics,reserve_rectangles=reserve_rects,
            module_terms=[dict(id=m['id'],width_um=m['width_um'],height_um=m['height_um'],footprint_um2=m['footprint_um2'],stdcell_area_um2=m['stdcell_area_um2'],macro_area_um2=m['macro_area_um2'],required_footprint_um2=m['required_footprint_um2'],power_W=m['power_W'],target_cell_utilization=m['target_cell_utilization'],cell_utilization=m['cell_utilization'],utilization_basis=m['utilization_basis']) for m in modules],
            congestion_capacity_terms=[dict(metal=r['metal'],direction=r['direction'],pitch_um=r['pitch_um'],capacity_tracks=r['capacity_tracks']) for r in report['metal_routing']['layers'] if r['die']==die['id']]))
    return dict(dies=result,notes=['单个模块最低占地需求 = 标准单元面积 / 目标单元利用率 + 硬宏面积。','模块内部单元利用率 = 标准单元面积 / (模块矩形面积 − 硬宏面积)。'])
