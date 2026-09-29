from pathlib import Path
from resim.schema import loads
from resim.engine import evaluate

def test_blx_aggregate_budget_and_unknowns():
    p=loads((Path(__file__).resolve().parents[1]/'fixtures/projects/blx-scheme1/inputs/architecture.yml').read_text(encoding='utf-8'))
    r=evaluate(p)
    assert r['summary']['signal_via_segments']==16*(29200+44700)
    assert r['summary']['signal_hb_sites']==16*44700
    assert r['summary']['total_die_area_mm2']==2400
    assert r['summary']['peak_congestion'] is None
    assert next(d for d in r['dies'] if d['kind']=='dram')['area_mm2'] is None
    assert all(m['cell_utilization'] is None for m in r['modules'])
    assert len([m for m in p.architecture.modules if 'UCIE' in m.id])==16*3+16
    assert len([m for m in p.architecture.modules if m.shared_cores])==8
    assert len([r for r in p.floorplan.tsv_regions if r.interconnect=='TSV' and r.lower_die=='bdie'])==16*4
    assert all(i['capacity'] is None for i in r['interfaces'])
