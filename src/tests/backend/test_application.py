import json
import os
import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from resim.paths import APPLICATION_ROOT, STATIC_ROOT, get_projects_root
from resim.workspace import ProjectStore, inside
from resim.schema import loads
from resim.server import app


def test_default_projects_live_outside_application(monkeypatch):
    monkeypatch.delenv('RESIM_PROJECTS_DIR',raising=False)
    root=get_projects_root()
    assert root == APPLICATION_ROOT.parent/'ResimProjects'
    assert not root.is_relative_to(APPLICATION_ROOT)


def test_project_store_override_is_dynamic(tmp_path,monkeypatch):
    monkeypatch.setenv('RESIM_PROJECTS_DIR',str(tmp_path/'external-projects'))
    assert ProjectStore().root==tmp_path/'external-projects'
    with TestClient(app) as client:
        assert client.get('/api/health').json()['projects_dir']==str(tmp_path/'external-projects')
        assert client.get('/api/projects').json()==[]
        assert client.get('/api/sources').json()['files']==[]
        assert client.get('/static/app.js').status_code==200
    assert not (tmp_path/'external-projects').exists()


@pytest.mark.skipif(os.name!='nt',reason='Windows extended-length paths')
def test_windows_extended_length_path_is_not_mistaken_for_escape(tmp_path):
    extended=Path('\\\\?\\'+str(tmp_path/'nested'/'file.yml'))
    assert inside(tmp_path,extended)==tmp_path/'nested'/'file.yml'


def test_relocated_project_resolves_history_from_new_directory(tmp_path):
    from resim.schema import dumps
    original=ProjectStore(tmp_path/'original')
    fixture=Path(__file__).resolve().parents[1]/'fixtures/projects/gemmini-10die/inputs/architecture.yml'
    meta=original.create(dumps(loads(fixture.read_text(encoding='utf-8'))),project_id='gemmini-10die')
    original.simulate(original.input(meta['id']),project_id=meta['id'])
    source=original.project_dir(meta['id'])
    destination=tmp_path/'projects/gemmini-10die'
    shutil.copytree(source,destination)
    store=ProjectStore(tmp_path/'projects')
    history=store.runs('gemmini-10die')
    assert history
    for item in history:
        assert Path(item['run_dir']).is_relative_to(destination)
    run=history[0]
    assert loads(store.snapshot('gemmini-10die',run['run_id']))
    payload=store.result('gemmini-10die',run['run_id'])
    assert Path(payload['result']['storage']['run_dir']).is_relative_to(destination)


def test_frontend_source_hashes_are_packaged_independently():
    import hashlib
    manifest=json.loads((STATIC_ROOT/'vendor/manifest.json').read_text(encoding='utf-8'))
    for item in manifest['files']:
        assert hashlib.sha256((STATIC_ROOT/'vendor'/item['path']).read_bytes()).hexdigest()==item['sha256']
