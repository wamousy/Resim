from pathlib import Path
import pytest
from pydantic import ValidationError
from resim.schema import loads, Project
from resim.wiring import estimate_wiring
from resim.engine import evaluate
from resim.export import save_report

PROJECTS=Path(__file__).resolve().parents[1]/'fixtures/projects'


def sample():
    return loads((PROJECTS/'gcd16-nangate45/inputs/architecture.yml').read_text(encoding='utf-8'))


def route(p):
    link=next(l for l in p.architecture.links if l.bus_width_bits==16)
    return link,[dict(die=p.architecture.dies[0].id,link=link.id,points=[[0,0],[1000,0],[1000,500]])]


def test_reference_area_matches_hand_calculation_and_unit_conversion():
    p=sample();link,routes=route(p)
    result,by_link,by_die=estimate_wiring(p,routes)
    assert [s['reference_metal'] for s in result['segments']]==['metal1','metal2']
    assert result['metal_area_um2']==pytest.approx(16*.07*1500)
    assert result['track_area_um2']==pytest.approx(16*(.14*1000+.19*500))
    assert result['bundle_envelope_area_um2']==pytest.approx((15*.14+.07)*1000+(15*.19+.07)*500)
    assert result['segments'][0]['bundle_width_um']==pytest.approx(2.17)
    assert by_link[link.id]['metal_area_um2']==pytest.approx(1680)
    assert by_die[p.architecture.dies[0].id]['metal_area_um2']/1e6==pytest.approx(.00168)


def test_explicit_reference_changes_area_but_not_logical_budget():
    p=sample();link,routes=route(p)
    link.area_reference.horizontal='metal5';link.area_reference.vertical='metal6'
    Project.model_validate(p.model_dump())
    result,_,_=estimate_wiring(p,routes)
    assert result['metal_area_um2']==pytest.approx(16*.14*1500)
    assert all(s['reference_source']=='input_reference' for s in result['segments'])
    assert link.wires==16
    before=evaluate(sample())['summary']['peak_congestion']
    assert evaluate(p)['summary']['peak_congestion']==before


def test_wrong_reference_direction_and_missing_names_rejected():
    for name in ['metal2','absent']:
        p=sample();p.architecture.links[0].area_reference.horizontal=name
        with pytest.raises(ValidationError,match='area reference metal'):
            Project.model_validate(p.model_dump())


def test_missing_direction_propagates_unknown_instead_of_partial_total():
    p=sample();p.resources.metals=[m for m in p.resources.metals if m.direction=='HORIZONTAL']
    _,routes=route(p);result,_,_=estimate_wiring(p,routes)
    assert result['segments'][0]['metal_area_um2'] is not None
    assert result['segments'][1]['metal_area_um2'] is None
    assert result['metal_area_um2'] is None
    assert result['unknown_segment_count']==1


def test_zero_length_and_zero_wire_do_not_allocate_area():
    p=sample();link,_=route(p)
    result,by_link,_=estimate_wiring(p,[dict(die='die0',link=link.id,points=[[1,1],[1,1],[1,1]])])
    assert not result['segments'] and by_link[link.id]['metal_area_um2']==0
    link.data_wires=None;link.bandwidth_GBps=0;link.control_wires=0;p.resources.metals=[]
    result,_,_=estimate_wiring(p,[dict(die='die0',link=link.id,points=[[0,0],[10,0]])])
    assert result['metal_area_um2']==0
    assert result['segments'][0]['bundle_width_um']==0


def test_wire_area_moves_with_endpoints_without_becoming_die_footprint():
    p=sample();a=evaluate(p)
    p.floorplan.placements[0].x_um+=5
    b=evaluate(p)
    assert a['wiring']['metal_area_um2']!=b['wiring']['metal_area_um2']
    assert a['summary']['total_die_area_mm2']==b['summary']['total_die_area_mm2']
    assert a['summary']['total_module_footprint_mm2']==b['summary']['total_module_footprint_mm2']


def test_cross_die_segments_reconcile_per_link_die_and_layer_totals():
    p=loads((PROJECTS/'gemmini-2logic-8dram/inputs/architecture.yml').read_text(encoding='utf-8'))
    r=evaluate(p)
    assert r['wiring']['metal_area_um2']==pytest.approx(sum(l['wire_area']['metal_area_um2'] for l in r['links']))
    assert r['wiring']['metal_area_um2']==pytest.approx(sum(d['wire_area']['metal_area_um2'] for d in r['dies']))
    assert r['wiring']['metal_area_um2']==pytest.approx(sum(d['metal_area_um2'] for d in r['wiring']['layers']))
    assert len({s['die'] for s in next(l for l in r['links'] if l['id']=='memory7_dma')['wire_area']['segments']})>=2


def test_peak_congestion_has_reproducible_demand_capacity_breakdown():
    r=evaluate(sample());g=r['congestion'][0];peak=g['peak_cell']
    assert peak['demand_tracks']/peak['capacity_tracks']==pytest.approx(r['dies'][0]['peak_congestion'])
    terms=r['calculations']['dies'][0]['congestion_capacity_terms']
    assert next(m['capacity_tracks'] for m in terms if m['metal']==g['peak_layer'])==peak['capacity_tracks']


def test_html_and_json_carry_the_same_auditable_inputs(tmp_path):
    r=evaluate(sample());save_report(r,tmp_path)
    html=(tmp_path/'report.html').read_text(encoding='utf-8')
    for text in ['互联面积预算','指标公式与数值代入','有效区占用率','分配金属层','金属面积 µm²']:
        assert text in html
    assert len(r['calculations']['dies'][0]['metrics'])==9
