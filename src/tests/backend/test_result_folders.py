"""Physical result names, immutable history, exports and portable project paths."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from resim.server import app, starter, exports
from resim.workspace import ProjectStore, create_result_folder
from resim_policy_portable import pack_project, unpack_project


@pytest.mark.parametrize('external', [False, True])
def test_named_folder_contains_outputs_and_history_reopens_it(tmp_path, monkeypatch, external):
    root = tmp_path/'p'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    client = TestClient(app)
    body = dict(yaml=starter()['yaml'], run_name='显示名称', result_folder_name='低拥塞 方案A')
    if external:
        body['output_dir'] = str(tmp_path/'out')
    response = client.post('/api/evaluate', json=body)
    assert response.status_code == 200, response.text
    info = response.json()['storage']
    folder = Path(info['results_dir'])
    expected_parent = tmp_path/'out'/info['project_id'] if external else root/info['project_id']
    assert folder == expected_parent/'低拥塞 方案A'
    assert info['run_dir'] == str(folder)
    assert info['result_folder_name'] == folder.name
    for name in ('report.html', 'resource-report.json', 'layout-plan.yml', 'input.yml', 'run.json'):
        assert (folder/name).is_file(), name
    before = (folder/'resource-report.json').read_bytes()
    second = client.post('/api/evaluate', json={**body, 'project_id': info['project_id']}).json()['storage']
    assert Path(second['results_dir']) == expected_parent/'低拥塞 方案A (2)'
    assert (folder/'resource-report.json').read_bytes() == before
    assert second['run_id'] != info['run_id']
    store = ProjectStore(root)
    assert len(store.runs(info['project_id'])) == 2
    exports.clear()
    url = f"/api/projects/{info['project_id']}/runs/{info['run_id']}"
    assert client.get(url+'/result').json()['result']['storage']['results_dir'] == str(folder)
    assert client.get(url+'/export/report.html').status_code == 200
    assert client.get(url+'/export/report.json').json()['storage']['results_dir'] == str(folder)
    assert client.get(url+'/export/layout.yml').status_code == 200
    assert client.get(url+'/input').text == body['yaml']
    opened = []
    monkeypatch.setattr(os, 'startfile', opened.append, raising=False)
    if os.name == 'nt':
        assert client.post(url+'/open-folder').json()['path'] == str(folder)
        assert opened == [str(folder)]


@pytest.mark.parametrize('name', ['', ' ', '.', '..', '../outside', 'a/b', 'a\\b', 'C:folder',
    'a*', 'a?', '<对比>', 'a|b', 'a"b', 'a\nb', 'name.', 'CON', 'aux.txt', 'COM1', 'lpt².txt', 'x'*121])
def test_invalid_folder_name_fails_before_any_project_write(tmp_path, monkeypatch, name):
    root = tmp_path/'not-created'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    response = TestClient(app).post('/api/evaluate', json=dict(yaml=starter()['yaml'],result_folder_name=name))
    assert response.status_code == 422, response.text
    assert not root.exists()


def test_existing_files_and_case_variants_are_not_overwritten(tmp_path):
    (tmp_path/'Plan A').write_text('unrelated data')
    (tmp_path/'plan a (2)').mkdir()
    assert create_result_folder(tmp_path,'plan a').name == 'plan a (3)'
    assert (tmp_path/'Plan A').read_text() == 'unrelated data'


def test_concurrent_named_saves_reserve_different_folders(tmp_path):
    store = ProjectStore(tmp_path/'p')
    text = starter()['yaml']
    project_id = store.create(text)['id']
    with ThreadPoolExecutor(max_workers=2) as pool:
        saved = list(pool.map(lambda _: store.simulate(text,project_id=project_id,result_folder_name='并发方案'),range(2)))
    assert {Path(r['storage']['results_dir']).name for r in saved} == {'并发方案','并发方案 (2)'}
    assert len(store.runs(project_id)) == 2


def test_named_search_and_failed_run_keep_correct_directory_layout(tmp_path):
    store = ProjectStore(tmp_path/'p')
    from resim.schema import loads, dumps
    p = loads(starter()['yaml']);p.search.candidates=2;p.search.time_limit_s=1
    saved = store.simulate(dumps(p),mode='optimize',result_folder_name='候选集合')
    info = saved['storage'];folder=Path(info['results_dir'])
    assert (folder/'baseline/report.html').is_file()
    assert (folder/'candidate-1/report.html').is_file()
    assert store.result(info['project_id'],info['run_id'])['result']['storage']==info
    p.floorplan.placements=[]
    with pytest.raises(ValueError):
        store.simulate(dumps(p),project_id=info['project_id'],result_folder_name='失败方案')
    failed = store.runs(info['project_id'])[0]
    assert failed['status']=='failed'
    assert Path(failed['results_dir']).name=='失败方案'
    assert store.snapshot(info['project_id'],failed['run_id'])==dumps(p)


def test_bundle_keeps_named_folders_and_relocates_paths(tmp_path):
    store = ProjectStore(tmp_path/'source')
    saved = store.simulate(starter()['yaml'],output_dir=str(tmp_path/'external'),result_folder_name='交付方案')
    info=saved['storage'];project=store.project_dir(info['project_id'])
    bundle=tmp_path/'project.zip'
    pack_project(project,bundle)
    destination=tmp_path/'imported'
    unpack_project(bundle,destination)
    restored=ProjectStore(destination).result(info['project_id'],info['run_id'])['result']
    expected=destination/info['project_id']/'交付方案'
    assert Path(restored['storage']['results_dir'])==expected
    assert restored['summary']==saved['summary']
    assert (expected/'report.html').is_file()
    raw=json.loads((expected/'resource-report.json').read_text(encoding='utf-8'))
    assert raw['storage']['results_dir']==str(expected)
    # A relocated project can be exported again; the index resolves to its named directory.
    assert pack_project(destination/info['project_id'],tmp_path/'again.zip')['runs']==1
