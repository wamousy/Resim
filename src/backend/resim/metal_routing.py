"""Deterministic layer/track budgeting over fixed rectilinear paths, not detailed routing."""
import math
import numpy as np


def availability(project, metal):
    return project.resources.routing_availability if metal.availability is None else metal.availability


def cells(start,end,die,n):
    dx,dy=die.width_um/n,die.height_um/n
    horizontal=start[1]==end[1]
    axis=0 if horizontal else 1
    step=dx if horizontal else dy
    fixed=min(n-1,max(0,int(start[1-axis]/(dy if horizontal else dx))))
    lo,hi=sorted((start[axis],end[axis]))
    result=[]
    for index in range(n):
        length=max(0,min(hi,(index+1)*step)-max(lo,index*step))
        if length>1e-9:
            result.append((fixed,index,length/step) if horizontal else (index,fixed,length/step))
    return result


def channel_overlap(channel,die,direction,start,end):
    if channel.die!=die or channel.direction!=direction:return None
    axis=0 if direction=='HORIZONTAL' else 1
    cross=start[1-axis]
    low=channel.y_um if axis==0 else channel.x_um
    width=channel.height_um if axis==0 else channel.width_um
    if not low-1e-9<=cross<=low+width+1e-9:return None
    begin=channel.x_um if axis==0 else channel.y_um
    length=channel.width_um if axis==0 else channel.height_um
    a,b=max(min(start[axis],end[axis]),begin),min(max(start[axis],end[axis]),begin+length)
    return (a,b) if b-a>1e-9 else None


def allocate_metals(project,routes,issue):
    """Each segment conserves its full wire count. Overflow is retained and reported."""
    n=project.search.congestion_grid
    dies={d.id:d for d in project.architecture.dies}
    links={l.id:l for l in project.architecture.links}
    metals=project.resources.metals
    grids={(d.id,m.name):np.zeros((n,n)) for d in dies.values() for m in metals}
    capacities={(d.id,m.name):math.floor(((d.height_um if m.direction=='HORIZONTAL' else d.width_um)/n)/m.pitch_um*availability(project,m)+1e-9) for d in dies.values() for m in metals}
    allocated=[];unassigned=[];segments=[]
    for route in routes:
        for start,end in zip(route['points'],route['points'][1:]):
            if start==end:continue
            direction='HORIZONTAL' if start[1]==end[1] else 'VERTICAL'
            segments.append((route,start,end,direction))
    # Restricted links first; stable tie-breaking makes identical input reproducible.
    segments.sort(key=lambda s:(0 if links[s[0]['link']].routing_layers.get(s[3].lower()) else 1,s[0]['link'],s[0]['die'],s[1],s[2]))
    for index,(route,start,end,direction) in enumerate(segments):
        die=dies[route['die']];link=links[route['link']]
        specified=link.routing_layers.get(direction.lower())
        candidates=[m for m in metals if m.direction==direction and (specified is None or m.name in specified)]
        corridors=[c for c in project.constraints.routing_channels if channel_overlap(c,die.id,direction,start,end)]
        candidates=[m for m in candidates if all(m.name in c.metals for c in corridors)]
        preferred=getattr(link.area_reference,direction.lower())
        candidates.sort(key=lambda m:(m.name!=preferred,metals.index(m)))
        enabled=[m for m in candidates if availability(project,m)>0]
        touched=cells(start,end,die,n)
        remaining=link.wires
        allocations=[]
        # Fill residual tracks, splitting the bus over available same-direction layers.
        for metal in enabled:
            capacity=capacities[die.id,metal.name]
            grid=grids[die.id,metal.name]
            room=min(((capacity-grid[y,x])/weight for y,x,weight in touched),default=capacity)
            for c in corridors:
                width=c.height_um if direction=='HORIZONTAL' else c.width_um
                overlap=channel_overlap(c,die.id,direction,start,end)
                existing={}
                for r in allocated:
                    if r['assigned_metal']!=metal.name or r['link']==link.id:continue
                    old=channel_overlap(c,r['die'],direction,*r['points'])
                    if old and max(old[0],overlap[0])<min(old[1],overlap[1])-1e-9:
                        existing[r['link']]=max(existing.get(r['link'],0),r['wires'])
                room=min(room,math.floor(width/metal.pitch_um*availability(project,metal)+1e-9)-sum(existing.values()))
            count=min(remaining,max(0,math.floor(room+1e-8)))
            if count:
                allocations.append([metal,count]);remaining-=count
                for y,x,weight in touched:grid[y,x]+=count*weight
            if not remaining:break
        if remaining and candidates:
            # Keep overflow on the least-loaded eligible layer; never discard demand.
            def projected(m):
                cap=capacities[die.id,m.name]
                return max(((grids[die.id,m.name][y,x]+remaining*w)/max(cap,1e-12) for y,x,w in touched),default=remaining/max(cap,1e-12))
            metal=min(enabled or candidates,key=projected)
            found=next((v for v in allocations if v[0].name==metal.name),None)
            if found:found[1]+=remaining
            else:allocations.append([metal,remaining])
            for y,x,w in touched:grids[die.id,metal.name][y,x]+=remaining*w
            remaining=0
        if remaining:
            unassigned.append(dict(link=link.id,die=die.id,direction=direction,wires=remaining,segment=index))
            issue('unknown' if not metals else 'error','METAL_UNASSIGNED',link.id,f'{die.id} {direction} 段有 {remaining} 根线没有可用金属层','检查 routing_layers 与通道允许层；补充该方向金属资源')
            allocated.append(dict(die=die.id,link=link.id,points=[start,end],wires=remaining,assigned_metal=None,allocation_source='unassigned',segment_id=index))
        for metal,count in allocations:
            allocated.append(dict(die=die.id,link=link.id,points=[start,end],wires=count,assigned_metal=metal.name,allocation_source='allowed_layers' if specified else 'automatic',segment_id=index))
    layers=[];maps=[]
    for d in dies.values():
        die_layers=[]
        for m in metals:
            grid=grids[d.id,m.name];cap=capacities[d.id,m.name]
            ratios=grid/cap if cap else np.zeros_like(grid)
            blocked=(grid>1e-9) if cap==0 else np.zeros_like(grid,dtype=bool)
            overloaded=(ratios>project.constraints.max_congestion_ratio+1e-9)|blocked
            y,x=np.unravel_index(grid.argmax(),grid.shape)
            peak=None if blocked.any() else float(ratios.max())
            contributors=sorted({r['link'] for r in allocated if r['die']==d.id and r['assigned_metal']==m.name and any(cy==y and cx==x for cy,cx,_ in cells(*r['points'],d,n))})
            row=dict(die=d.id,metal=m.name,direction=m.direction,availability=availability(project,m),width_um=m.width_um,pitch_um=m.pitch_um,capacity_tracks=cap,peak_demand_tracks=float(grid.max()),peak_ratio=peak,overflow_cells=int(overloaded.sum()),zero_capacity_demand=bool(blocked.any()),peak_cell=dict(x=int(x),y=int(y),demand_tracks=float(grid[y,x]),capacity_tracks=cap,links=contributors),values=ratios.tolist(),demand_values=grid.tolist(),size=n)
            layers.append(row);die_layers.append(row)
            if overloaded.any():
                issue('error','METAL_CAPACITY',d.id+':'+m.name,f'该层峰值需求 {grid.max():.3f} 轨道，容量 {cap}；{overloaded.sum()} 个网格超限','增加允许层、调整布局或通道、减少物理线数；不能借用未分配层的余量')
                for link_id in contributors[:3]:
                    issue('warning','CONGESTION_CONTRIBUTOR',link_id,f'经过 {d.id}/{m.name} 热点格 ({x},{y})','查看该连接的逐段金属分配及线数')
        missing=any(u['die']==d.id for u in unassigned)
        blocked=any(r['zero_capacity_demand'] for r in die_layers)
        values=np.maximum.reduce([np.array(r['values']) for r in die_layers]) if die_layers else np.zeros((n,n))
        peak=None if missing or blocked or not metals else float(values.max())
        worst=max(die_layers,key=lambda r:float('inf') if r['zero_capacity_demand'] else r['peak_ratio'],default=None)
        maps.append(dict(die=d.id,size=n,values=None if missing or blocked or not metals else values.tolist(),peak_ratio=peak,grid_width_um=d.width_um/n,grid_height_um=d.height_um/n,peak_layer=worst['metal'] if worst else None,peak_cell=worst['peak_cell'] if worst else None,model='per_metal_grid',zero_capacity_demand=blocked))
        if any(r['overflow_cells'] for r in die_layers):
            issue('error','CONGESTION',d.id,'至少一个独立金属层的网格容量超限','在逐金属层容量表中查看热点与贡献连接')
    channels=[]
    for c in project.constraints.routing_channels:
        width=c.height_um if c.direction=='HORIZONTAL' else c.width_um
        for name in c.metals:
            metal=next(m for m in metals if m.name==name)
            capacity=math.floor(width/metal.pitch_um*availability(project,metal)+1e-9)
            intervals={}
            for r in allocated:
                if r['assigned_metal']!=name:continue
                overlap=channel_overlap(c,r['die'],metal.direction,*r['points'])
                if overlap:intervals.setdefault(r['link'],[]).append((*overlap,r['wires']))
            positions=sorted({x for spans in intervals.values() for a,b,w in spans for x in (a,b)})
            peak=0;contributors=[]
            for a,b in zip(positions,positions[1:]):
                mid=(a+b)/2
                active={link:max((w for lo,hi,w in spans if lo<mid<hi),default=0) for link,spans in intervals.items()}
                demand=sum(active.values())
                if demand>peak:peak=demand;contributors=[k for k,v in active.items() if v]
            margin=capacity-peak
            channels.append(dict(channel=c.id,die=c.die,metal=name,direction=c.direction,width_um=width,min_width_um=c.min_width_um,capacity_tracks=capacity,demand_tracks=peak,margin_tracks=margin,ratio=peak/capacity if capacity else (None if peak else 0),links=contributors,passed=margin>=0 and width>=c.min_width_um))
            if margin<0:
                issue('error','CHANNEL_CAPACITY',c.id,f'{name} 通道同时需要 {peak} 根线，容量 {capacity} 根','扩大通道净宽、增加通道允许层或减少线数')
    return dict(allocated_routes=allocated,layers=layers,congestion=maps,channels=channels,unassigned=unassigned,model='layer_track_budget_v1')
