"""Core-owned supply entry budgets. Does not model a PDN, IR drop or bumps."""
import math


def supply_groups(project, placements, issue):
    dies=sorted(project.architecture.dies,key=lambda d:d.order)
    ports=project.floorplan.supply_ports
    modules=project.architecture.modules
    groups=[]
    for die in dies:
        domains={m.voltage_domain for m in modules if placements[m.id].die==die.id}
        for domain in domains:
            candidates=[p for p in ports if p.die==die.id and p.domain==domain]
            if not any(p.core is not None for p in candidates):
                continue  # Legacy shared budgets remain in report.supply.
            cores={m.core for m in modules if placements[m.id].die==die.id and m.voltage_domain==domain}
            cores.update(p.core for p in candidates)
            for core in sorted(cores):
                owned=[p for p in candidates if p.core==core]
                loads=[(m,die) for m in modules if m.core==core and m.voltage_domain==domain and placements[m.id].die==die.id]
                if die.order==0:
                    for upper in dies[1:]:
                        if any(p.die==upper.id and p.domain==domain and p.core==core and p.feed=='stack_base' for p in ports):
                            loads.extend((m,upper) for m in modules if m.core==core and m.voltage_domain==domain and placements[m.id].die==upper.id)
                demand=None if any(m.power_W is None for m,d in loads) else sum(m.power_W/d.voltage_V for m,d in loads)
                capacity=None if any(p.max_current_A is None for p in owned) else sum(p.max_current_A for p in owned)
                subject=f'{die.id}:{domain}:{core}'
                if not owned:
                    issue('error','SUPPLY_CORE_MISSING',subject,'本核缺少供电入口，不能借用其它核的端口能力','补充本核供电端口')
                elif capacity is None:
                    issue('unknown','SUPPLY_CORE_CAPACITY_UNKNOWN',subject,'本核供电端口能力未标定','填写封装/电源网络确认的电流预算')
                elif demand is not None and demand>capacity:
                    issue('error','SUPPLY_CORE_CAPACITY',subject,f'本核需要 {demand:g} A，入口只有 {capacity:g} A','增大本核入口能力或降低功耗')
                for port in owned:
                    if port.feed=='stack_base' and not any(p.die==dies[0].id and p.domain==domain and p.core==core and p.feed=='external' for p in ports):
                        issue('error','SUPPLY_CORE_PATH',port.id,'缺少同核底层供电入口','补充同核、同电压域底层入口')
                groups.append(dict(die=die.id,domain=domain,core=core,ports=[p.id for p in owned],feed=owned[0].feed if owned else None,demand_A=demand,capacity_A=capacity,margin_A=None if demand is None or capacity is None else capacity-demand))
    return groups


def region_power(project, placements, interfaces, fallback, issue):
    """Allocate stack supply exactly once per owning core and boundary."""
    modules=project.architecture.modules
    dies={d.id:d for d in project.architecture.dies}
    ports=project.floorplan.supply_ports
    result={}
    for boundary in sorted({r['boundary'] for r in interfaces}):
        rows=[r for r in interfaces if r['boundary']==boundary]
        owned=any(p.core is not None and p.feed=='stack_base' for p in ports)
        if not owned:
            for i,row in enumerate(rows):
                result[row['id']]=fallback[boundary] if i==0 else dict(current_A=0,power_vias=0,ground_vias=0)
            if len(rows)>1 and fallback[boundary]['power_vias'] not in (None,0):
                issue('warning','SUPPLY_REGION_AGGREGATE',rows[0]['id'],'共享供电预算保守计入首个 TSV 区域，未指定核归属','为供电端口和 TSV 区域添加 core')
            continue
        for row in rows:result[row['id']]=dict(current_A=0,power_vias=0,ground_vias=0)
        for core in {m.core for m in modules}:
            loads=[m for m in modules if m.core==core and dies[placements[m.id].die].order>boundary and any(p.die==placements[m.id].die and p.domain==m.voltage_domain and p.feed=='stack_base' and p.core in (None,core) for p in ports)]
            if not loads:continue
            selected=next((r for r in rows if r['region'] and r['region'].get('core')==core),None)
            if selected is None:
                issue('error','SUPPLY_TSV_REGION',core,f'接口 {boundary} 缺少本核供电 TSV 区域','补充相同 core 的 TSV 区域')
                selected=rows[0]  # Keep demand visible even in invalid input.
            current=None if any(m.power_W is None for m in loads) else sum(m.power_W/dies[placements[m.id].die].voltage_V for m in loads)
            vias=None if current is None or project.resources.tsv is None else math.ceil(current*1000/project.resources.tsv.max_current_mA)
            target=result[selected['id']]
            for key,value in [('current_A',current),('power_vias',vias),('ground_vias',vias)]:
                target[key]=None if target[key] is None or value is None else target[key]+value
    return result
