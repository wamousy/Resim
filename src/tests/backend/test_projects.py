import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from resim.schema import dumps, loads
from resim.workspace import ProjectStore
from resim.server import app, get_store, exports

ROOT=Path(__file__).resolve().parents[1]/'fixtures'


@pytest.fixture
def text():
    return dumps(loads(dumps(loads((ROOT/'projects/gemmini-10die/inputs/architecture.yml').read_text(encoding='utf-8')))))


def test_same_name_creates_separate_projects(tmp_path,text):
    store=ProjectStore(tmp_path/'projects')
    a=store.create(text,name='same chip')
    b=store.create(text,name='same chip')
    assert a['id']!=b['id']
    assert store.input(a['id'])==store.input(b['id'])==text
    assert len(store.projects())==2


def test_existing_id_is_never_overwritten(tmp_path,text):
    store=ProjectStore(tmp_path)
    store.create(text,project_id='chip-a')
    with pytest.raises(FileExistsError):store.create(text+'\n# new',project_id='chip-a')
    assert store.input('chip-a')==text


@pytest.mark.parametrize('bad',['../escape','a/b','a\\b','C:temp','con','nul','UPPER','a.'])
def test_project_and_run_paths_are_confined(tmp_path,text,bad):
    store=ProjectStore(tmp_path)
    with pytest.raises(ValueError):store.project_dir(bad)
    with pytest.raises(ValueError):store.run_dir('valid',bad)


def test_repeated_runs_preserve_original_snapshots(tmp_path,text):
    store=ProjectStore(tmp_path)
    first=store.simulate(text)
    pid=first['storage']['project_id'];rid=first['storage']['run_id']
    old_path=Path(first['storage']['run_dir'])/'results/resource-report.json'
    old_bytes=old_path.read_bytes()
    changed=loads(text);changed.architecture.modules[0].power_W=1.5
    second=store.simulate(dumps(changed),project_id=pid)
    assert first['storage']['run_id']!=second['storage']['run_id']
    assert old_path.read_bytes()==old_bytes
    assert store.snapshot(pid,rid)==text
    assert len(store.runs(pid))==2
    assert second['summary']['power_W']==pytest.approx(8.3)
    assert ProjectStore(tmp_path).result(pid,rid)['result']['summary']['power_W']==pytest.approx(8.8)


def test_concurrent_runs_get_unique_directories(tmp_path,text):
    store=ProjectStore(tmp_path)
    pid=store.create(text)['id']
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:store.simulate(text,project_id=pid),range(2)))
    assert len({r['storage']['run_id'] for r in results})==2
    assert len(store.runs(pid))==2
    assert all(r['status']=='completed' for r in store.runs(pid))


def test_failed_execution_keeps_snapshot_and_error(tmp_path,text):
    store=ProjectStore(tmp_path)
    p=loads(text);p.floorplan.placements=[]
    with pytest.raises(ValueError):store.simulate(dumps(p))
    pid=store.projects()[0]['id'];run=store.runs(pid)[0]
    assert run['status']=='failed'
    assert 'requires exactly' in run['error']
    assert store.snapshot(pid,run['run_id'])==dumps(p)
    with pytest.raises(ValueError,match='failed'):store.result(pid,run['run_id'])


def test_invalid_input_does_not_create_directories(tmp_path):
    store=ProjectStore(tmp_path/'projects')
    with pytest.raises(ValueError):store.simulate('name: bad')
    assert not store.root.exists()


def test_managed_input_recognizes_own_project(tmp_path,text):
    store=ProjectStore(tmp_path/'projects');p=store.create(text)
    assert store.infer_project(store.project_dir(p['id'])/'inputs/architecture.yml')==p['id']
    assert store.infer_project(tmp_path/'external.yml') is None


def test_optimization_is_persisted_and_can_be_read_after_restart(tmp_path,text):
    p=loads(text)
    p.architecture.dies=p.architecture.dies[:2]
    p.stack.die_faces={d.id:'up' for d in p.architecture.dies}
    p.architecture.modules=p.architecture.modules[:3]
    p.architecture.links=p.architecture.links[:2]
    p.floorplan.placements=p.floorplan.placements[:3]
    p.floorplan.tsv_regions=p.floorplan.tsv_regions[:1]
    p.floorplan.supply_ports=p.floorplan.supply_ports[:2]
    p.search.time_limit_s=4;p.search.candidates=1
    store=ProjectStore(tmp_path)
    result=store.simulate(dumps(p),mode='optimize')
    s=result['storage'];directory=Path(s['run_dir'])
    assert result['candidates']
    assert (directory/'results/baseline/resource-report.json').exists()
    assert (directory/'results/candidate-1/layout-plan.yml').exists()
    assert ProjectStore(tmp_path).result(s['project_id'],s['run_id'])['result']['candidates']==result['candidates']


def test_api_history_and_export_work_without_memory_cache(tmp_path,text):
    store=ProjectStore(tmp_path)
    app.dependency_overrides[get_store]=lambda:store
    try:
        with TestClient(app) as client:
            first=client.post('/api/evaluate',json={'yaml':text,'project_name':'new input'}).json()
            s=first['storage'];pid=s['project_id'];rid=s['run_id']
            second=client.post('/api/evaluate',json={'yaml':text,'project_id':pid}).json()
            assert second['storage']['run_id']!=rid
            assert len(client.get('/api/projects').json())==1
            assert len(client.get(f'/api/projects/{pid}/runs').json())==2
            assert client.get(f'/api/projects/{pid}/input').text==text
            exports.clear()
            url=f'/api/projects/{pid}/runs/{rid}'
            assert client.get(url+'/result').json()['result']['plan_id']==first['plan_id']
            exports.clear()
            exported=client.get(url+'/export/layout.yml')
            assert exported.status_code==200
            assert loads(exported.text).name==loads(text).name
            assert client.get(url+'/input').text==text
            assert client.get('/api/projects/missing/input').status_code==404
            assert client.post('/api/evaluate',json={'yaml':text,'project_id':'../escape'}).status_code==422
    finally:
        app.dependency_overrides.clear();exports.clear()


def test_cli_works_from_other_directory_and_reuses_project(tmp_path,text):
    source=tmp_path/'new-chip.yml';source.write_text(text,encoding='utf-8')
    common=[sys.executable,str(Path(__file__).resolve().parents[2]/'backend/entry.py')]
    root=tmp_path/'projects'
    def call(*args):
        return subprocess.run(common+list(args)+['--projects-dir',str(root)],cwd=tmp_path,capture_output=True,text=True,check=True).stdout
    call('init',str(source),'--id','chip-a')
    call('evaluate','--project','chip-a')
    call('evaluate','--project','chip-a')
    store=ProjectStore(root)
    assert len(store.runs('chip-a'))==2
    assert len(store.projects())==1
