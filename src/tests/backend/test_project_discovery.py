"""Self-describing folders, transient external projects and old marker compatibility."""
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from resim.server import app, starter, get_store, session_store
from resim.workspace import ProjectStore


@pytest.mark.parametrize('alias', [False, True])
def test_mixed_case_folder_does_not_replace_project_identity(tmp_path, monkeypatch, alias):
    root = tmp_path/'projects'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    store = ProjectStore(root)
    folder = root/'chipS'
    text = starter()['yaml']
    store.create(text, project_id='chips', name='chipS', project_dir=str(folder))
    store.create(text, project_id='another', name='Another')
    if alias:
        (root/'_project-aliases.json').write_text(json.dumps({'old-chip':'chips'}), encoding='utf-8')
    requested = 'old-chip' if alias else 'chips'
    before = {p.relative_to(folder):p.read_bytes() for p in folder.rglob('*') if p.is_file()}
    # A fresh session must resolve the ID from metadata, including on Windows
    # where Path.resolve() returns the existing directory's mixed-case spelling.
    assert ProjectStore(root).project_dir(requested) == folder
    client = TestClient(app)
    listed = client.get('/api/projects')
    assert listed.status_code == 200, listed.text
    assert {p['id'] for p in listed.json()} == {'chips', 'another'}
    assert client.post('/api/projects/open', json={'project_dir':str(folder)}).status_code == 200
    inputs = client.get(f'/api/projects/{requested}/input')
    assert inputs.status_code == 200, inputs.text
    assert client.get(f'/api/projects/{requested}/runs').json() == []
    assert client.post('/api/preview', json={'yaml':inputs.text}).status_code == 200
    assert {p.relative_to(folder):p.read_bytes() for p in folder.rglob('*') if p.is_file()} == before
    result = store.simulate(text, project_id=requested, result_folder_name='saved')
    assert result['storage']['project_id'] == 'chips'
    assert Path(result['storage']['run_dir']).is_relative_to(folder)
    assert len(ProjectStore(root).runs(requested)) == 1


def test_scan_accepts_unicode_folder_and_survives_rename_without_index(tmp_path):
    root = tmp_path/'projects'
    store = ProjectStore(root)
    folder = root/'芯片布局 A'
    meta = store.create(starter()['yaml'], name='项目显示名称', project_dir=str(folder))
    renamed = root/'重新命名 B'
    folder.rename(renamed)
    fresh = ProjectStore(root)
    assert fresh.projects()[0]['id'] == meta['id']
    assert fresh.project_dir(meta['id']) == renamed
    assert store.project_dir(meta['id']) == renamed  # stale session path is ignored
    assert len(fresh.input(meta['id'])) > 0
    assert not (root/meta['id']).exists()
    assert not list(root.rglob('_project-location.json'))
    assert not list(root.glob('*index*'))


def test_external_open_is_session_only_and_history_remains_self_contained(tmp_path, monkeypatch):
    root = tmp_path/'managed'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    folder = tmp_path/'外部工程'
    external = ProjectStore(tmp_path/'elsewhere')
    saved = external.simulate(starter()['yaml'], project_dir=str(folder), result_folder_name='方案 A')['storage']
    pid, rid = saved['project_id'], saved['run_id']
    client = TestClient(app)
    assert client.get('/api/projects').json() == []
    # Opening does not copy or rewrite valid project/input/report files.
    before = {p.relative_to(folder): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
    opened = client.post('/api/projects/open', json={'project_dir': str(folder)})
    assert opened.status_code == 200, opened.text
    assert opened.json()['id'] == pid
    assert [p['id'] for p in client.get('/api/projects').json()] == [pid]
    assert client.get(f'/api/projects/{pid}/input').status_code == 200
    assert client.get(f'/api/projects/{pid}/runs/{rid}/result').status_code == 200
    assert client.get(f'/api/projects/{pid}/runs/{rid}/export/report.html').status_code == 200
    assert {p.relative_to(folder): p.read_bytes() for p in folder.rglob('*') if p.is_file()} == before
    assert not (root/pid).exists()
    session_store.cache_clear()  # equivalent to stopping and starting the service
    assert client.get('/api/projects').json() == []
    assert client.get(f'/api/projects/{pid}/input').status_code == 404
    assert client.post('/api/projects/open', json={'project_dir': str(folder)}).status_code == 200
    assert client.get(f'/api/projects/{pid}/runs/{rid}/result').status_code == 200
    assert get_store().project_dir(pid) == folder


def test_scan_ignores_unrelated_corrupt_and_broken_legacy_folders(tmp_path):
    store = ProjectStore(tmp_path)
    meta = store.create(starter()['yaml'], project_dir=str(tmp_path/'valid title'))
    for name, text in [('corrupt', '{'), ('wrong-shape', '[]'), ('missing-id', '{}')]:
        folder = tmp_path/name
        folder.mkdir()
        (folder/'project.json').write_text(text, encoding='utf-8')
    (tmp_path/'unrelated').mkdir()
    marker = tmp_path/'broken'
    marker.mkdir()
    (marker/'_project-location.json').write_text('{}', encoding='utf-8')
    assert [p['id'] for p in store.projects()] == [meta['id']]


def test_legacy_marker_is_deduplicated_and_can_be_removed_for_local_project(tmp_path):
    store = ProjectStore(tmp_path)
    folder = tmp_path/'test'
    meta = store.create(starter()['yaml'], project_dir=str(folder))
    marker = tmp_path/meta['id']
    marker.mkdir()
    index = marker/'_project-location.json'
    index.write_text(json.dumps({'id': meta['id'], 'project_dir': str(folder)}), encoding='utf-8')
    assert len(ProjectStore(tmp_path).projects()) == 1
    index.unlink()
    marker.rmdir()
    assert ProjectStore(tmp_path).project_dir(meta['id']) == folder


def test_legacy_external_marker_remains_readable(tmp_path):
    root = tmp_path/'registry'
    store = ProjectStore(root)
    folder = tmp_path/'external'
    meta = store.create(starter()['yaml'], project_dir=str(folder))
    marker = root/meta['id']
    marker.mkdir()
    (marker/'_project-location.json').write_text(json.dumps({'id': meta['id'], 'project_dir': str(folder)}), encoding='utf-8')
    assert ProjectStore(root).project_dir(meta['id']) == folder


def test_duplicate_ids_are_rejected_without_redirecting_existing_project(tmp_path):
    root = tmp_path/'projects'
    store = ProjectStore(root)
    folder = root/'original'
    meta = store.create(starter()['yaml'], project_dir=str(folder))
    copy = tmp_path/'copied'
    shutil.copytree(folder, copy)
    with pytest.raises(ValueError, match='同一项目编号'):
        store.open_project(str(copy))
    assert store.project_dir(meta['id']) == folder
    shutil.copytree(folder, root/'duplicate')
    with pytest.raises(ValueError, match='同一项目编号'):
        store.project_dir(meta['id'])


@pytest.mark.parametrize('kind', ['missing', 'relative', 'no-manifest', 'invalid-input'])
def test_invalid_open_does_not_register_or_create_project(tmp_path, monkeypatch, kind):
    root = tmp_path/'managed'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    folder = tmp_path/'external'
    if kind == 'no-manifest':
        folder.mkdir()
    if kind == 'invalid-input':
        ProjectStore(tmp_path/'creator').create(starter()['yaml'], project_dir=str(folder))
        (folder/'inputs/technology.yml').write_text('not: a library', encoding='utf-8')
    response = TestClient(app).post('/api/projects/open', json={'project_dir': 'relative' if kind == 'relative' else str(folder)})
    assert response.status_code in (404, 422), response.text
    assert get_store().projects() == []
    assert not list(root.glob('project-*'))


def test_creating_external_child_rejects_unopened_parent_project(tmp_path):
    folder = tmp_path/'external'
    ProjectStore(tmp_path/'first').create(starter()['yaml'], project_dir=str(folder))
    with pytest.raises(ValueError, match='另一个项目'):
        ProjectStore(tmp_path/'second').create(starter()['yaml'], project_dir=str(folder/'nested'))
