import json
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError
from shapely.geometry import LineString, box
from resim.schema import loads, Project, Link, PortLocation
from resim.engine import evaluate
from resim.optimizer import optimize

ROOT=Path(__file__).resolve().parents[1]
PROJECTS=Path(__file__).resolve().parents[1]/'fixtures/projects'


def sample(name='gcd16-nangate45'):
    return loads((PROJECTS/name/'inputs/architecture.yml').read_text(encoding='utf-8'))


def pair():
    p=sample();p.architecture.modules=p.architecture.modules[:2]
    a,b=p.architecture.modules
    for m,w,h in [(a,10,6),(b,8,10)]:
        m.width_um=w;m.height_um=h;m.stdcell_area_um2=1;m.macro_area_um2=0
    p.floorplan.placements=p.floorplan.placements[:2]
    for r,x,y,w,h in [(p.floorplan.placements[0],2,3,10,6),(p.floorplan.placements[1],30,4,8,10)]:
        r.x_um=x;r.y_um=y;r.width_um=w;r.height_um=h
    p.architecture.links=[Link(id='test',source=a.id,target=b.id,bandwidth_GBps=0,lane_rate_Gbps=1,data_wires=16,control_wires=0,spare_fraction=0)]
    return p


def test_auto_edges_and_length_exclude_module_internal_distance():
    p=pair();r=evaluate(p);link=r['links'][0]
    assert link['endpoints']['source']['point']==[12,6]
    assert link['endpoints']['target']['point']==[30,9]
    assert link['planar_length_um']==21
    assert link['wire_area']['metal_area_um2']==pytest.approx(16*.07*21)
    for route in r['routes']:
        line=LineString(route['points'])
        for m in p.floorplan.placements:
            interior=box(m.x_um,m.y_um,m.x_um+m.width_um,m.y_um+m.height_um).buffer(-1e-7)
            assert line.intersection(interior).is_empty


def test_explicit_ports_follow_module_move_and_keep_named_edge():
    p=pair();p.architecture.modules[0].port_locations={'out':PortLocation(side='north',offset=.25)}
    a=evaluate(p)['links'][0]['endpoints']['source']
    assert a['point']==[4.5,9] and a['source']=='specified_port'
    p.floorplan.placements[0].x_um+=5
    assert evaluate(p)['links'][0]['endpoints']['source']['point']==[9.5,9]


def test_invalid_port_keys_and_outside_offsets_rejected():
    p=pair();data=p.model_dump();data['architecture']['modules'][0]['port_locations']={'missing':{'side':'east','offset':.5}}
    with pytest.raises(ValidationError,match='unknown port'):Project.model_validate(data)
    with pytest.raises(ValidationError):PortLocation(side='east',offset=1.1)


@pytest.mark.parametrize('multi',[False,True])
def test_browser_draft_and_evaluator_share_exact_boundary_routes(multi):
    if not shutil.which('node'):pytest.skip('Node required for browser route parity')
    p=sample('gemmini-2logic-8dram') if multi else pair()
    first=p.architecture.modules[0];first.port_locations={'out':PortLocation(side='west',offset=.25)}
    report=evaluate(p)
    module=(Path(__file__).resolve().parents[2]/'frontend/layout-model.js').as_uri()
    script=f"import {{routeDraft}} from {json.dumps(module)};let input='';for await(const c of process.stdin)input+=c;process.stdout.write(JSON.stringify(routeDraft(JSON.parse(input))));"
    result=subprocess.run(['node','--input-type=module','-e',script],input=p.model_dump_json(),text=True,capture_output=True,check=True)
    draft=json.loads(result.stdout)
    assert draft['routes']==[{k:r[k] for k in ['die','link','points']} for r in report['routes']]
    for row in draft['terminals']:
        assert {k:row[k] for k in ['source','target']}==next(l['endpoints'] for l in report['links'] if l['id']==row['link'])


def test_signal_tsv_counts_interfaces_not_unique_connections():
    p=sample('gemmini-2logic-8dram');r=evaluate(p)
    assert r['summary']['signal_via_segments']==sum(l['wires']*l['tier_hops'] for l in r['links'])
    assert '电源与地' in r['methodology']['signals']['exclusions']
    assert r['methodology']['technology']['name']==p.resources.technology
    assert r['modules'][0]['target_cell_utilization']==p.architecture.modules[0].target_cell_utilization


def test_sixteen_tiles_use_independent_tsv_regions_and_local_dram_paths():
    p=sample('tensor-datapath-nangate45');r=evaluate(p)
    assert len(r['interfaces'])==16*(len(p.architecture.dies)-1)
    assert all(sum(i['id'].startswith(f'tsv_tile_r{row}_c{col}_') for i in r['interfaces'])==len(p.architecture.dies)-1
               for row in range(4) for col in range(4))
    assert not any(i['code']=='TSV_CAPACITY' for i in r['issues'])
    link_ids={link.id for link in p.architecture.links}
    for row in range(4):
        for col in range(4):
            tile=f'tile_r{row}_c{col}'
            assert {f'{tile}__dram_stack_to_odma0_8k',
                    f'{tile}__odma0_to_vlink',f'{tile}__vlink_to_wsram'} <= link_ids


def test_search_reports_bound_scope_and_gap_with_candidate_evidence():
    p=pair();p.search.time_limit_s=2;p.search.candidates=2;p.search.grid_um=1
    r=optimize(p)
    assert r['candidates']
    for c in r['candidates']:
        evidence=c['candidate']
        assert evidence['relative_gap']>=0
        if evidence['previous_candidates_excluded']==0:
            assert evidence['bound_scope']=='original_discrete_model'
        else:
            assert evidence['bound_scope']=='remaining_space_excluding_previous_candidates'
        if evidence['solver_status']=='OPTIMAL':assert evidence['relative_gap']==pytest.approx(0)
