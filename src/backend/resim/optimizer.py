"""Joint module-to-die partition and non-overlapping rectangular floorplanning."""
import math
import time
from ortools.sat.python import cp_model
from .schema import Placement
from .engine import evaluate, groups, interface_capacity, reserves
from .methodology import describe_methods
from .physical import clearance
from .metal_routing import availability


def optimize(project):
    start = time.monotonic()
    a, search = project.architecture, project.search
    ds = sorted(a.dies, key=lambda d: d.order)
    modules = {m.id: m for m in a.modules}
    original = {p.module: p for p in project.floorplan.placements}
    baseline = evaluate(project) if set(original) == set(modules) else None
    g = search.grid_um
    model = cp_model.CpModel()
    x, y, on, intervals, widths, heights = {}, {}, {}, {}, {}, {}
    max_dim = math.ceil(max(max(d.width_um, d.height_um) for d in ds)/g)
    for m in a.modules:
        w, h = math.ceil(m.width_um/g), math.ceil(m.height_um/g)
        halo=math.ceil(m.halo_um/g)
        widths[m.id], heights[m.id] = w, h
        x[m.id] = model.new_int_var(0, max_dim, f"x_{m.id}")
        y[m.id] = model.new_int_var(0, max_dim, f"y_{m.id}")
        if m.placement_window:
            region=m.placement_window
            model.add(x[m.id]>=math.ceil((region.x_um+m.halo_um)/g))
            model.add(y[m.id]>=math.ceil((region.y_um+m.halo_um)/g))
            model.add(x[m.id]+w<=math.floor((region.x_um+region.width_um-m.halo_um)/g))
            model.add(y[m.id]+h<=math.floor((region.y_um+region.height_um-m.halo_um)/g))
        if m.stdcell_area_um2/m.target_cell_utilization + m.macro_area_um2 > m.width_um*m.height_um+1e-6:
            return dict(baseline=baseline, candidates=[], search_status="input_geometry_infeasible", message=f"{m.id}: fixed module shape cannot contain declared resources", elapsed_s=time.monotonic()-start)
        for d in ds:
            b = model.new_bool_var(f"on_{m.id}_{d.id}")
            on[m.id, d.id] = b
            if d.id not in m.allowed_dies:
                model.add(b == 0)
            model.add(x[m.id]>=halo).only_enforce_if(b)
            model.add(y[m.id]>=halo).only_enforce_if(b)
            model.add(x[m.id]+w+halo <= math.floor(d.width_um/g)).only_enforce_if(b)
            model.add(y[m.id]+h+halo <= math.floor(d.height_um/g)).only_enforce_if(b)
            ix = model.new_optional_fixed_size_interval_var(x[m.id], w, b, f"ix_{m.id}_{d.id}")
            iy = model.new_optional_fixed_size_interval_var(y[m.id], h, b, f"iy_{m.id}_{d.id}")
            intervals[m.id, d.id] = (ix, iy)
            seen = set()
            for reserve in reserves(project, d.id):
                if d.id not in m.allowed_dies:
                    continue
                if m.placement_window:
                    from .physical import rect
                    if not rect(m.placement_window).intersects(reserve):
                        continue
                bounds = reserve.bounds
                if bounds in seen:
                    continue
                seen.add(bounds)
                left, bottom = math.floor((bounds[0]-m.halo_um)/g), math.floor((bounds[1]-m.halo_um)/g)
                right, top = math.ceil((bounds[2]+m.halo_um)/g), math.ceil((bounds[3]+m.halo_um)/g)
                rx = model.new_fixed_size_interval_var(left, right-left, f"rx_{m.id}_{d.id}_{len(seen)}")
                ry = model.new_fixed_size_interval_var(bottom, top-bottom, f"ry_{m.id}_{d.id}_{len(seen)}")
                model.add_no_overlap_2d([ix, rx], [iy, ry])
        model.add_exactly_one(on[m.id, d.id] for d in ds)
        if m.id in original:
            hint = original[m.id]
            model.add_hint(x[m.id], round(hint.x_um/g))
            model.add_hint(y[m.id], round(hint.y_um/g))
            for d in ds:
                model.add_hint(on[m.id, d.id], int(d.id == hint.die))
        if m.fixed:
            if m.id not in original:
                raise ValueError(f"fixed module {m.id} requires a placement")
            p = original[m.id]
            if abs(p.x_um/g-round(p.x_um/g)) > 1e-8 or abs(p.y_um/g-round(p.y_um/g)) > 1e-8:
                raise ValueError(f"fixed module {m.id} is not on the search grid; reduce grid_um")
            model.add(on[m.id, p.die] == 1)
            model.add(x[m.id] == round(p.x_um/g))
            model.add(y[m.id] == round(p.y_um/g))
    from shapely.ops import unary_union
    for i,m in enumerate(a.modules):
        for other in a.modules[i+1:]:
            gap=math.ceil(clearance(m,other,project.constraints)/g)
            if not gap:continue
            if m.placement_window and other.placement_window:
                from .physical import rect
                if rect(m.placement_window).distance(rect(other.placement_window))>=gap*g:
                    continue
            for d in ds:
                if d.id not in m.allowed_dies or d.id not in other.allowed_dies:continue
                choices=[model.new_bool_var(f'gap_{m.id}_{other.id}_{d.id}_{k}') for k in range(4)]
                expressions=[x[m.id]+widths[m.id]+gap<=x[other.id],x[other.id]+widths[other.id]+gap<=x[m.id],y[m.id]+heights[m.id]+gap<=y[other.id],y[other.id]+heights[other.id]+gap<=y[m.id]]
                for choice,expression in zip(choices,expressions):model.add(expression).only_enforce_if(choice)
                model.add_bool_or(choices+[on[m.id,d.id].Not(),on[other.id,d.id].Not()])
    for channel in project.constraints.routing_channels:
        d=next(d for d in ds if d.id==channel.die)
        width=channel.height_um if channel.direction=='HORIZONTAL' else channel.width_um
        if width<channel.min_width_um or channel.x_um+channel.width_um>d.width_um or channel.y_um+channel.height_um>d.height_um:
            model.add_bool_or([])
        terms={name:[] for name in channel.metals}
        for link in a.links:
            if link.id not in channel.links:continue
            model.add(on[link.source,d.id]==1);model.add(on[link.target,d.id]==1)
            permitted=link.routing_layers.get(channel.direction.lower(),channel.metals)
            counts=[]
            for name in channel.metals:
                if name not in permitted:continue
                count=model.new_int_var(0,link.wires,f'channel_{channel.id}_{link.id}_{name}')
                counts.append(count);terms[name].append(count)
            model.add(sum(counts)==link.wires)
        for name,counts in terms.items():
            metal=next(m for m in project.resources.metals if m.name==name)
            model.add(sum(counts)<=math.floor(width/metal.pitch_um*availability(project,metal)+1e-9))
    for d in ds:
        pairs = [intervals[m.id, d.id] for m in a.modules]
        model.add_no_overlap_2d([p[0] for p in pairs], [p[1] for p in pairs])
        free = d.width_um*d.height_um-unary_union(reserves(project, d.id)).area
        model.add(sum(math.ceil(m.width_um*m.height_um)*on[m.id, d.id] for m in a.modules) <= max(0, math.floor(free*d.max_utilization)))
        if d.power_budget_W is not None:
            model.add(sum(math.ceil((m.power_W or 0)*10000)*on[m.id, d.id] for m in a.modules) <= math.floor(d.power_budget_W*10000))
        for domain in {m.voltage_domain for m in a.modules}:
            ports = [p for p in project.floorplan.supply_ports if p.die == d.id and p.domain == domain]
            if any(p.max_current_A is None for p in ports):
                continue  # Unknown capacities cannot certify feasibility; evaluator reports them.
            capacity = math.floor(sum(p.max_current_A for p in ports)*10000)
            terms = []
            for m in a.modules:
                if m.voltage_domain != domain:
                    continue
                terms.append(math.ceil((m.power_W or 0)/d.voltage_V*10000)*on[m.id, d.id])
                if d.order == 0:
                    for upper in ds[1:]:
                        if any(p.feed == "stack_base" and p.die == upper.id and p.domain == domain for p in project.floorplan.supply_ports):
                            terms.append(math.ceil((m.power_W or 0)/upper.voltage_V*10000)*on[m.id, upper.id])
            model.add(sum(terms) <= capacity)
        # A core's unused supply cannot subsidize another core's overloaded port.
        for core in {p.core for p in project.floorplan.supply_ports if p.die==d.id and p.core is not None}:
            for domain in {m.voltage_domain for m in a.modules}:
                owned=[p for p in project.floorplan.supply_ports if p.die==d.id and p.core==core and p.domain==domain]
                if any(p.max_current_A is None for p in owned):continue
                terms=[]
                for m in a.modules:
                    if m.core!=core or m.voltage_domain!=domain:continue
                    terms.append(math.ceil((m.power_W or 0)/d.voltage_V*10000)*on[m.id,d.id])
                    if d.order==0:
                        for upper in ds[1:]:
                            if any(p.die==upper.id and p.core==core and p.domain==domain and p.feed=='stack_base' for p in project.floorplan.supply_ports):
                                terms.append(math.ceil((m.power_W or 0)/upper.voltage_V*10000)*on[m.id,upper.id])
                model.add(sum(terms)<=math.floor(sum(p.max_current_A for p in owned)*10000))
    for group in groups(project):
        for member in group[1:]:
            for d in ds:
                model.add(on[group[0], d.id] == on[member, d.id])
    above, crossings = {}, {}
    for m in a.modules:
        for k in range(len(ds)-1):
            b = model.new_bool_var(f"above_{m.id}_{k}")
            model.add(b == sum(on[m.id, d.id] for d in ds if d.order > k))
            above[m.id, k] = b
    for l in a.links:
        for k in range(len(ds)-1):
            b = model.new_bool_var(f"cross_{l.id}_{k}")
            model.add_abs_equality(b, above[l.source, k]-above[l.target, k])
            crossings[l.id, k] = b
        if l.max_tier_hops is not None:
            model.add(sum(crossings[l.id, k] for k in range(len(ds)-1)) <= l.max_tier_hops)
    if project.resources.tsv:
        for k in range(len(ds)-1):
            regions = [r for r in project.floorplan.tsv_regions if r.lower_die == ds[k].id and r.upper_die == ds[k+1].id]
            capacity = sum(interface_capacity(project, region) or 0 for region in regions)
            signal = sum(l.wires*crossings[l.id, k] for l in a.links)
            currents = []
            for m in a.modules:
                for d in ds[k+1:]:
                    if any(p.die == d.id and p.domain == m.voltage_domain and p.feed == "stack_base" for p in project.floorplan.supply_ports):
                        currents.append(math.ceil((m.power_W or 0)/d.voltage_V*1e6)*on[m.id, d.id])
            via_current_uA = max(1, math.floor(project.resources.tsv.max_current_mA*1000))
            supply_vias = model.new_int_var(0, 10000000, f"supply_vias_{k}")
            model.add(sum(currents) <= via_current_uA*supply_vias)
            model.add(signal+2*supply_vias <= capacity)
    objective = []
    # Optimize a transparent surrogate: weighted endpoint Manhattan length + tier penalties.
    # TSV-access detours and grid congestion are recomputed by the shared evaluator.
    for l in a.links:
        channel=next((c for c in project.constraints.routing_channels if l.id in c.links),None)
        delay=project.resources.delay_model
        planar_cost=max(1,round(delay.planar_ps_per_um*g/2*1000*l.latency_weight)) if search.objective=='latency' else search.wirelength_weight*l.wires
        tier_cost=round(delay.tier_ps*1000*l.latency_weight) if search.objective=='latency' else search.tier_crossing_weight*l.wires
        if channel:
            if channel.direction=='HORIZONTAL':
                endpoints=[(channel.x_um,channel.y_um+channel.height_um/2),(channel.x_um+channel.width_um,channel.y_um+channel.height_um/2)]
                length=channel.width_um
            else:
                endpoints=[(channel.x_um+channel.width_um/2,channel.y_um),(channel.x_um+channel.width_um/2,channel.y_um+channel.height_um)]
                length=channel.height_um
            alternatives=[]
            for reverse in [False,True]:
                terms=[]
                for mid,point in zip([l.source,l.target],endpoints[::-1] if reverse else endpoints):
                    for axis,(position,size) in enumerate([(x[mid],widths[mid]),(y[mid],heights[mid])]):
                        distance=model.new_int_var(0,max_dim*4,f'access_{l.id}_{reverse}_{mid}_{axis}')
                        model.add_abs_equality(distance,2*position+size-round(2*point[axis]/g))
                        terms.append(distance)
                alternatives.append(sum(terms)+round(2*length/g))
            distance=model.new_int_var(0,max_dim*20,f'channel_distance_{l.id}')
            model.add_min_equality(distance,alternatives)
            objective.append(planar_cost*distance)
        else:
            dx = model.new_int_var(0, max_dim*4, f"dx_{l.id}")
            dy = model.new_int_var(0, max_dim*4, f"dy_{l.id}")
            model.add_abs_equality(dx, 2*x[l.source]+widths[l.source]-2*x[l.target]-widths[l.target])
            model.add_abs_equality(dy, 2*y[l.source]+heights[l.source]-2*y[l.target]-heights[l.target])
            objective.append(planar_cost*(dx+dy))
        objective.extend(tier_cost*crossings[l.id, k] for k in range(len(ds)-1))
    model.minimize(sum(objective))
    candidates, statuses = [], []
    variables = [v for m in a.modules for v in (x[m.id], y[m.id])] + list(on.values())
    for attempt in range(search.candidates):
        remaining = search.time_limit_s-(time.monotonic()-start)
        if remaining <= 0:
            break
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(0.05, remaining/(search.candidates-attempt))
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = search.seed+attempt
        status = solver.solve(model)
        statuses.append(solver.status_name(status))
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if status == cp_model.UNKNOWN:
                continue
            break
        candidate = project.model_copy(deep=True)
        candidate.floorplan.placements = [Placement(module=m.id, die=next(d.id for d in ds if solver.value(on[m.id, d.id])), x_um=solver.value(x[m.id])*g, y_um=solver.value(y[m.id])*g, width_um=m.width_um, height_um=m.height_um) for m in a.modules]
        report = evaluate(candidate)
        report["candidate"] = dict(index=attempt+1, solver_status=solver.status_name(status), surrogate_objective=solver.objective_value, objective_bound=solver.best_objective_bound,
            relative_gap=max(0,(solver.objective_value-solver.best_objective_bound)/max(abs(solver.objective_value),1)),
            bound_scope='original_discrete_model' if not candidates else 'remaining_space_excluding_previous_candidates',
            previous_candidates_excluded=len(candidates), accepted=report["status"] == "within_model_constraints")
        candidates.append(report)
        model.add_forbidden_assignments(variables, [[solver.value(v) for v in variables]])
    candidates.sort(key=lambda r: (r["summary"]["errors"], r["summary"]["unknowns"], r['timing']['weighted_delay_ps'] if search.objective=='latency' else search.wirelength_weight*r["summary"]["weighted_wirelength_um"] + search.tier_crossing_weight*g/2*r["summary"]["signal_via_segments"]))
    accepted = [r for r in candidates if r["candidate"]["accepted"]]
    result = dict(baseline=baseline, candidates=candidates, search_status="feasible_candidates_found" if accepted else "no_verified_candidate", solver_statuses=statuses, elapsed_s=time.monotonic()-start, message="候选均经同一评估器复核；搜索目标包含中心距、绑定通道的入口/出口绕行与跨层代价；逐层拥塞和 TSV 接入由复核决定。没有合格候选不代表原问题无解。" )
    result['methodology']=describe_methods(project)['optimization']
    if baseline and candidates:
        best = candidates[0]
        result["comparison"] = {k: dict(baseline=baseline["summary"][k], candidate=best["summary"][k], delta=None if baseline["summary"][k] is None or best["summary"][k] is None else best["summary"][k]-baseline["summary"][k]) for k in ("errors", "weighted_delay_ps", "weighted_wirelength_um", "signal_via_segments", "total_via_segments", "peak_congestion", "power_W")}
        result["comparison"]["migrated_modules"] = [m["id"] for m in best["modules"] if original[m["id"]].die != m["die"]]
    return result
