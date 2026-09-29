import hashlib
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from ruamel.yaml.constructor import DuplicateKeyError
from resim.schema import loads, dumps, Project
from resim.engine import evaluate
from resim.optimizer import optimize
from resim.lef import import_lef
from resim.server import app, get_store
from resim.workspace import ProjectStore
from resim.export import save_report

ROOT = Path(__file__).resolve().parents[1]/'fixtures'


@pytest.fixture
def p():
    return loads((ROOT/'examples/gemmini-10die.yml').read_text(encoding='utf-8'))


def codes(report):
    return {i['code'] for i in report['issues']}


def test_empty_reserves_are_not_out_of_bounds(p):
    p.floorplan.tsv_regions = []
    p.constraints.blockages = []
    assert 'RESERVE_BOUNDS' not in codes(evaluate(p))


def test_source_hashes():
    manifest=json.loads((ROOT/'data/sources/manifest.json').read_text())
    for source in manifest['files']:
        assert hashlib.sha256((ROOT/source['path']).read_bytes()).hexdigest()==source['sha256']


def test_real_lef_geometry():
    t=import_lef(ROOT/'data/sources/nangate45/tech.lef',ROOT/'data/sources/nangate45/cells.lef')
    assert len(t['metals'])==10
    assert t['metals'][0]['pitch_um']==.14
    assert t['metals'][0]['width_um']==.07
    assert t['cells']['NAND2_X1']['area_um2']==pytest.approx(.798)


def test_yaml_duplicate_unknown_and_units(p):
    with pytest.raises(DuplicateKeyError):
        loads('name: a\nname: b')
    data=p.model_dump(); data['architecture']['modules'][0]['area_mm2']=12
    with pytest.raises(ValidationError):
        Project.model_validate(data)
    data=p.model_dump();data['architecture']['modules'][0]['stdcell_area_um2']=-1
    with pytest.raises(ValidationError):
        Project.model_validate(data)


def test_invalid_references_ports_order(p):
    for change in ['core','port','order']:
        data=p.model_dump()
        if change=='core':data['architecture']['modules'][0]['core']='missing'
        if change=='port':data['architecture']['links'][0]['source_port']='missing'
        if change=='order':data['architecture']['dies'][0]['order']=4
        with pytest.raises(ValidationError):Project.model_validate(data)


def test_baseline_is_reproducible_and_input_unchanged(p):
    original=dumps(p)
    a,b=evaluate(p),evaluate(p)
    assert a==b
    assert dumps(p)==original
    assert a['status']=='within_model_constraints'
    assert a['summary']['power_W']==pytest.approx(8.8)
    assert a['summary']['total_die_area_mm2']==360


def test_macro_area_not_scaled_by_utilization(p):
    m=next(x for x in evaluate(p)['modules'] if x['id']=='dram0')
    assert m['required_footprint_um2']==16_000_000
    assert m['cell_utilization']==0


def test_tsv_each_boundary_and_shared_reserve(p):
    r=evaluate(p)
    # Top memory uses every boundary down to its DMA on L1, exactly once.
    assert sum('memory7_dma' in i['links'] for i in r['interfaces'])==8
    assert 'memory7_dma' not in r['interfaces'][0]['links']
    # Adjacent interface regions overlap on a die and must be geometrically unioned.
    assert all(d['reserved_area_mm2']==pytest.approx(.64) for d in r['dies'])
    for i in r['interfaces']:
        assert i['total_vias']==i['signal_vias']+i['power_vias']+i['ground_vias']
        assert i['power_vias']==i['ground_vias']


def test_supply_base_includes_all_upstream_loads(p):
    r=evaluate(p)
    base=next(s for s in r['supply'] if s['die']=='L0')
    assert base['injection_current_A']==pytest.approx(8.8)
    assert base['local_current_A']==pytest.approx(2.6)
    assert r['interfaces'][-1]['power_vias']==50


def test_missing_power_is_unknown_not_zero(p):
    p.architecture.modules[-1].power_W=None
    r=evaluate(p)
    assert r['summary']['power_W'] is None
    assert r['summary']['total_via_segments'] is None
    assert r['interfaces'][-1]['power_vias'] is None
    assert next(s for s in r['supply'] if s['die']=='D7')['injection_current_A'] is None
    assert r['status']=='incomplete'


def test_missing_metal_is_not_zero_congestion(p):
    p.resources.metals=[]
    r=evaluate(p)
    assert r['summary']['peak_congestion'] is None
    assert r['status']=='incomplete'


def test_congestion_locates_modules_and_connections(p):
    p.constraints.max_congestion_ratio=.1
    r=evaluate(p)
    assert 'CONGESTION' in codes(r)
    assert 'CONGESTION_CONTRIBUTOR' in codes(r)
    assert all(m['peak_congestion'] is not None for m in r['modules'])


def test_overlaps_are_only_same_die(p):
    r=evaluate(p)
    assert 'MODULE_OVERLAP' not in codes(r)
    p.floorplan.placements[1].die='L0'
    p.floorplan.placements[1].x_um=200
    p.floorplan.placements[1].y_um=200
    assert 'MODULE_OVERLAP' in codes(evaluate(p))


def test_clear_violation_example():
    p=loads((ROOT/'examples/violations.yml').read_text(encoding='utf-8'))
    assert {'MODULE_OVERLAP','SUPPLY_CAPACITY','TSV_CAPACITY'} <= codes(evaluate(p))


def test_bandwidth_hops_and_length_constraints(p):
    p.architecture.links[0].data_wires=1
    p.architecture.links[0].max_tier_hops=0
    p.architecture.links[0].max_planar_length_um=1
    assert {'LINK_BANDWIDTH','TIER_HOPS','WIRE_LENGTH'} <= codes(evaluate(p))


def test_out_of_bounds_group_and_area(p):
    p.floorplan.placements[0].x_um=6000
    p.architecture.modules[1].macro_area_um2=10_000_000
    p.constraints.same_die_groups=[['tensor','dma']]
    assert {'OUT_OF_BOUNDS','MODULE_AREA','GROUP_SPLIT'} <= codes(evaluate(p))


def test_tsv_missing_or_bond_limited(p):
    p.resources.tsv.bond_pitch_um=100
    assert 'TSV_CAPACITY' in codes(evaluate(p))
    p.resources.tsv=None
    assert 'TSV_UNKNOWN' in codes(evaluate(p))


def test_evaluate_requires_complete_layout(p):
    p.floorplan.placements.pop()
    with pytest.raises(ValueError,match='missing'):evaluate(p)


def tiny_project(p):
    # A bounded solver regression independent of the larger demo's time budget.
    p.architecture.dies=p.architecture.dies[:2]
    p.stack.die_faces={d.id:'up' for d in p.architecture.dies}
    p.architecture.modules=p.architecture.modules[:3]
    p.architecture.links=p.architecture.links[:2]
    p.floorplan.placements=p.floorplan.placements[:3]
    p.floorplan.tsv_regions=p.floorplan.tsv_regions[:1]
    p.floorplan.supply_ports=p.floorplan.supply_ports[:2]
    p.architecture.modules[0].fixed=True
    p.search.time_limit_s=5;p.search.candidates=1
    return Project.model_validate(p.model_dump())


def test_optimizer_actually_places_and_preserves_fixed(p):
    p=tiny_project(p)
    before=evaluate(p)
    r=optimize(p)
    assert r['candidates'],r
    best=r['candidates'][0]
    assert best['status']=='within_model_constraints'
    assert best['summary']['weighted_wirelength_um']<before['summary']['weighted_wirelength_um']
    fixed=next(m for m in best['modules'] if m['id']=='tensor')
    assert (fixed['die'],fixed['x_um'],fixed['y_um'])==('L0',200,200)
    assert best['candidate']['accepted']


def test_optimizer_without_initial_placements(p):
    p=tiny_project(p)
    p.architecture.modules[0].fixed=False
    p.floorplan.placements=[]
    r=optimize(p)
    assert r['baseline'] is None
    assert r['candidates'] and r['candidates'][0]['candidate']['accepted']


def test_impossible_geometry_does_not_claim_success(p):
    p.architecture.modules[0].stdcell_area_um2=10**9
    r=optimize(p)
    assert not r['candidates']
    assert r['search_status']=='input_geometry_infeasible'


def test_fixed_grid_guard(p):
    p.architecture.modules[0].fixed=True
    p.floorplan.placements[0].x_um=201
    with pytest.raises(ValueError,match='search grid'):optimize(p)


def test_export_round_trip(p,tmp_path):
    report=evaluate(p)
    save_report(report,tmp_path)
    loaded=loads((tmp_path/'layout-plan.yml').read_text(encoding='utf-8'))
    assert evaluate(loaded)['plan_id']==report['plan_id']
    assert (tmp_path/'report.html').exists()


def test_api_evaluate_and_reject_bad_yaml(p):
    with TestClient(app) as client:
        assert client.get('/').status_code==200
        result=client.post('/api/evaluate',json={'yaml':dumps(p)})
        assert result.status_code==200
        assert result.json()['summary']['die_count']==10
        plan=result.json()['plan_id']
        exported=client.get(f'/api/exports/{plan}/layout.yml')
        assert exported.status_code==200
        assert 'attachment' in exported.headers['content-disposition']
        assert evaluate(loads(exported.text))['plan_id']==plan
        assert client.get(f'/api/exports/{plan}/report.json').json()['plan_id']==plan
        assert client.get('/api/exports/missing/layout.yml').status_code==404
        assert client.post('/api/validate',json={'yaml':'name: a\nname: b'}).status_code==422
        assert client.post('/api/validate',json={'yaml':'!!python/object/apply:os.system [hello]'}).status_code==422
        assert client.get('/api/examples/secret.yml').status_code==404
        assert client.get('/api/schema').status_code==200
