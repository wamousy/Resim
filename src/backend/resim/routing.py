"""Boundary port estimates and rectilinear escape paths; not detailed routing."""


def center(rect):
    return [rect.x_um+rect.width_um/2, rect.y_um+rect.height_um/2]


def anchor(rect, toward, location=None, fallback='east'):
    c=center(rect)
    if location:
        side, offset=location.side, location.offset
    else:
        dx,dy=toward[0]-c[0],toward[1]-c[1]
        side=(('east' if dx>=0 else 'west') if abs(dx)*rect.height_um>=abs(dy)*rect.width_um else ('north' if dy>=0 else 'south')) if dx or dy else fallback
        offset=.5
    x,y=rect.x_um,rect.y_um
    point={'east':[x+rect.width_um,y+offset*rect.height_um], 'west':[x,y+offset*rect.height_um],
           'north':[x+offset*rect.width_um,y+rect.height_um], 'south':[x+offset*rect.width_um,y]}[side]
    return dict(point=point,side=side,offset=offset,source='specified_port' if location else 'automatic_edge_midpoint')


def _crosses_interior(a,b,r):
    left,bottom=r.x_um,r.y_um
    right,top=left+r.width_um,bottom+r.height_um
    if a[1]==b[1]:
        return bottom+1e-9<a[1]<top-1e-9 and max(min(a[0],b[0]),left)<min(max(a[0],b[0]),right)-1e-9
    return left+1e-9<a[0]<right-1e-9 and max(min(a[1],b[1]),bottom)<min(max(a[1],b[1]),top)-1e-9


def escape_path(start,end,rectangles):
    choices=[[start,[end[0],start[1]],end],[start,[start[0],end[1]],end]]
    xs=[(start[0]+end[0])/2]+[v for r in rectangles for v in [r.x_um,r.x_um+r.width_um]]
    ys=[(start[1]+end[1])/2]+[v for r in rectangles for v in [r.y_um,r.y_um+r.height_um]]
    choices += [[start,[x,start[1]],[x,end[1]],end] for x in xs]
    choices += [[start,[start[0],y],[end[0],y],end] for y in ys]
    clean=[]
    for path in choices:
        points=[path[0]]+[b for a,b in zip(path,path[1:]) if a!=b]
        valid=not any(_crosses_interior(a,b,r) for a,b in zip(points,points[1:]) for r in rectangles)
        length=sum(abs(a[0]-b[0])+abs(a[1]-b[1]) for a,b in zip(points,points[1:]))
        clean.append((not valid,length,len(points),points))
    # Stable tie break preserves the same convention in the browser draft renderer.
    best=min(enumerate(clean),key=lambda row:row[1][:3]+(row[0],))[1]
    return best[3],not best[0]


def route_link(link,placements,modules,ordered,regions,channels=()):
    p,q=placements[link.source],placements[link.target]
    orders={d.id:d.order for d in ordered}
    i,j=orders[p.die],orders[q.die]
    vertical=[]
    if i!=j:
        step=1 if j>i else -1
        for k in range(i,j,step):
            lower,upper=ordered[min(k,k+step)].id,ordered[max(k,k+step)].id
            candidates=[r for r in regions if r.lower_die==lower and r.upper_die==upper]
            source_core=modules[link.source].core
            target_core=modules[link.target].core
            owned=[r for r in candidates if r.core is not None and r.core in (source_core,target_core)]
            pool=owned or candidates
            midpoint=[(a+b)/2 for a,b in zip(center(p),center(q))]
            region=min(pool,key=lambda r:sum(abs(a-b) for a,b in zip(center(r),midpoint)),default=None)
            point=center(region) if region else [(a+b)/2 for a,b in zip(center(p),center(q))]
            vertical.append(dict(link=link.id,lower_die=lower,upper_die=upper,point=point,boundary=min(k,k+step),region_id=region.id if region else None,missing_region=region is None))
    source=anchor(p,vertical[0]['point'] if vertical else center(q),modules[link.source].port_locations.get(link.source_port),'east')
    target=anchor(q,vertical[-1]['point'] if vertical else center(p),modules[link.target].port_locations.get(link.target_port),'west')
    routes=[]
    channel=next((c for c in channels if link.id in c.links and p.die==q.die==c.die),None)
    valid=True
    def segment(die,a,b,obstacles):
        nonlocal valid
        if channel:
            from .physical import channel_path
            points,escaped=channel_path(channel,a,b,obstacles)
        else:
            points,escaped=escape_path(a,b,obstacles)
        valid=valid and escaped
        if len(points)>1:
            routes.append(dict(die=die,link=link.id,wires=link.wires,points=points))
    if not vertical:
        segment(p.die,source['point'],target['point'],[p,q])
    else:
        cursor=source['point'];step=1 if j>i else -1
        for n,via in enumerate(vertical):
            segment(ordered[i+n*step].id,cursor,via['point'],[p] if n==0 else [])
            cursor=via['point']
        segment(q.die,cursor,target['point'],[q])
    return dict(routes=routes,vertical=vertical,endpoints=dict(source=dict(die=p.die,**source),target=dict(die=q.die,**target)),endpoint_escape_valid=valid)
