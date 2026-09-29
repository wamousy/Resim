import pytest
from pydantic import ValidationError
from test_physical_routing import fixture,codes
from resim.schema import Project,DelayModel,PlacementWindow,SupplyPort,Core
from resim.engine import evaluate
from resim.optimizer import optimize
from resim.supply import region_power


def test_unknown_capacity_is_not_infinite_or_zero():
    p=fixture();p.floorplan.supply_ports[0].max_current_A=None
    r=evaluate(p)
    assert 'SUPPLY_CAPACITY_UNKNOWN' in codes(r)
    assert r['supply'][0]['capacity_A'] is None
    assert r['supply'][0]['margin_A'] is None
    assert r['status']=='incomplete'
    assert optimize(p)['search_status']!='feasible_candidates_found'


def test_core_cannot_borrow_other_cores_supply():
    p=fixture();p.architecture.cores.append(Core(id='other'))
    p.architecture.modules[1].core='other'
    original=p.floorplan.supply_ports[0];original.core='core';original.max_current_A=.5
    p.floorplan.supply_ports.append(SupplyPort(id='other_power',core='other',die='L0',x_um=99,y_um=0,voltage_V=1,max_current_A=100))
    r=evaluate(p)
    assert r['supply'][0]['margin_A']>0
    assert 'SUPPLY_CORE_CAPACITY' in codes(r)
    assert r['supply_groups'][0]['margin_A']==-.5
    assert optimize(p)['candidates']==[]


def test_windows_and_latency_objective_have_shared_evaluation():
    p=fixture();p.constraints.routing_channels=[]
    p.resources.delay_model=DelayModel(planar_ps_per_um=.1,tier_ps=20,provenance='test assumption')
    p.search.objective='latency';p.architecture.links[0].latency_weight=3
    for m in p.architecture.modules:m.placement_window=PlacementWindow(x_um=5,y_um=5,width_um=90,height_um=90)
    r=evaluate(p)
    assert r['links'][0]['estimated_delay_ps']==4
    assert r['timing']['weighted_delay_ps']==12
    p.floorplan.placements[0].x_um=0
    assert 'PLACEMENT_WINDOW' in codes(evaluate(p))
    result=optimize(p)
    assert result['candidates']
    assert 'PLACEMENT_WINDOW' not in codes(result['candidates'][0])
    assert result['candidates'][0]['timing']['weighted_delay_ps']<12


def test_latency_requires_explicit_model_and_mixed_port_ownership_rejected():
    p=fixture();data=p.model_dump();data['search']['objective']='latency'
    with pytest.raises(ValidationError,match='delay_model'):Project.model_validate(data)
    data=p.model_dump();port=dict(data['floorplan']['supply_ports'][0],id='owned',core='core')
    data['floorplan']['supply_ports'].append(port)
    with pytest.raises(ValidationError,match='cannot mix'):Project.model_validate(data)


def test_stack_power_is_assigned_to_own_core_region_once():
    p=fixture();p.architecture.cores.append(Core(id='other'));p.architecture.modules[1].core='other'
    upper=p.architecture.dies[0].model_copy(update=dict(id='L1',order=1));p.architecture.dies.append(upper)
    for placement in p.floorplan.placements:placement.die='L1'
    p.floorplan.supply_ports=[SupplyPort(id='p'+core,core=core,die='L1',x_um=0,y_um=0,voltage_V=1,max_current_A=2,feed='stack_base') for core in ['core','other']]
    from resim.schema import TSV
    p.resources.tsv=TSV(diameter_um=1,pitch_um=2,keepout_um=0,bond_pitch_um=2,max_current_mA=100,provenance='test')
    rows=[dict(id=core,boundary=0,region=dict(core=core)) for core in ['core','other']]
    issues=[];result=region_power(p,{x.module:x for x in p.floorplan.placements},rows,[],lambda *i:issues.append(i))
    assert not issues
    assert [r['power_vias'] for r in result.values()]==[10,10]
    p.architecture.modules[1].power_W=None
    result=region_power(p,{x.module:x for x in p.floorplan.placements},rows,[],lambda *i:None)
    assert result['core']['power_vias']==10
    assert result['other']['power_vias'] is None
