from pathlib import Path
import pytest
from resim.schema import Link, loads, dumps
from resim.engine import evaluate


def sample():
    return loads((Path(__file__).resolve().parents[1] / 'fixtures/projects/gcd16-nangate45/inputs/architecture.yml').read_text(encoding='utf-8'))


def test_width_only_link_does_not_invent_transfer_rate():
    p = sample()
    l = p.architecture.links[0]
    l.bandwidth_GBps = None
    l.lane_rate_Gbps = None
    l.data_wires = 8500
    l.control_wires = 0
    l.spare_fraction = 0
    l.provenance = 'Diagram 8.5K pins; no rate supplied'
    p = loads(dumps(p))
    r = evaluate(p)
    row = next(x for x in r['links'] if x['id'] == l.id)
    assert row['wires'] == 8500
    assert row['bandwidth_GBps'] is row['lane_rate_Gbps'] is row['required_data_lanes'] is None
    assert row['wire_area']['metal_area_um2'] > 0
    assert any(x['code'] == 'LINK_RATE_UNKNOWN' and x['subject'] == l.id for x in r['issues'])
    assert row['provenance'] == l.provenance


def test_link_requires_an_actual_physical_budget():
    with pytest.raises(ValueError, match='provide data_wires'):
        Link(id='unknown', source='a', target='b', bus_width_bits=8192)


def test_reference_group_checks_lower_bound_without_duplicating_area():
    p = sample().model_dump()
    members = [m['id'] for m in p['architecture']['modules'][:2]]
    p['architecture']['reference_groups'] = [dict(id='subsystem', modules=members, label='User subsystem', source='diagram', area_estimate_um2=1e9)]
    report = evaluate(loads(dumps(p)))
    assert report['reference_groups'][0]['minimum_area_fits'] is False
    assert any(i['code'] == 'REFERENCE_AREA_LOWER_BOUND' for i in report['issues'])
    original = evaluate(sample())
    assert report['summary']['total_module_footprint_mm2'] == original['summary']['total_module_footprint_mm2']
    assert report['modules'] == original['modules']
    p['architecture']['reference_groups'][0]['modules'].append('missing')
    with pytest.raises(ValueError, match='unknown reference group module'):
        loads(dumps(p))


def test_distributed_hb_does_not_route_every_core_to_global_label():
    from types import SimpleNamespace as Obj
    from resim.routing import route_link
    link=Link(id='result',source='a',target='b',data_wires=4000,control_wires=0,spare_fraction=0)
    placements={'a':Obj(die='l',x_um=100,y_um=100,width_um=100,height_um=100),
                'b':Obj(die='b',x_um=100,y_um=400,width_um=100,height_um=100)}
    modules={k:Obj(core='core00',port_locations={}) for k in placements}
    dies=[Obj(id='l',order=0),Obj(id='b',order=1)]
    hb=Obj(id='hb',lower_die='l',upper_die='b',core=None,interconnect='HB',signal_budget_bits=68500,
           interface_pitch_um=None,x_um=12000,y_um=1000,width_um=100,height_um=30000)
    route=route_link(link,placements,modules,dies,[hb])
    assert route['vertical'][0]['point']==[150,300]
    hb.interconnect='TSV'
    assert route_link(link,placements,modules,dies,[hb])['vertical'][0]['point']==[12050,16000]


def test_partially_modeled_budget_remains_explicit_without_double_counting():
    from resim.schema import Region
    p=sample()
    # An existing single-die sample can carry a second empty die for this budget test.
    upper=p.architecture.dies[0].model_copy(update={'id':'upper','order':1})
    p.architecture.dies.append(upper)
    p.floorplan.tsv_regions.append(Region(id='interface',lower_die=p.architecture.dies[0].id,upper_die='upper',
        interconnect='HB',orientation='F2F',x_um=0,y_um=0,width_um=10,height_um=10,signal_budget_bits=44700))
    r=evaluate(p)
    assert r['routing_status']=='partial_connections'
    row=r['interfaces'][0]
    assert row['modeled_signal_vias']==0
    assert row['unallocated_signal_budget']==row['signal_vias']==44700
    assert r['summary']['signal_hb_sites']==44700
