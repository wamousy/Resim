from __future__ import annotations

import hashlib
import math
from collections import defaultdict
import numpy as np
from shapely.geometry import box, LineString
from shapely.ops import unary_union
from .schema import Project
from .wiring import estimate_wiring
from .routing import route_link
from .physical import check_spacing
from .metal_routing import allocate_metals
from .supply import supply_groups, region_power


def shape(r):
    return box(r.x_um, r.y_um, r.x_um+r.width_um, r.y_um+r.height_um)


def groups(project):
    result = list(project.constraints.same_die_groups)
    for c in project.architecture.cores:
        if c.keep_on_same_die:
            result.append([m.id for m in project.architecture.modules if m.core == c.id])
    return [g for g in result if len(g) > 1]


def reserves(project, die_id):
    return [shape(b) for b in [*project.constraints.blockages,*project.constraints.routing_channels] if b.die == die_id] + [shape(r) for r in project.floorplan.tsv_regions if r.interconnect != "HB" and die_id in (r.lower_die, r.upper_die)]


def interface_capacity(project, region):
    if not region:return None
    if region.interface_pitch_um is not None:pitch=region.interface_pitch_um
    elif region.interconnect=='HB' or not project.resources.tsv:return None
    else:pitch=max(project.resources.tsv.pitch_um, project.resources.tsv.bond_pitch_um)
    return math.floor(region.width_um/pitch) * math.floor(region.height_um/pitch)


def supply_account(project, placements):
    ds = sorted(project.architecture.dies, key=lambda d: d.order)
    ports = project.floorplan.supply_ports
    local = defaultdict(float)
    unknown = set()
    for m in project.architecture.modules:
        key = (placements[m.id].die, m.voltage_domain)
        local[key] += 0
        if m.power_W is None:
            unknown.add(key)
        else:
            d = next(d for d in ds if d.id == key[0])
            local[key] += m.power_W/d.voltage_V
    stacked = {(p.die, p.domain) for p in ports if p.feed == "stack_base"}
    boundaries = []
    for k in range(len(ds)-1):
        keys = {key for key in local if key in stacked and next(d.order for d in ds if d.id == key[0]) > k}
        current = sum(local[key] for key in keys)
        unknown_current = any(key in stacked and next(d.order for d in ds if d.id == key[0]) > k for key in unknown)
        count = None if unknown_current or project.resources.tsv is None else math.ceil(current * 1000/project.resources.tsv.max_current_mA)
        boundaries.append(dict(current_A=None if unknown_current else current, power_vias=count, ground_vias=count))
    local_unknown = set(unknown)
    demands = dict(local)
    for key in stacked:
        base = (ds[0].id, key[1])
        demands[base] = demands.get(base, 0) + local.get(key, 0)
        if key in unknown:
            unknown.add(base)
    return local, demands, unknown, boundaries, local_unknown


def evaluate(project: Project):
    a, f, res, con = project.architecture, project.floorplan, project.resources, project.constraints
    placements = {p.module: p for p in f.placements}
    ms, ds = {m.id: m for m in a.modules}, {d.id: d for d in a.dies}
    if set(placements) != set(ms):
        raise ValueError("evaluate requires exactly one placement for every module; missing: " + ", ".join(sorted(set(ms)-set(placements))))
    issues = []
    def issue(severity, code, subject, reason, suggestion):
        issues.append(dict(severity=severity, code=code, subject=subject, reason=reason, suggestion=suggestion))
    die_rows, module_rows = [], []
    n = project.search.congestion_grid
    route_segments = []
    z_um, z = {}, 0
    for d in sorted(a.dies, key=lambda d: d.order):
        if d.order:
            z += d.thickness_um + 10
        z_um[d.id] = z
    for d in a.dies:
        outline = box(0, 0, d.width_um, d.height_um)
        reserve = unary_union(reserves(project, d.id))
        pp = [p for p in f.placements if p.die == d.id]
        if not reserve.is_empty and not outline.covers(reserve):
            issue("error", "RESERVE_BOUNDS", d.id, "TSV 或禁布区域超出 die 边界", "调整预留区尺寸与位置")
        for p in pp:
            m = ms[p.module]
            if p.die not in m.allowed_dies:
                issue("error", "DIE_ASSIGNMENT", m.id, "模块所在 die 不在允许列表", "调整分区或 allowed_dies")
            if not outline.covers(shape(p)):
                issue("error", "OUT_OF_BOUNDS", m.id, "模块超出 die 边界", "移动模块或扩大 die")
            if shape(p).intersection(reserve).area > 1e-6:
                issue("error", "RESERVED_OVERLAP", m.id, "模块侵入 TSV 预留区或禁布区", "移动模块并保留布线通道")
            required = m.stdcell_area_um2/m.target_cell_utilization + m.macro_area_um2
            footprint = p.width_um*p.height_um
            logic_space = footprint-m.macro_area_um2
            cell_util = m.stdcell_area_um2/logic_space if logic_space > 0 else (0 if m.stdcell_area_um2 == 0 else None)
            if footprint + 1e-6 < required:
                issue("error", "MODULE_AREA", m.id, f"需要 {required:.1f} um²，可用 {footprint:.1f} um²", "增大模块外形或降低资源需求；硬宏面积不除以利用率")
            if not m.area_known:
                cell_util=None
                issue('unknown','MODULE_AREA_UNKNOWN',m.id,'仅为布局占位，标准单元/硬宏面积未提供','补充模块面积后再判断可实现性')
            density = None if m.power_W is None else m.power_W/(footprint/1e6)
            if m.power_W is None:
                issue("unknown", "POWER_UNKNOWN", m.id, "缺少功耗数据", "输入功耗预算或校准后的估算功耗")
            elif con.max_power_density_W_mm2 is not None and density > con.max_power_density_W_mm2:
                issue("error", "POWER_DENSITY", m.id, f"功耗密度 {density:.2f} W/mm² 超过约束", "扩大散热面积、降低功耗或改变分区")
            module_rows.append(dict(id=m.id, die=d.id, kind=m.kind, core=m.core, shared_cores=m.shared_cores, **p.model_dump(exclude={"module", "die"}), stdcell_area_um2=m.stdcell_area_um2 if m.area_known else None, macro_area_um2=m.macro_area_um2 if m.area_known else None, required_footprint_um2=required if m.area_known else None, footprint_um2=footprint, cell_utilization=cell_util, target_cell_utilization=m.target_cell_utilization, utilization_basis=m.utilization_basis, power_W=m.power_W, power_density_W_mm2=density, metrics=m.metrics.model_dump(), provenance=m.provenance))
        for i, p in enumerate(pp):
            for q in pp[i+1:]:
                if shape(p).intersection(shape(q)).area > 1e-6:
                    issue("error", "MODULE_OVERLAP", p.module+" / "+q.module, "模块矩形发生重叠", "移动模块或运行自动规划")
        occupied_shape = unary_union([shape(p) for p in pp]).intersection(outline)
        occupied = occupied_shape.area
        occupied_usable = occupied_shape.difference(reserve).area
        reserved = reserve.intersection(outline).area
        free = outline.area-reserved
        occupancy = occupied_usable/free if free > 0 else None
        used_power = sum(ms[p.module].power_W or 0 for p in pp)
        power = None if any(ms[p.module].power_W is None for p in pp) else used_power
        if outline.area/1e6 > con.die_area_limit_mm2:
            issue("error", "DIE_AREA", d.id, "die 面积超过限制", "缩小外形或增加分区")
        if occupancy is None or occupancy > d.max_utilization:
            issue("error", "DIE_UTILIZATION", d.id, "模块占地比例超过上限", "迁移模块或调整 die 外形")
        if power is not None and d.power_budget_W is not None and power > d.power_budget_W:
            issue("error", "POWER_BUDGET", d.id, f"功耗 {power:.3f} W 超过预算 {d.power_budget_W:.3f} W", "分散高功耗模块或降低功耗")
        if d.power_budget_W is None:
            issue("unknown", "POWER_BUDGET_UNKNOWN", d.id, "未配置 die 功耗预算", "补充功耗预算以完成实现性评估")
        die_rows.append(dict(**d.model_dump(), z_um=z_um[d.id], area_mm2=None if d.display_platform else outline.area/1e6, module_area_mm2=occupied/1e6, usable_module_area_mm2=occupied_usable/1e6, reserved_overlap_mm2=(occupied-occupied_usable)/1e6, reserved_area_mm2=reserved/1e6, free_area_mm2=max(0, free-occupied_usable)/1e6, footprint_utilization=occupancy, power_W=power, power_margin_W=None if power is None or d.power_budget_W is None else d.power_budget_W-power))
    spacing_rows=check_spacing(project,issue)
    for g in groups(project):
        if len({placements[x].die for x in g}) > 1:
            issue("error", "GROUP_SPLIT", ", ".join(g), "同组模块跨越多个 die", "保持组内模块在同一 die")
    ordered = sorted(a.dies, key=lambda d: d.order)
    interfaces = []
    for i in range(len(ordered)-1):
        lo, hi = ordered[i:i+2]
        regions = [r for r in f.tsv_regions if r.lower_die == lo.id and r.upper_die == hi.id]
        if not regions:
            interfaces.append(dict(id=f"{lo.id}__{hi.id}", boundary=i, region_id=None,
                lower_die=lo.id, upper_die=hi.id, region=None, capacity=None, signal_vias=0, links=[]))
        for region in regions:
            interfaces.append(dict(id=region.id, boundary=i, region_id=region.id,
                lower_die=lo.id, upper_die=hi.id, region=region.model_dump(),
                capacity=interface_capacity(project, region), interconnect=region.interconnect, orientation=region.orientation, budget_paths=region.budget_paths, signal_vias=0, links=[]))
    for region in f.tsv_regions:
        if region.signal_budget_bits is not None:
            issue('unknown','INTERFACE_BREAKDOWN',region.id,'仅提供整片接口总位宽，模块级分配与方向拆分尚未定义','补充细分通路、频率、协议及实际引脚分配；当前不推导吞吐率')
    # Endpoints are module boundary ports; intermediate interfaces remain TSV region centers.
    link_rows = []
    weighted_length = 0
    for l in a.links:
        p,q=placements[l.source],placements[l.target]
        i,j=ds[p.die].order,ds[q.die].order
        routed=route_link(l,placements,ms,ordered,f.tsv_regions,con.routing_channels)
        segments=routed['routes']
        for via in routed['vertical']:
            boundary=next(row for row in interfaces
                if row['boundary']==via['boundary'] and row['region_id']==via['region_id'])
            boundary['signal_vias']+=l.wires
            boundary['links'].append(l.id)
            if via['missing_region']:
                issue('error','TSV_REGION_MISSING',boundary['id'],'跨层连接没有对应 TSV 预留区','为每个经过的相邻 die 接口定义 TSV 区域')
        if not routed['endpoint_escape_valid']:
            issue('warning','ENDPOINT_ESCAPE',l.id,'起终端区域冲突，边缘路径无法避开端点模块内部','先修复模块重叠或 TSV 预留区侵占；当前路径仅供诊断')
        length = sum(abs(t[0]-s[0])+abs(t[1]-s[1]) for seg in segments for s, t in zip(seg["points"], seg["points"][1:]))
        weighted_length += length*l.wires
        if l.required_lanes is None:
            issue('unknown', 'LINK_RATE_UNKNOWN', l.id, '线数已提供，带宽需求或每线速率未提供', '当前按显式线数评估布线；补充速率后再验证吞吐能力')
        if l.data_wires is not None and l.required_lanes is not None and l.data_wires < l.required_lanes:
            issue("error", "LINK_BANDWIDTH", l.id, "显式数据线数量不足以承载需求带宽", "增加并行线数或提高每线速率")
        if l.max_tier_hops is not None and abs(i-j) > l.max_tier_hops:
            issue("error", "TIER_HOPS", l.id, "跨层数超过限制", "调整模块所属 die")
        if l.max_planar_length_um is not None and length > l.max_planar_length_um:
            issue("error", "WIRE_LENGTH", l.id, "平面估计线长超过限制", "将模块靠近相应端口或 TSV 区域")
        link_rows.append(dict(id=l.id, source=l.source, target=l.target, source_port=l.source_port, target_port=l.target_port,
            provenance=l.provenance, bus_width_bits=l.bus_width_bits, data_wires=l.allocated_data_wires, control_wires=l.control_wires,
            spare_fraction=l.spare_fraction, spare_wires=l.spare_wires, wires=l.wires, required_data_lanes=l.required_lanes,
            data_wires_source="explicit" if l.data_wires is not None else "bandwidth_derived",
            lane_rate_Gbps=l.lane_rate_Gbps, bandwidth_GBps=l.bandwidth_GBps, planar_length_um=length, tier_hops=abs(i-j),
            metal_reference=[m.model_dump() for m in res.metals], endpoints=routed["endpoints"], endpoint_escape_valid=routed["endpoint_escape_valid"]))
        route_segments.extend(segments)
    for row in interfaces:
        region=next((r for r in f.tsv_regions if r.id==row['region_id']),None)
        row['modeled_signal_vias'] = row['signal_vias']
        row['unallocated_signal_budget'] = max(0, (region.signal_budget_bits or 0) - row['signal_vias']) if region else 0
        if region and region.signal_budget_bits is not None:
            if row['signal_vias']>region.signal_budget_bits:issue('error','INTERFACE_BUDGET',row['id'],'细分连线需求超过接口总位宽预算','调整接口预算或连线分配')
            row['signal_vias']=max(row['signal_vias'],region.signal_budget_bits)
    local, demands, unknown_supply, boundary_power, local_unknown = supply_account(project, placements)
    supply_rows = []
    for (die, domain), current in demands.items():
        ports = [p for p in f.supply_ports if p.die == die and p.domain == domain]
        capacity = None if any(p.max_current_A is None for p in ports) else sum(p.max_current_A for p in ports)
        is_unknown = (die, domain) in unknown_supply
        if not ports:
            issue("error", "SUPPLY_MISSING", die+":"+domain, "没有匹配的供电端口", "补充电压域对应的供电端口")
        elif capacity is None:
            issue('unknown','SUPPLY_CAPACITY_UNKNOWN',die+':'+domain,'供电入口能力未知','补充端口电流能力；不能把未知当作充足')
        elif not is_unknown and current > capacity:
            issue("error", "SUPPLY_CAPACITY", die+":"+domain, f"需要 {current:.3f} A，端口能力 {capacity:.3f} A", "增加供电端口能力或降低功耗")
        if is_unknown:
            issue("unknown", "SUPPLY_UNKNOWN", die+":"+domain, "功耗缺失，无法确定供电电流", "补充功耗")
        supply_rows.append(dict(die=die, domain=domain, local_current_A=None if (die, domain) in local_unknown else local.get((die, domain), 0), injection_current_A=None if is_unknown else current, capacity_A=capacity, margin_A=None if is_unknown or capacity is None else capacity-current))
    for port in f.supply_ports:
        d = ds[port.die]
        if port.x_um > d.width_um or port.y_um > d.height_um:
            issue("error", "SUPPLY_BOUNDS", port.id, "供电端口超出 die", "调整端口位置")
        if port.feed == "stack_base":
            base_ports = [p for p in f.supply_ports if p.die == ordered[0].id and p.domain == port.domain and p.feed == "external"]
            if not base_ports or not math.isclose(port.voltage_V, ordered[0].voltage_V):
                issue("error", "SUPPLY_PATH", port.id, "缺少同电压域的底层供电入口", "配置同电压域外部供电或将该 die 改为独立外部供电")
    detailed_supply=supply_groups(project,placements,issue)
    power_regions=region_power(project,placements,interfaces,boundary_power,issue)
    for row in interfaces:
        power = power_regions[row['id']]
        row.update(power)
        row["total_vias"] = None if power["power_vias"] is None else row["signal_vias"]+power["power_vias"]+power["ground_vias"]
        row["margin"] = None if row["capacity"] is None or row["total_vias"] is None else row["capacity"]-row["total_vias"]
        if row["total_vias"] is None or row["capacity"] is None:
            issue("unknown", "TSV_UNKNOWN", row["id"], "TSV 工艺、区域或功耗信息不足", "补充缺失输入；预留区域不等于已分配 TSV")
        elif row["margin"] < 0:
            issue("error", "TSV_CAPACITY", row["id"], f"接口需要 {row['total_vias']} 个站点，可用 {row['capacity']} 个", "增大 TSV 区域、减少跨层通信或调整供电")
    metal_routing=allocate_metals(project,route_segments,issue)
    maps=metal_routing['congestion']
    for row in die_rows:
        grid=next(g for g in maps if g['die']==row['id'])
        row['peak_congestion']=grid['peak_ratio']
        ratios=np.array(grid['values']) if grid['values'] is not None else None
        for module in module_rows:
            if module['die']!=row['id']:continue
            module['halo_um']=ms[module['id']].halo_um
            dx,dy=grid['grid_width_um'],grid['grid_height_um']
            left=max(0,min(n-1,int(module['x_um']/dx)))
            right=max(left+1,min(n,math.ceil((module['x_um']+module['width_um'])/dx)))
            bottom=max(0,min(n-1,int(module['y_um']/dy)))
            top=max(bottom+1,min(n,math.ceil((module['y_um']+module['height_um'])/dy)))
            module['peak_congestion']=None if ratios is None else float(ratios[bottom:top,left:right].max())
    if not res.metals:
        issue('unknown','ROUTING_UNKNOWN',a.chip,'未提供金属层资源','补充金属层 width / pitch / availability')
    delay=res.delay_model
    for row in link_rows:
        definition=ms.get(row['source'])
        link=next(l for l in a.links if l.id==row['id'])
        row['latency_weight']=link.latency_weight
        row['estimated_delay_ps']=None if delay is None else row['planar_length_um']*delay.planar_ps_per_um+row['tier_hops']*delay.tier_ps
    timing=dict(model=None if delay is None else delay.model_dump(),
        weighted_delay_ps=None if delay is None else sum(r['estimated_delay_ps']*r['latency_weight'] for r in link_rows),
        max_link_delay_ps=None if delay is None else max((r['estimated_delay_ps'] for r in link_rows),default=0),
        scope='有效平面延迟系数×边缘路径长度 + 相邻层接口延迟×跨层数；不含排队、串行化、算子执行或时序签核。未校准参数仅用于方案比较。')
    reference_rows = []
    for g in a.reference_groups:
        footprint = sum(placements[mid].width_um * placements[mid].height_um for mid in g.modules)
        # Combined cell/macro estimates are only a lower bound. Do not divide them
        # by a standard-cell target, or sum overlapping source groups as die area.
        fits = None if g.area_estimate_um2 is None else footprint >= g.area_estimate_um2
        reference_rows.append(dict(**g.model_dump(), placed_footprint_um2=footprint, minimum_area_fits=fits))
        if fits is False:
            issue('error', 'REFERENCE_AREA_LOWER_BOUND', ' / '.join(g.modules),
                  f'{g.label} 参考资源面积 {g.area_estimate_um2 / 1e6:.4f} mm² 已超过当前模块占地 {footprint / 1e6:.4f} mm²',
                  '增大规划区域；参考面积未拆分标准单元与宏，仍需补充详细面积和利用率约束')
    errors = sum(x["severity"] == "error" for x in issues)
    unknowns = sum(x["severity"] == "unknown" for x in issues)
    fingerprint = hashlib.sha256(project.model_dump_json().encode()).hexdigest()[:16]
    power_total = None if any(m.power_W is None for m in a.modules) else sum(m.power_W for m in a.modules)
    wiring, by_link, by_die = estimate_wiring(project,metal_routing["allocated_routes"])
    wiring['model']='allocated_segment_demand'
    wiring['notes']=['按已分配金属层逐段统计线数、线宽、pitch 与面积；同一段的各层线数之和等于连接物理线数。','自动按输入层顺序分配剩余轨道；routing_layers 限制允许层，area_reference 仅影响自动选择优先级。','逐层拥塞 = 该层网格内线数×长度占比 / floor(横向网格尺寸÷pitch×可用比例)。通道另按截面同时经过的完整线数检查。','分配为架构级预算，尚未详细分轨、布线绕障、校验转层过孔和引脚接入；多层面积不等于额外 die 占地。']
    for row in link_rows:
        row['physical_width_status']='layer_budget_incomplete' if any(u['link']==row['id'] for u in metal_routing['unassigned']) else 'layer_budget_allocated'
        row['wire_area'] = by_link[row['id']]
    for row in die_rows:
        row['wire_area'] = by_die[row['id']]
    from . import __version__
    report = dict(schema_version="resim-report/0.1", simulator_version=__version__, plan_id=fingerprint, name=project.name,
        status="violations" if errors else "incomplete" if unknowns else "within_model_constraints",
        summary=dict(weighted_delay_ps=timing["weighted_delay_ps"],errors=errors, unknowns=unknowns, module_count=len(ms), die_count=len(ds), power_W=power_total, total_die_area_mm2=sum(r["area_mm2"] or 0 for r in die_rows), total_module_footprint_mm2=sum(m["footprint_um2"] for m in module_rows)/1e6, weighted_wirelength_um=weighted_length, signal_via_segments=sum(i["signal_vias"] for i in interfaces if i.get("interconnect","TSV")=="TSV"), signal_hb_sites=sum(i["signal_vias"] for i in interfaces if i.get("interconnect")=="HB"), total_via_segments=None if any(i["total_vias"] is None for i in interfaces) else sum(i["total_vias"] for i in interfaces), peak_congestion=None if any(r["peak_congestion"] is None for r in die_rows) else max((r["peak_congestion"] for r in die_rows), default=None)),
        reference_groups=reference_rows, timing=timing, supply_groups=detailed_supply, wiring=wiring, metal_routing=metal_routing, spacing=spacing_rows, routing_channels=[c.model_dump() for c in con.routing_channels], dies=die_rows, modules=module_rows, links=link_rows, interfaces=interfaces, supply=supply_rows, ports=[p.model_dump() for p in f.supply_ports], blockages=[b.model_dump() for b in con.blockages], routes=route_segments, congestion=maps, issues=issues,
        assumptions=["架构级估算，未进行网表综合、详细布线、时序、IR drop、热传导或签核。", "功耗热图显示 W/mm²，不代表温度。", "每条链路按独占并行线路预算；不自动复用总线。跨层链路逐接口计数。", "信号数量含控制线和冗余；供电与地分别按电流上取整，站点使用 max(TSV pitch, bond pitch)。", "供电采用各 die 独立外部供电或从底层向上供电的简化拓扑。", "模块间路径从边界端口出发；未给端口位置时自动选择朝向对端或 TSV 的边中点。绑定通道的连接经过通道中心线；只避开端点模块内部，未进行全局绕障。", "拥塞按已分配金属层独立计算，采用网格内长度加权需求；通道另检查完整线束的同时占轨。金属可用比例估计宏遮挡和 PDN 占用。", "不同 die 共用输入工艺参数；示例 DRAM 面积/金属/功耗不是公开 DRAM 工艺标定值。", "寻优保持模块长宽、TSV 区域和供电端口固定；模块不可细分，分区指整个模块迁移。"] + res.notes,
        provenance=dict(technology=res.technology, source=res.technology_provenance, tsv=None if not res.tsv else res.tsv.provenance), project=project.model_dump())
    from .explain import explain_metrics
    report['summary'].update(metal_overflow_cells=sum(r['overflow_cells'] for r in metal_routing['layers']), unassigned_segments=len(metal_routing['unassigned']), channel_violations=sum(not r['passed'] for r in metal_routing['channels']), spacing_violations=sum(not r['passed'] for r in spacing_rows))
    report['summary'].update(wiring_metal_area_um2=wiring['metal_area_um2'],wiring_track_area_um2=wiring['track_area_um2'])
    report['calculations'] = explain_metrics(report)
    if a.links and any(r['unallocated_signal_budget'] for r in interfaces):
        report['routing_status'] = 'partial_connections'
        scope = '接口总预算尚未全部分配到模块连接；线长、金属面积和拥塞仅覆盖已录入连接，不能作为整片完整布线结论。'
        report['wiring']['notes'].append(scope)
        report['assumptions'].append(scope)
    if not a.links and any(r.signal_budget_bits is not None for r in f.tsv_regions):
        for key in ['weighted_delay_ps','weighted_wirelength_um','peak_congestion']:
            report['summary'][key]=None
        for d in report['dies']:d['peak_congestion']=None
        for m in report['modules']:m['peak_congestion']=None
        report['routing_status']='aggregate_budget_only'
    from .methodology import describe_methods
    report['methodology'] = describe_methods(project)
    return report
