import json
from pathlib import Path
import pytest
from resim.engine import evaluate
from resim.schema import loads, dumps, Link
from resim.workspace import ProjectStore
from resim.export import save_report
from resim.workspace import write_json

PROJECTS=Path(__file__).resolve().parents[1]/'fixtures/projects'

def sample(name='gcd16-nangate45'):
    return loads((PROJECTS/name/'inputs/architecture.yml').read_text(encoding='utf-8'))

def test_gcd_connection_widths_match_explicit_rtl_bus_budgets():
    report=evaluate(sample())
    assert {link['bus_width_bits'] for link in report['links']} == {1,2,16}
    assert sum(link['wires'] for link in report['links']) == 167
    for link in report['links']:
        assert link['bus_width_bits']==link['data_wires']==link['wires']
        assert link['spare_wires']==link['control_wires']==0
        assert link['data_wires_source']=='explicit'
        assert link['physical_width_status']=='layer_budget_allocated'
        assert len(link['metal_reference'])==10
        assert all(m['width_um']>0 and m['pitch_um']>0 for m in link['metal_reference'])

def test_logical_width_is_independent_of_serialized_data_lanes():
    link=Link(id='bus',source='a',target='b',bandwidth_GBps=32,lane_rate_Gbps=8,bus_width_bits=1024,control_wires=8,spare_fraction=.1)
    assert link.allocated_data_wires==32
    assert link.spare_wires==4
    assert link.wires==44
    assert link.bus_width_bits==1024
    project=sample('gemmini-2logic-8dram')
    assert all(l.bus_width_bits is None for l in project.architecture.links)
    assert all(l['bus_width_bits'] is None for l in evaluate(project)['links'])

def test_move_updates_length_but_preserves_connection_widths():
    project=sample()
    before=evaluate(project)
    next(p for p in project.floorplan.placements if p.module=='ctrl').x_um += 3
    after=evaluate(project)
    assert before['summary']['weighted_wirelength_um']!=after['summary']['weighted_wirelength_um']
    for a,b in zip(before['links'],after['links']):
        assert (a['bus_width_bits'],a['wires'])==(b['bus_width_bits'],b['wires'])

def test_exports_include_connection_and_technology_reference_details(tmp_path):
    report=evaluate(sample())
    save_report(report,tmp_path)
    html=(tmp_path/'report.html').read_text(encoding='utf-8')
    assert '模块互联位宽与线数' in html
    assert '单线宽 µm' in html
    data=json.loads((tmp_path/'resource-report.json').read_text(encoding='utf-8'))
    assert data['links']==report['links']

def test_old_project_alias_routes_new_runs_to_renamed_directory(tmp_path):
    store=ProjectStore(tmp_path/'projects')
    text=dumps(sample())
    store.create(text,project_id='new-chip',name='Named chip')
    (store.root/'_project-aliases.json').write_text(json.dumps({'old-chip':'new-chip'}),encoding='utf-8')
    assert store.project('old-chip')['id']=='new-chip'
    result=store.simulate(text,project_id='old-chip')
    assert result['storage']['project_id']=='new-chip'
    assert Path(result['storage']['run_dir']).is_relative_to(store.root/'new-chip')
    assert not (store.root/'old-chip').exists()
    assert store.result('old-chip',result['storage']['run_id'])['result']['plan_id']==result['plan_id']
    (store.root/'_project-aliases.json').write_text(json.dumps({'old-chip':'../outside'}),encoding='utf-8')
    with pytest.raises(ValueError):store.project_dir('old-chip')

def test_old_browser_cannot_revert_renamed_project_title(tmp_path):
    store=ProjectStore(tmp_path/'projects')
    source=sample();source.name='old-chip';text=dumps(source)
    meta=store.create(text,project_id='new-chip',name='Renamed chip')
    meta['previous_ids']=['old-chip'];write_json(store.project_dir('new-chip')/'project.json',meta)
    result=store.simulate(text,project_id='new-chip')
    assert result['name']=='Renamed chip'
    assert loads(store.input('new-chip')).name=='Renamed chip'
    assert store.snapshot('new-chip',result['storage']['run_id'])==text
    assert result['project']['floorplan']==source.model_dump()['floorplan']
