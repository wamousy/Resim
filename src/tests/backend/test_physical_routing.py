import json
import subprocess
from pathlib import Path
import pytest
from pydantic import ValidationError
from resim.schema import Project, RoutingChannel
from resim.engine import evaluate
from resim.optimizer import optimize
from resim.export import save_report


def fixture():
    return Project.model_validate(dict(name='通道与逐层容量验证',stack=dict(die_faces={'L0':'up'}),architecture=dict(chip='routing_demo',description='Synthetic geometry for hand calculations',dies=[dict(id='L0',kind='logic',order=0,width_um=100,height_um=100,thickness_um=50,voltage_V=1,power_budget_W=10)],cores=[dict(id='core')],modules=[dict(id=id,core='core',kind='logic',allowed_dies=['L0'],stdcell_area_um2=100,macro_area_um2=0,power_W=1,width_um=20,height_um=20,halo_um=2,provenance='手算验证参数') for id in ['A','B']],links=[dict(id='bus',source='A',target='B',data_wires=16,control_wires=0,spare_fraction=0,bandwidth_GBps=0,lane_rate_Gbps=1,routing_layers=dict(horizontal=['M1','M3'],vertical=['M2']))]),resources=dict(technology='Synthetic 1um track model',technology_provenance='Analytical test fixture; not a foundry process',routing_availability=1,metals=[dict(name=name,direction=direction,width_um=.5,pitch_um=1) for name,direction in [('M1','HORIZONTAL'),('M2','VERTICAL'),('M3','HORIZONTAL')]]),constraints=dict(min_module_spacing_um=8,routing_channels=[dict(id='corridor',die='L0',direction='HORIZONTAL',x_um=35,y_um=35,width_um=30,height_um=10,min_width_um=10,metals=['M1','M3'],links=['bus'])]),floorplan=dict(placements=[dict(module=id,die='L0',x_um=x,y_um=30,width_um=20,height_um=20) for id,x in [('A',10),('B',70)]],supply_ports=[dict(id='power',die='L0',x_um=0,y_um=0,voltage_V=1,max_current_A=5)]),search=dict(grid_um=1,congestion_grid=4,time_limit_s=3,candidates=1)))


def codes(r):return {i['code'] for i in r['issues']}


def test_channel_split_conserves_wires_and_area_and_reserves_whitespace():
    p=fixture();r=evaluate(p)
    assert r['status']=='within_model_constraints',r['issues']
    channel=r['metal_routing']['channels']
    assert [(x['metal'],x['demand_tracks'],x['capacity_tracks']) for x in channel]==[('M1',10,10),('M3',6,10)]
    by_segment={}
    for part in r['metal_routing']['allocated_routes']:by_segment.setdefault(part['segment_id'],[]).append(part)
    assert all(sum(x['wires'] for x in parts)==16 for parts in by_segment.values())
    assert r['wiring']['metal_area_um2']==pytest.approx(16*.5*40)
    assert r['dies'][0]['reserved_area_mm2']==pytest.approx(300/1e6)
    assert r['spacing'][0]['required_um']==8
    assert r['spacing'][0]['actual_um']==40


def test_pinned_overloaded_metal_cannot_borrow_free_metal_capacity():
    p=fixture();p.constraints.routing_channels=[]
    link=p.architecture.links[0];link.data_wires=40;link.routing_layers['horizontal']=['M1']
    r=evaluate(p);layers={l['metal']:l for l in r['metal_routing']['layers']}
    assert layers['M1']['peak_ratio']>1
    assert layers['M3']['peak_demand_tracks']==0
    assert r['dies'][0]['peak_congestion']==layers['M1']['peak_ratio']
    assert 'METAL_CAPACITY' in codes(r)
    assert all(part['wires']==40 for part in r['metal_routing']['allocated_routes'])


def test_channel_overflow_detected_even_when_grid_average_fits():
    p=fixture();p.architecture.links[0].routing_layers['horizontal']=['M1'];p.architecture.links[0].data_wires=11
    r=evaluate(p)
    assert 'CHANNEL_CAPACITY' in codes(r)
    assert 'METAL_CAPACITY' not in codes(r)
    assert r['metal_routing']['channels'][0]['margin_tracks']==-1
    p.constraints.routing_channels[0].height_um=12
    r=evaluate(p)
    assert 'CHANNEL_CAPACITY' not in codes(r)


def test_layer_fraction_override_and_zero_capacity_are_explicit():
    p=fixture();p.constraints.routing_channels=[];p.architecture.links[0].routing_layers['horizontal']=['M1'];p.resources.metals[0].availability=0
    r=evaluate(p);m=r['metal_routing']['layers'][0]
    assert m['capacity_tracks']==0 and m['zero_capacity_demand']
    assert m['peak_ratio'] is None and 'METAL_CAPACITY' in codes(r)
    json.dumps(r,allow_nan=False)
    p.resources.metals[0].availability=.5
    r=evaluate(p)
    assert r['metal_routing']['layers'][0]['capacity_tracks']==12


def test_missing_direction_preserves_unassigned_demand():
    p=fixture();p.architecture.links[0].routing_layers={};p.constraints.routing_channels=[]
    p.resources.metals=[m for m in p.resources.metals if m.direction=='VERTICAL']
    r=evaluate(p)
    assert 'METAL_UNASSIGNED' in codes(r)
    assert sum(s['wires'] for s in r['metal_routing']['allocated_routes'])==16
    assert r['wiring']['metal_area_um2'] is None


def test_spacing_is_external_halo_not_internal_cell_whitespace():
    p=fixture();p.constraints.routing_channels=[]
    p.floorplan.placements[1].x_um=35
    r=evaluate(p)
    assert 'MODULE_SPACING' in codes(r) and 'MODULE_OVERLAP' not in codes(r)
    p.architecture.modules[0].halo_um=6;p.architecture.modules[1].halo_um=6
    assert evaluate(p)['spacing'][0]['required_um']==12
    p.floorplan.placements[0].x_um=1
    assert 'HALO_BOUNDS' in codes(evaluate(p))


def test_channel_occupation_width_and_bounds():
    p=fixture();p.floorplan.placements[0].x_um=20
    assert 'CHANNEL_OCCUPIED' in codes(evaluate(p))
    p=fixture();p.constraints.routing_channels[0].min_width_um=11
    assert 'CHANNEL_WIDTH' in codes(evaluate(p))
    p.constraints.routing_channels[0].x_um=90
    assert 'CHANNEL_BOUNDS' in codes(evaluate(p))


def test_new_references_and_limits_rejected_at_input():
    for mutate in [lambda d:d['architecture']['links'][0]['routing_layers'].update(horizontal=['M2']),lambda d:d['architecture']['links'][0]['routing_layers'].update(horizontal=[]),lambda d:d['constraints']['routing_channels'][0].update(metals=['absent']),lambda d:d['constraints']['routing_channels'][0].update(links=['missing']),lambda d:d['resources']['metals'][0].update(availability=1.1)]:
        d=fixture().model_dump();mutate(d)
        with pytest.raises(ValidationError):Project.model_validate(d)


def test_optimizer_enforces_gaps_halos_channel_and_capacity():
    p=fixture();p.floorplan.placements[1].x_um=35
    result=optimize(p)
    assert result['candidates'],result
    r=result['candidates'][0]
    assert not {'MODULE_SPACING','HALO_BOUNDS','CHANNEL_OCCUPIED','CHANNEL_DIE'} & codes(r)
    assert all(row['passed'] for row in r['spacing'])
    p.architecture.links[0].data_wires=21
    result=optimize(p)
    assert not result['candidates'] and 'INFEASIBLE' in result['solver_statuses']


def test_optimizer_channel_objective_uses_corridor_access_not_direct_center_distance():
    p=fixture();baseline=evaluate(p)
    result=optimize(p)
    accepted=[c for c in result['candidates'] if c['candidate']['accepted']]
    assert accepted,result
    assert accepted[0]['summary']['weighted_wirelength_um']<=baseline['summary']['weighted_wirelength_um']


def test_channel_moves_recalculate_and_export_reports(tmp_path):
    p=fixture();r=evaluate(p);p.floorplan.placements[0].y_um=10
    moved=evaluate(p)
    assert moved['wiring']['metal_area_um2']!=r['wiring']['metal_area_um2']
    assert moved['routes']!=r['routes']
    save_report(moved,tmp_path)
    text=(tmp_path/'report.html').read_text(encoding='utf-8')
    assert all(t in text for t in ['逐金属层容量检查','模块间距与通道约束','分配金属层'])
    data=json.loads((tmp_path/'resource-report.json').read_text(encoding='utf-8'))
    assert data['metal_routing']==moved['metal_routing']


def test_channel_browser_preview_geometry_matches_engine():
    p=fixture();root=Path(__file__).resolve().parents[1]
    module=(Path(__file__).resolve().parents[2]/'frontend/layout-model.js').as_uri()
    script=f"import {{routeDraft}} from {json.dumps(module)};let t='';for await(const c of process.stdin)t+=c;process.stdout.write(JSON.stringify(routeDraft(JSON.parse(t))));"
    result=subprocess.run(['node','--input-type=module','-e',script],input=p.model_dump_json(),text=True,capture_output=True,check=True)
    routes=json.loads(result.stdout)['routes']
    assert routes==[{k:r[k] for k in ['die','link','points']} for r in evaluate(p)['routes']]
