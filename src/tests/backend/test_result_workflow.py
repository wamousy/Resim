"""Draft searches must not save; named saves must remain identifiable after reload."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from resim.schema import loads, dumps
from resim.server import app, starter
from resim.workspace import ProjectStore


def input_text():
    project = loads(starter()['yaml'])
    project.search.candidates = 2
    project.search.time_limit_s = 1
    return dumps(project)


def test_search_preview_does_not_create_project_or_history(tmp_path, monkeypatch):
    root = tmp_path/'not-created'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    response = TestClient(app).post('/api/optimize/preview', json={'yaml': input_text()})
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result['candidates']) == 2
    assert 'storage' not in result
    assert not root.exists()


def test_named_save_survives_reload_and_duplicate_names_never_overwrite(tmp_path, monkeypatch):
    root = tmp_path/'projects'
    output = tmp_path/'outputs'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    client = TestClient(app)
    payload = {'yaml': input_text(), 'run_name': '  低拥塞 A <对比>  ', 'output_dir': str(output)}
    first = client.post('/api/evaluate', json=payload)
    assert first.status_code == 200, first.text
    storage = first.json()['storage']
    assert storage['run_name'] == '低拥塞 A <对比>'
    result_file = Path(storage['run_dir'])/'results/resource-report.json'
    snapshot = result_file.read_bytes()
    second = client.post('/api/evaluate', json={**payload, 'project_id': storage['project_id']})
    assert second.status_code == 200
    assert second.json()['storage']['run_id'] != storage['run_id']
    assert result_file.read_bytes() == snapshot
    store = ProjectStore(root)
    assert all(r['run_name'] == '低拥塞 A <对比>' for r in store.runs(storage['project_id']))
    assert store.result(storage['project_id'], storage['run_id'])['result']['storage']['run_name'] == '低拥塞 A <对比>'
    assert json.loads((Path(storage['run_dir'])/'run.json').read_text(encoding='utf-8'))['run_name'] == '低拥塞 A <对比>'
    html = (Path(storage['run_dir'])/'results/report.html').read_text(encoding='utf-8')
    assert '低拥塞 A &lt;对比&gt;' in html and '<对比>' not in html


@pytest.mark.parametrize('name', ['', '   ', 'a\nb', 'x'*121])
def test_invalid_result_name_is_rejected_without_writing(tmp_path, monkeypatch, name):
    root = tmp_path/'not-created'
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(root))
    response = TestClient(app).post('/api/evaluate', json={'yaml': input_text(), 'run_name': name})
    assert response.status_code == 422
    assert not root.exists()


def test_old_unnamed_result_remains_readable(tmp_path):
    store = ProjectStore(tmp_path/'p')
    result = store.simulate(input_text())
    info = result['storage']
    marker = Path(info['run_dir'])/'run.json'
    meta = json.loads(marker.read_text(encoding='utf-8'))
    meta.pop('run_name')
    marker.write_text(json.dumps(meta), encoding='utf-8')
    assert store.result(info['project_id'], info['run_id'])['result']['summary'] == result['summary']
    assert store.runs(info['project_id'])[0]['run_name'] is None
