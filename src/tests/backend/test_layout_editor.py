import copy
import json
from pathlib import Path
from fastapi.testclient import TestClient
from resim.schema import loads, dumps
from resim.engine import evaluate
from resim.server import app, get_store
from resim.workspace import ProjectStore

PROJECTS=Path(__file__).resolve().parents[1]/'fixtures/projects'


def sample(name):
    return loads((PROJECTS/name/'inputs/architecture.yml').read_text(encoding='utf-8'))


def test_small_die_area_and_empty_reserve_are_not_zero_or_out_of_bounds():
    project = sample('gcd16-nangate45')
    project.constraints.blockages = []
    report = evaluate(project)
    assert report['dies'][0]['area_mm2'] == 0.0042
    assert report['dies'][0]['width_um'] == 70
    assert not any(i['code'] == 'RESERVE_BOUNDS' for i in report['issues'])
    assert report['summary']['power_W'] is None


def test_preview_moves_routes_and_congestion_without_saving(tmp_path,monkeypatch):
    monkeypatch.setenv('RESIM_PROJECTS_DIR',str(tmp_path/'projects'))
    project = sample('gcd16-nangate45').model_dump()
    original = copy.deepcopy(project)
    with TestClient(app) as client:
        before = client.post('/api/layout/preview',json=project).json()['report']
        placement = next(p for p in project['floorplan']['placements'] if p['module']=='ctrl')
        placement.update(x_um=0,y_um=0)
        response = client.post('/api/layout/preview',json=project)
        assert response.status_code == 200
        after = response.json()['report']
        assert loads(response.json()['yaml']).model_dump() == project
        assert after['routes'] != before['routes']
        assert after['congestion'] != before['congestion']
        assert after['summary']['weighted_wirelength_um'] != before['summary']['weighted_wirelength_um']
        assert after['summary']['total_die_area_mm2'] == before['summary']['total_die_area_mm2']
        assert after['summary']['power_W'] is None
        assert after['project']['architecture'] == original['architecture']
    assert not (tmp_path/'projects').exists()


def test_cross_die_edit_updates_tsv_supply_and_layer_occupancy():
    project = sample('gemmini-10die').model_dump()
    with TestClient(app) as client:
        before = client.post('/api/layout/preview',json=project).json()['report']
        placement = next(p for p in project['floorplan']['placements'] if p['module']=='tensor')
        placement['die'] = 'L1' if placement['die']=='L0' else 'L0'
        after = client.post('/api/layout/preview',json=project).json()['report']
        assert after['summary']['signal_via_segments'] != before['summary']['signal_via_segments']
        assert after['supply'] != before['supply']
        assert [d['module_area_mm2'] for d in after['dies']] != [d['module_area_mm2'] for d in before['dies']]
        assert after['summary']['power_W'] == before['summary']['power_W']
        assert after['summary']['total_module_footprint_mm2'] == before['summary']['total_module_footprint_mm2']


def test_save_preview_matches_current_layout_and_html_export(tmp_path,monkeypatch):
    store = ProjectStore(tmp_path/'projects')
    project = sample('gcd16-nangate45')
    meta = store.create(dumps(project),project_id='editor-test')
    before = store.simulate(dumps(project),project_id=meta['id'])
    project.floorplan.placements[0].x_um = 0
    app.dependency_overrides[get_store] = lambda:store
    try:
        with TestClient(app) as client:
            preview = client.post('/api/layout/preview',json=project.model_dump()).json()
            saved = client.post('/api/evaluate',json={'project_id':meta['id'],'yaml':preview['yaml']}).json()
            assert saved['plan_id'] == preview['report']['plan_id']
            assert saved['storage']['run_id'] != before['storage']['run_id']
            prefix = '/api/projects/editor-test/runs/'+saved['storage']['run_id']
            assert '0.0042' in client.get(prefix+'/export/report.html').text
            exported = client.get(prefix+'/export/layout.yml')
            assert loads(exported.text).model_dump() == project.model_dump()
            import os
            opened=[]
            monkeypatch.setattr(os,'startfile',lambda path:opened.append(path),raising=False)
            assert client.post(prefix+'/open-folder').status_code == 200
            assert opened == [str(Path(saved['storage']['run_dir'])/'results')]
        old = json.loads((Path(before['storage']['run_dir'])/'results/resource-report.json').read_text(encoding='utf-8'))
        assert old['plan_id'] == before['plan_id']
    finally:
        app.dependency_overrides.clear()


def test_preview_rejects_invalid_coordinates():
    project=sample('gcd16-nangate45').model_dump()
    project['floorplan']['placements'][0]['x_um']=-1
    with TestClient(app) as client:
        assert client.post('/api/layout/preview',json=project).status_code==422


def test_restricted_folder_open_returns_actionable_json(tmp_path,monkeypatch):
    import os
    store=ProjectStore(tmp_path/'projects')
    saved=store.simulate(dumps(sample('gcd16-nangate45')))
    storage=saved['storage']
    def denied(path):
        raise PermissionError('restricted launch context')
    monkeypatch.setattr(os,'startfile',denied,raising=False)
    app.dependency_overrides[get_store]=lambda:store
    try:
        with TestClient(app) as client:
            response=client.post(f"/api/projects/{storage['project_id']}/runs/{storage['run_id']}/open-folder")
            assert response.status_code==503
            assert 'Resim.exe' in response.json()['detail']
    finally:
        app.dependency_overrides.clear()
