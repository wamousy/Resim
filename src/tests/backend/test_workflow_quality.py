from pathlib import Path
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from resim.schema import loads, dumps, Project, Blockage
from resim.engine import evaluate
from resim.export import save_report
from resim.workspace import ProjectStore
from resim.server import app

PROJECTS=Path(__file__).resolve().parents[1]/'fixtures/projects'


def sample(name='gemmini-2logic-8dram'):
    return loads((PROJECTS/name/'inputs/architecture.yml').read_text(encoding='utf-8'))


def test_reserved_overlap_is_not_deducted_twice():
    p=sample('gcd16-nangate45')
    m=p.floorplan.placements[0]
    p.constraints.blockages=[Blockage(id='test',die=m.die,x_um=m.x_um,y_um=m.y_um,width_um=m.width_um,height_um=m.height_um)]
    report=evaluate(p);d=report['dies'][0]
    assert 'RESERVED_OVERLAP' in {i['code'] for i in report['issues']}
    assert d['reserved_overlap_mm2']>=m.width_um*m.height_um/1e6-1e-12
    assert d['free_area_mm2']+d['reserved_area_mm2']+d['usable_module_area_mm2']==pytest.approx(d['area_mm2'])
    assert d['footprint_utilization']==pytest.approx(d['usable_module_area_mm2']/(d['area_mm2']-d['reserved_area_mm2']))


def test_unequal_thicknesses_have_ten_um_gap_between_surfaces():
    p=sample();p.architecture.dies[0].thickness_um=160;p.architecture.dies[1].thickness_um=35
    ds=sorted(evaluate(p)['dies'],key=lambda d:d['order'])
    assert ds[1]['z_um']-ds[1]['thickness_um']-ds[0]['z_um']==pytest.approx(10)
    for lo,hi in zip(ds,ds[1:]):
        assert hi['z_um']-hi['thickness_um']-lo['z_um']==pytest.approx(10)


def test_unknown_upper_power_does_not_hide_known_local_base_load():
    p=sample();p.architecture.modules[-1].power_W=None
    s=next(r for r in evaluate(p)['supply'] if r['die']=='L0')
    assert s['local_current_A']==pytest.approx(2.6)
    assert s['injection_current_A'] is None


def test_bad_metal_geometry_and_duplicate_layers_are_rejected():
    p=sample();p.resources.metals[0].width_um=2*p.resources.metals[0].pitch_um
    with pytest.raises(ValidationError,match='width must not exceed'):
        Project.model_validate(p.model_dump())
    p=sample();p.resources.metals.append(p.resources.metals[0])
    with pytest.raises(ValidationError,match='duplicate metal'):
        Project.model_validate(p.model_dump())


def test_failed_simulation_preserves_working_input(tmp_path):
    store=ProjectStore(tmp_path);text=dumps(sample())
    first=store.simulate(text);pid=first['storage']['project_id']
    invalid=sample();invalid.floorplan.placements=[]
    with pytest.raises(ValueError):
        store.simulate(dumps(invalid),project_id=pid)
    assert store.input(pid)==text
    assert store.runs(pid)[0]['status']=='failed'
    assert store.snapshot(pid,store.runs(pid)[0]['run_id'])==dumps(invalid)


def test_yaml_preview_never_writes_a_project(tmp_path,monkeypatch):
    monkeypatch.setenv('RESIM_PROJECTS_DIR',str(tmp_path/'unused'))
    with TestClient(app) as client:
        response=client.post('/api/preview',json={'yaml':dumps(sample())})
        assert response.status_code==200
        assert response.json()['report']['simulator_version']=='0.12.0'
        assert not (tmp_path/'unused').exists()
        bad=client.post('/api/preview',json={'yaml':'invalid: ['})
        assert bad.status_code==422


def test_html_explains_unknowns_and_exposes_supply_budget(tmp_path):
    save_report(evaluate(sample('gcd16-nangate45')),tmp_path)
    html=(tmp_path/'report.html').read_text(encoding='utf-8')
    for text in ['数据不足，尚不能确认可行','供电资源','本层电流 A','未知','0.0042','模块互联位宽与线数']:
        assert text in html
    assert 'None' not in html
