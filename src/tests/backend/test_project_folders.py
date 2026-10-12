"""Complete projects in selected folders, with named result children."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from resim.server import app, starter, exports
from resim.workspace import ProjectStore
from resim_policy_portable import pack_project, unpack_project


@pytest.mark.parametrize('kind', ['new', 'empty', 'managed', 'default'])
def test_whole_project_and_results_share_the_selected_folder(tmp_path, monkeypatch, kind):
    registry = tmp_path/'registry'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(registry))
    folder = (registry/'custom-folder' if kind == 'managed' else tmp_path/'我的项目')
    if kind == 'empty':
        folder.mkdir()
    client = TestClient(app)
    body = dict(yaml=starter()['yaml'], project_name='测试芯片',
                project_dir='' if kind == 'default' else str(folder), result_folder_name='布局方案 A')
    response = client.post('/api/evaluate', json=body)
    assert response.status_code == 200, response.text
    saved = response.json()['storage'];pid=saved['project_id'];rid=saved['run_id']
    if kind == 'default':
        folder = registry/pid
    assert Path(saved['project_dir']) == folder
    assert Path(saved['results_dir']) == folder/'布局方案 A'
    for filename in ['project.json', 'inputs/chip-architecture.yml', 'inputs/technology.yml',
                     '布局方案 A/report.html', f'runs/{rid}/run.json']:
        assert (folder/filename).is_file(), filename
    if folder != registry/pid:
        assert not (registry/pid).exists()
    # Default-root folders are discovered on restart; external ones are opened.
    exports.clear()
    store = ProjectStore(registry)
    if kind in ('new', 'empty'):
        assert store.projects() == []
        store.open_project(str(folder))
    assert len(store.projects()) == 1
    assert store.projects()[0]['project_dir'] == str(folder)
    assert store.infer_project(folder/'inputs/chip-architecture.yml') == pid
    assert client.get(f'/api/projects/{pid}/input').status_code == 200
    assert client.get(f'/api/projects/{pid}/runs/{rid}/export/report.html').status_code == 200
    original = (folder/'布局方案 A/resource-report.json').read_bytes()
    second = client.post('/api/evaluate', json=dict(yaml=body['yaml'], project_id=pid, result_folder_name='布局方案 A'))
    assert second.status_code == 200, second.text
    assert Path(second.json()['storage']['results_dir']) == folder/'布局方案 A (2)'
    assert (folder/'布局方案 A/resource-report.json').read_bytes() == original


@pytest.mark.parametrize('kind', ['file', 'nonempty', 'relative', 'conflicting-fields'])
def test_invalid_project_location_does_not_overwrite_or_create_a_project(tmp_path, monkeypatch, kind):
    root = tmp_path/'registry'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    folder = tmp_path/'already-used'
    if kind == 'file': folder.write_text('keep')
    if kind == 'nonempty':
        folder.mkdir();(folder/'keep.txt').write_text('keep')
    body = dict(yaml=starter()['yaml'], project_dir='relative/path' if kind == 'relative' else str(folder), result_folder_name='结果')
    if kind == 'conflicting-fields': body['output_dir'] = str(tmp_path/'external')
    response = TestClient(app).post('/api/evaluate', json=body)
    assert response.status_code == 422, response.text
    assert not root.exists()
    if kind == 'file': assert folder.read_text() == 'keep'
    if kind == 'nonempty': assert list(folder.iterdir()) == [folder/'keep.txt']


def test_existing_project_cannot_be_redirected_and_children_cannot_be_new_projects(tmp_path):
    store = ProjectStore(tmp_path/'registry');text=starter()['yaml']
    folder=tmp_path/'完整项目'
    saved=store.simulate(text,project_dir=str(folder),result_folder_name='结果')['storage']
    for kwargs in [dict(project_dir=str(tmp_path/'other')), dict(output_dir=str(tmp_path/'elsewhere'))]:
        with pytest.raises(ValueError): store.simulate(text,project_id=saved['project_id'],**kwargs)
    with pytest.raises(ValueError, match='另一个项目'):
        store.create(text,project_dir=str(folder/'nested'))
    assert len(store.projects()) == 1
    assert len(store.runs(saved['project_id'])) == 1


def test_result_name_does_not_claim_the_history_index(tmp_path):
    store = ProjectStore(tmp_path/'registry')
    saved=store.simulate(starter()['yaml'],project_dir=str(tmp_path/'完整项目'),result_folder_name='runs')['storage']
    assert saved['result_folder_name'] == 'runs (2)'
    assert Path(saved['results_dir']).parent == Path(saved['project_dir'])
    assert len(store.runs(saved['project_id'])) == 1
    bundle=tmp_path/'archive.zip'
    assert pack_project(Path(saved['project_dir']),bundle)['runs']==1


def test_custom_project_archive_is_self_contained_and_relocatable(tmp_path):
    store=ProjectStore(tmp_path/'registry')
    saved=store.simulate(starter()['yaml'],project_dir=str(tmp_path/'芯片项目'),result_folder_name='实现性评估')['storage']
    archive=tmp_path/'chip.zip';pack_project(Path(saved['project_dir']),archive)
    imported=unpack_project(archive,tmp_path/'imported')
    target=Path(imported['project_dir'])
    loaded=ProjectStore(target.parent).result(saved['project_id'],saved['run_id'])['result']['storage']
    assert loaded['project_dir']==str(target)
    assert Path(loaded['results_dir'])==target/'实现性评估'
    report=json.loads((target/'实现性评估/resource-report.json').read_text(encoding='utf-8'))
    assert report['storage']['project_dir']==str(target)
    assert pack_project(target,tmp_path/'again.zip')['runs']==1


def test_legacy_named_result_remains_readable_after_the_next_save(tmp_path):
    store=ProjectStore(tmp_path/'registry');text=starter()['yaml']
    old=store.simulate(text,output_dir=str(tmp_path/'old-output'),result_folder_name='旧结果')['storage']
    original=Path(old['results_dir'])/'resource-report.json';before=original.read_bytes()
    new=store.simulate(text,project_id=old['project_id'],result_folder_name='新结果')['storage']
    assert Path(new['results_dir'])==store.project_dir(old['project_id'])/'新结果'
    assert store.result(old['project_id'],old['run_id'])['result']['storage']['results_dir']==old['results_dir']
    assert original.read_bytes()==before
