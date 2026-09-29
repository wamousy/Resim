"""Segment-based interconnect area demand, not a detailed routing solution."""
from collections import defaultdict

AREA_KEYS = ('metal_area_um2','track_area_um2','bundle_envelope_area_um2')


def total(rows, key):
    values = [r[key] for r in rows]
    return None if any(v is None for v in values) else sum(values)


def estimate_wiring(project, routes):
    links = {link.id: link for link in project.architecture.links}
    pieces = []
    for route in routes:
        link = links[route['link']]
        for start,end in zip(route['points'],route['points'][1:]):
            length = abs(end[0]-start[0])+abs(end[1]-start[1])
            if not length:
                continue
            direction = 'HORIZONTAL' if start[1] == end[1] else 'VERTICAL'
            requested = link.area_reference.horizontal if direction == 'HORIZONTAL' else link.area_reference.vertical
            assigned='assigned_metal' in route
            metal = next((m for m in project.resources.metals if m.name==route['assigned_metal']),None) if assigned else next((m for m in project.resources.metals if m.direction == direction and (requested is None or m.name == requested)),None)
            count = route.get('wires',link.wires)
            width,pitch = (metal.width_um,metal.pitch_um) if metal else (None,None)
            envelope = ((count-1)*pitch+width if count else 0) if metal else (0 if count == 0 else None)
            row = dict(link=link.id, die=route['die'], direction=direction, start=start, end=end,
                length_um=length, wires=count, reference_metal=metal.name if metal else None,
                reference_source=route.get('allocation_source') if assigned else 'input_reference' if requested else 'first_directional_metal' if metal else 'missing',
                assigned_metal=metal.name if assigned and metal else None,segment_id=route.get('segment_id'),
                width_um=width, pitch_um=pitch, bundle_width_um=envelope,
                metal_area_um2=count*width*length if metal else (0 if count == 0 else None),
                track_area_um2=count*pitch*length if metal else (0 if count == 0 else None),
                bundle_envelope_area_um2=None if envelope is None else envelope*length)
            pieces.append(row)
    by_layer = defaultdict(list)
    for piece in pieces:
        by_layer[(piece['die'],piece['reference_metal'])].append(piece)
    layers = [dict(die=die,reference_metal=metal,**{key:total(rows,key) for key in AREA_KEYS},
        weighted_length_um=sum(r['length_um']*r['wires'] for r in rows)) for (die,metal),rows in by_layer.items()]
    by_link = {link.id:dict(segments=[p for p in pieces if p['link']==link.id],
        **{key:total([p for p in pieces if p['link']==link.id],key) for key in AREA_KEYS}) for link in project.architecture.links}
    by_die = {die.id:{key:total([p for p in pieces if p['die']==die.id],key) for key in AREA_KEYS} for die in project.architecture.dies}
    return dict(model='reference_segment_demand',segments=pieces,layers=layers,
        **{key:total(pieces,key) for key in AREA_KEYS},
        unknown_segment_count=sum(p['metal_area_um2'] is None for p in pieces),
        notes=[
            '按模块边缘端口之间的 Manhattan 路径逐段计算；跨层经 TSV 区域中心。水平、垂直段分别引用对应方向金属层。',
            'area_reference 可指定面积参考层；未指定时使用工艺列表中第一个同方向层。此选择不分配实际布线层。',
            '金属面积需求 = Σ N×w×L；轨道面积预算 = Σ N×pitch×L；线束包络宽 = (N−1)×pitch+w。',
            '这是逐段需求相加，不是布线多边形并集，也不是新增 die 占地。不同层可有相同平面投影。',
            '不含模块内部布线、PDN、时钟树、屏蔽、绕障、转角补偿和层间接触孔焊盘面积；TSV 另列。',
            '拥塞仍使用全部同方向层的汇总容量，面积参考层不改变该容量模型。'
        ]), by_link, by_die
