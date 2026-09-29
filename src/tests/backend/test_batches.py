import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from resim.server import app, starter, get_store
from resim.schema import loads, dumps
from resim.engine import evaluate
from resim.workspace import ProjectStore
from resim.batches import batch_payload
from resim_policy_portable import pack_project, unpack_project


def request_body(tmp_path):
    text=starter()['yaml'];p=loads(text)
    return dict(batch_id='batch-'+str(uuid4()),batch_name='第一次探索',plan_name='方案一',
                project_name='芯片测试',project_dir=str(tmp_path/'芯片项目'),kind='optimize',
                base_yaml=text,yaml=text,preview_plan_id=evaluate(p)['plan_id'],source_key='candidate-1',
                search_metadata={'elapsed_s':1.2,'solver_statuses':['OPTIMAL'],'generated_candidates':2},
                candidate_metadata={'solver_status':'OPTIMAL','accepted':False,'surrogate_objective':10,'objective_bound':10})


def post(client,body):
    response=client.post('/api/batches/save-plan',json=body)
    assert response.status_code==200,response.text
    return response.json()


def changed(body,storage):
    p=loads(body['yaml']);p.floorplan.placements[0].x_um+=100
    return {**body,'project_id':storage['project_id'],'project_dir':None,'yaml':dumps(p),
            'source_key':'manual-1','preview_plan_id':evaluate(p)['plan_id'],'plan_name':'手工调整',
            'parent_record_id':storage['run_id'],'parent_source_key':storage['source_key'],'candidate_metadata':None}


def test_one_batch_freezes_inputs_and_keeps_independent_plans(tmp_path):
    client=TestClient(app);body=request_body(tmp_path)
    a=post(client,body);s=a['report']['storage'];b=post(client,changed(body,s));t=b['report']['storage']
    root=Path(s['project_dir']);folder=Path(s['batch_dir'])
    assert folder==root/'第一次探索'
    assert Path(s['results_dir'])==folder/'方案一'
    assert Path(t['results_dir'])==folder/'手工调整'
    expected={'run.json','inputs/chip-architecture.yml','inputs/technology.yml','floorplan.svg',
              'implementation-difficulties.md','resource-report.json','report.html'}
    assert not (folder/'inputs').exists()
    for storage in (s,t):
        plan=Path(storage['results_dir'])
        assert {p.relative_to(plan).as_posix() for p in plan.rglob('*') if p.is_file()}==expected
        disk=json.loads((plan/'resource-report.json').read_text(encoding='utf-8'))
        assert 'project' not in disk
        assert disk['storage_format']=='resim-report/2'
    assert loads(get_store().snapshot(s['project_id'],s['run_id'])).floorplan.placements[0].x_um==1000
    assert loads(get_store().snapshot(t['project_id'],t['run_id'])).floorplan.placements[0].x_um==1100
    assert b['batch']['search_metadata']==body['search_metadata']
    assert len(b['batch']['plans'])==2
    assert t['parent_record_id']==s['run_id']
    store=get_store();rows=store.runs(s['project_id'])
    assert {r['batch_id'] for r in rows}=={body['batch_id']}
    assert len(rows)==2
    assert {p.name for p in root.iterdir()}=={'inputs','project.json','第一次探索'}
    # Current inputs are not overwritten by the last candidate saved in a bulk operation.
    assert loads(store.input(s['project_id'])).floorplan.placements[0].x_um==1000
    saved=store.result(s['project_id'],s['run_id'])['result']
    assert saved['candidate']['solver_status']=='OPTIMAL'
    assert client.get(f"/api/projects/{s['project_id']}/runs/{t['run_id']}/export/report.html").status_code==200


def test_retry_of_first_save_is_idempotent_even_for_custom_project_folder(tmp_path):
    client=TestClient(app);body=request_body(tmp_path)
    first=post(client,body);again=post(client,body)
    assert again['reused'] is True
    assert first['report']['storage']==again['report']['storage']
    assert len(get_store().projects())==1
    assert len(again['batch']['plans'])==1


def test_moved_project_opens_batch_history_and_saves_next_plan_without_old_paths(tmp_path):
    client=TestClient(app);body=request_body(tmp_path)
    first=post(client,body)['report']['storage']
    original=Path(first['project_dir']);moved=tmp_path/'已搬迁的芯片'
    original.rename(moved)
    opened=client.post('/api/projects/open',json={'project_dir':str(moved)})
    assert opened.status_code==200,opened.text
    saved=get_store().result(first['project_id'],first['run_id'])['result']
    assert Path(saved['storage']['batch_dir'])==moved/body['batch_name']
    assert Path(saved['storage']['results_dir'])==moved/body['batch_name']/body['plan_name']
    assert saved['plan_id']==body['preview_plan_id']
    second=post(client,changed(body,first))['report']['storage']
    assert Path(second['results_dir']).is_relative_to(moved)
    assert not original.exists()


def test_wrong_preview_and_changed_family_are_rejected_before_saving(tmp_path):
    client=TestClient(app);body=request_body(tmp_path)
    assert client.post('/api/batches/save-plan',json={**body,'preview_plan_id':'stale'}).status_code==422
    assert not Path(body['project_dir']).exists()
    first=post(client,body);s=first['report']['storage']
    p=loads(body['yaml']);p.resources.technology='changed technology'
    changed_body={**body,'project_id':s['project_id'],'project_dir':None,'yaml':dumps(p),'preview_plan_id':evaluate(p)['plan_id']}
    assert client.post('/api/batches/save-plan',json=changed_body).status_code==422
    # Even replacing base input cannot silently append to an existing frozen batch.
    assert client.post('/api/batches/save-plan',json={**changed_body,'base_yaml':dumps(p)}).status_code==422
    other=post(client,{**changed_body,'base_yaml':dumps(p),'batch_id':'batch-'+str(uuid4())})
    assert other['report']['storage']['batch_dir']!=s['batch_dir']


def test_parent_identity_and_duplicate_names(tmp_path):
    client=TestClient(app);body=request_body(tmp_path);a=post(client,body)['report']['storage']
    second=changed(body,a);second['plan_name']=body['plan_name']
    second['parent_record_id']='unknown'
    assert client.post('/api/batches/save-plan',json=second).status_code==422
    second['parent_record_id']=a['run_id']
    b=post(client,second)['report']['storage']
    assert Path(b['results_dir']).name=='方案一 (2)'
    assert Path(a['results_dir']).name=='方案一'


def test_failed_report_does_not_commit_partial_plan_and_retry_recovers(tmp_path,monkeypatch):
    import resim.batches as batches
    client=TestClient(app);body=request_body(tmp_path);a=post(client,body)['report']['storage']
    original=(Path(a['results_dir'])/'resource-report.json').read_bytes()
    save=batches.save_report
    def fail(report,folder,**kwargs):
        (folder/'partial.txt').write_text('incomplete')
        raise OSError('disk failure')
    monkeypatch.setattr(batches,'save_report',fail)
    with pytest.raises(OSError): client.post('/api/batches/save-plan',json=changed(body,a))
    assert len(get_store().runs(a['project_id']))==1
    assert not (Path(a['batch_dir'])/'手工调整').exists()
    assert not list(Path(a['batch_dir']).glob('.pending-*'))
    assert (Path(a['results_dir'])/'resource-report.json').read_bytes()==original
    monkeypatch.setattr(batches,'save_report',save)
    assert len(post(client,changed(body,a))['batch']['plans'])==2


def test_committed_batch_reads_history_without_writing_indexes(tmp_path):
    body=request_body(tmp_path);s=post(TestClient(app),body)['report']['storage']
    root=Path(s['project_dir'])
    for _ in range(2):
        assert get_store().runs(s['project_id'])[0]['run_id']==s['run_id']
        assert batch_payload(get_store(),s['project_id'],body['batch_id'])['batch']['plans'][0]['record_id']==s['run_id']
    assert not (root/'runs').exists()
    assert not (root/'_batch-index').exists()
    assert not (Path(s['batch_dir'])/'inputs').exists()


def test_project_bundle_preserves_batch_inputs_grouping_and_lineage(tmp_path):
    client=TestClient(app);body=request_body(tmp_path);a=post(client,body)['report']['storage'];b=post(client,changed(body,a))['report']['storage']
    archive=tmp_path/'project.zip';pack_project(Path(a['project_dir']),archive)
    imported=unpack_project(archive,tmp_path/'new-machine');store=ProjectStore(tmp_path/'new-machine')
    root=Path(imported['project_dir']);payload=batch_payload(store,a['project_id'],body['batch_id'])
    assert len(payload['batch']['plans'])==2
    assert Path(payload['batch_dir'])==root/'第一次探索'
    assert not (Path(payload['batch_dir'])/'inputs').exists()
    assert not (root/'runs').exists()
    assert not (root/'_batch-index').exists()
    for storage in (a,b):
        result=store.result(storage['project_id'],storage['run_id'])['result']
        assert result['storage']['batch_dir']==str(root/'第一次探索')
        assert Path(result['storage']['results_dir']).parent==root/'第一次探索'
    assert store.result(b['project_id'],b['run_id'])['result']['storage']['parent_record_id']==a['run_id']
    assert pack_project(root,tmp_path/'again.zip')['runs']==2


def test_legacy_batch_indexes_are_read_without_duplicates_or_new_pointers(tmp_path):
    client=TestClient(app);body=request_body(tmp_path);a=post(client,body)['report']['storage']
    root=Path(a['project_dir']);record=(Path(a['results_dir'])/'run.json').read_bytes()
    pointer=root/'runs'/a['run_id']/'run.json';pointer.parent.mkdir(parents=True);pointer.write_bytes(record)
    index=root/'_batch-index'/(body['batch_id']+'.json');index.parent.mkdir()
    index.write_text(json.dumps({'batch_id':body['batch_id'],'folder':'第一次探索'}),encoding='utf-8')
    b=post(client,changed(body,a))['report']['storage']
    assert len(get_store().runs(a['project_id']))==2
    assert not (root/'runs'/b['run_id']).exists()
    assert pointer.read_bytes()==record
    assert pack_project(root,tmp_path/'legacy-batch.zip')['runs']==2
    pointer.unlink();pointer.parent.rmdir();pointer.parent.parent.rmdir();index.unlink();index.parent.rmdir()
    # Redundant old pointers are not required to load either plan or rebuild history.
    assert len(get_store().runs(a['project_id']))==2
    assert get_store().result(a['project_id'],a['run_id'])['result']['plan_id']


def test_batch_project_display_name_does_not_define_its_folder(tmp_path):
    client=TestClient(app);body=request_body(tmp_path)
    body.update(project_name='Display name / can differ',project_dir='')
    s=post(client,body)['report']['storage']
    assert s['project_name']=='Display name / can differ'
    assert Path(s['project_dir']).name.startswith('project-')
    assert 'display' not in s['project_id']


def test_plan_can_be_copied_and_recomputed_from_its_own_inputs(tmp_path):
    import shutil
    import xml.etree.ElementTree as ET
    from resim.plan_files import input_snapshot
    saved=post(TestClient(app),request_body(tmp_path))['report'];s=saved['storage']
    copy=tmp_path/'standalone-plan';shutil.copytree(s['results_dir'],copy)
    p=loads(input_snapshot(copy));again=evaluate(p)
    assert again['summary']==saved['summary']
    assert again['plan_id']==saved['plan_id']
    svg=ET.fromstring((copy/'floorplan.svg').read_text(encoding='utf-8'))
    assert {node.attrib['data-module'] for node in svg.iter() if 'data-module' in node.attrib}=={m.id for m in p.architecture.modules}
    assert '封装坐标俯视' in ''.join(svg.itertext())


def test_modified_archived_input_is_not_silently_paired_with_old_metrics(tmp_path):
    from resim.plan_files import save_inputs
    client=TestClient(app);body=request_body(tmp_path);s=post(client,body)['report']['storage']
    p=loads(body['yaml']);p.floorplan.placements[0].x_um+=100
    save_inputs(p,s['results_dir'])
    result=client.get(f"/api/projects/{s['project_id']}/runs/{s['run_id']}/result")
    assert result.status_code==422
    assert '输入已被修改' in result.json()['detail']


def test_reopened_batch_uses_plan_input_and_accepts_more_layouts(tmp_path):
    client=TestClient(app);body=request_body(tmp_path)
    p=loads(body['yaml']);p.floorplan.placements[0].x_um+=100
    body.update(yaml=dumps(p),preview_plan_id=evaluate(p)['plan_id'])
    s=post(client,body)['report']['storage']
    reopened=batch_payload(get_store(),s['project_id'],body['batch_id'])
    assert loads(reopened['base_yaml']).floorplan.placements[0].x_um==1100
    next_body=changed(body,s);next_body['base_yaml']=reopened['base_yaml']
    assert len(post(client,next_body)['batch']['plans'])==2


def test_legacy_batch_append_keeps_its_uniform_format_and_can_be_bundled(tmp_path):
    from resim.plan_files import save_inputs
    from resim.batches import fingerprint
    body=request_body(tmp_path);store=get_store();p=loads(body['base_yaml'])
    pid=store.create(body['base_yaml'],project_dir=body['project_dir'])['id']
    folder=store.project_dir(pid)/body['batch_name'];folder.mkdir();save_inputs(p,folder)
    (folder/'inputs/input.yml').write_text(dumps(p),encoding='utf-8')
    meta=dict(schema_version='resim-batch/1',batch_id=body['batch_id'],project_id=pid,name=body['batch_name'],folder=folder.name,
              input_sha256=fingerprint(p),family_sha256=fingerprint(p,True),kind='optimize',search_metadata={},plans=[])
    (folder/'run.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
    body.update(project_id=pid,project_dir=None)
    a=post(TestClient(app),body)['report']['storage'];b=post(TestClient(app),changed(body,a))['report']['storage']
    for s in (a,b):
        plan=Path(s['results_dir']);assert (plan/'input.yml').exists();assert (plan/'layout-plan.yml').exists();assert not (plan/'inputs').exists()
    archive=tmp_path/'legacy.zip';pack_project(store.project_dir(pid),archive)
    restored=unpack_project(archive,tmp_path/'legacy-restored');target=Path(restored['project_dir'])
    assert (target/body['batch_name']/'inputs/input.yml').exists()
    assert ProjectStore(target.parent).result(pid,b['run_id'])['result']['project']
