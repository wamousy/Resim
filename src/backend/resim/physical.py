"""Placement clearances and explicit reserved routing corridors, in micrometres."""
from shapely.geometry import box


def clearance(a, b, constraints):
    return max(constraints.min_module_spacing_um, a.halo_um+b.halo_um)


def rect(r, halo=0):
    return box(r.x_um-halo,r.y_um-halo,r.x_um+r.width_um+halo,r.y_um+r.height_um+halo)


def check_spacing(project, issue):
    modules={m.id:m for m in project.architecture.modules}
    rows=[]
    for die in project.architecture.dies:
        placements=[p for p in project.floorplan.placements if p.die==die.id]
        outline=box(0,0,die.width_um,die.height_um)
        for p in placements:
            halo=modules[p.module].halo_um
            window=modules[p.module].placement_window
            if window and not rect(window).covers(rect(p,halo)):
                issue('error','PLACEMENT_WINDOW',p.module,'模块或外围预留超出所属核的布局窗口','在核窗口内调整位置或修改窗口')
            if halo and not outline.covers(rect(p,halo)):
                issue('error','HALO_BOUNDS',p.module,f'外围预留 {halo:g} µm 超出 die 边界','移动模块或调整 halo / die 外形')
            reserves=[b for b in project.constraints.blockages if b.die==die.id]+[r for r in project.floorplan.tsv_regions if r.interconnect != "HB" and die.id in (r.lower_die,r.upper_die)]
            for r in reserves:
                if halo and rect(p,halo).intersection(rect(r)).area>1e-6:
                    issue('error','HALO_RESERVE',p.module,f'外围预留侵入 {r.id}','移动模块，保留外围预留距离')
            for c in project.constraints.routing_channels:
                if c.die==die.id and rect(p,halo).intersection(rect(c)).area>1e-6:
                    issue('error','CHANNEL_OCCUPIED',p.module,f'模块或外围预留侵入布线通道 {c.id}','移动模块；自动布局会保留通道')
        for i,p in enumerate(placements):
            for q in placements[i+1:]:
                required=clearance(modules[p.module],modules[q.module],project.constraints)
                gap_x=max(q.x_um-p.x_um-p.width_um,p.x_um-q.x_um-q.width_um)
                gap_y=max(q.y_um-p.y_um-p.height_um,p.y_um-q.y_um-q.height_um)
                actual=max(gap_x,gap_y,0)
                if required:
                    ok=max(gap_x,gap_y)+1e-7>=required
                    rows.append(dict(die=die.id,modules=[p.module,q.module],required_um=required,actual_um=actual,margin_um=actual-required,passed=ok))
                    if not ok:
                        issue('error','MODULE_SPACING',p.module+' / '+q.module,f'边到边距离 {actual:g} µm，小于要求 {required:g} µm','移动模块；要求取全局间距与两个 halo 之和的较大值')
    placements={p.module:p for p in project.floorplan.placements}
    for c in project.constraints.routing_channels:
        d=next(d for d in project.architecture.dies if d.id==c.die)
        if not box(0,0,d.width_um,d.height_um).covers(rect(c)):
            issue('error','CHANNEL_BOUNDS',c.id,'布线通道超出 die 边界','调整通道位置与尺寸')
        width=c.height_um if c.direction=='HORIZONTAL' else c.width_um
        if width+1e-7<c.min_width_um:
            issue('error','CHANNEL_WIDTH',c.id,f'通道净宽 {width:g} µm，小于要求 {c.min_width_um:g} µm','增大通道横向宽度')
        reserved=[b for b in project.constraints.blockages if b.die==c.die]+[r for r in project.floorplan.tsv_regions if r.interconnect != "HB" and c.die in (r.lower_die,r.upper_die)]
        if any(rect(c).intersection(rect(r)).area>1e-6 for r in reserved):
            issue('error','CHANNEL_RESERVED',c.id,'通道与禁布区或 TSV 预留区重叠','移动通道，避免将预留区重复当作可布线空间')
        for link in project.architecture.links:
            if link.id in c.links and any(placements[mid].die!=c.die for mid in [link.source,link.target]):
                issue('error','CHANNEL_DIE',link.id,f'绑定通道 {c.id} 要求起终模块都位于 {c.die}','调整归属或解除该连接的通道绑定')
    return rows


def channel_path(channel, start, end, obstacles):
    from .routing import escape_path
    if channel.direction=='HORIZONTAL':
        mid=channel.y_um+channel.height_um/2
        a,b=[channel.x_um,mid],[channel.x_um+channel.width_um,mid]
        axis=0
    else:
        mid=channel.x_um+channel.width_um/2
        a,b=[mid,channel.y_um],[mid,channel.y_um+channel.height_um]
        axis=1
    if start[axis]>end[axis]:a,b=b,a
    prefix,ok1=escape_path(start,a,obstacles)
    suffix,ok2=escape_path(b,end,obstacles)
    points=prefix+[b]+suffix[1:]
    return [points[0]]+[b for a,b in zip(points,points[1:]) if a!=b],ok1 and ok2
