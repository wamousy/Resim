"""One exploration family, many self-contained independently evaluated plans.

The existing runs API keeps its per-plan record IDs for backwards compatibility.
batch_id identifies the exploration; its run.json owns only metadata and plan inventory.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from uuid import uuid4

from .engine import evaluate
from .export import save_report
from .schema import loads, dumps
from .workspace import (atomic_text, write_json, inside, safe_id, now,
                        normalize_result_folder_name, create_result_folder, validate_project_folder)
from resim_policy_storage import store_lock


def fingerprint(project, family=False):
    data = project.model_dump(mode='json')
    data.pop('name', None)
    if family:
        data['floorplan'].pop('placements', None)
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def batch_folders(root, project_id):
    """Discover committed batches from their own manifests, without duplicate indexes."""
    seen=set()
    for marker in sorted(root.glob('*/run.json')):
        folder=inside(root,marker.parent)
        meta=json.loads(inside(folder,marker).read_text(encoding='utf-8'))
        if meta.get('schema_version') not in ('resim-batch/1','resim-batch/2'):
            continue
        bid=safe_id(meta['batch_id'])
        if meta.get('project_id') != project_id or bid in seen:
            raise ValueError('Batch identity mismatch or duplicate batch')
        seen.add(bid)
        yield folder,meta


def batch_plans(root, project_id):
    seen=set()
    for folder,batch in batch_folders(root,project_id):
        for plan in batch['plans']:
            rid=safe_id(plan['record_id'])
            run=inside(folder,folder/plan['folder'])
            record=json.loads(inside(run,run/'run.json').read_text(encoding='utf-8'))
            if rid in seen or record.get('run_id')!=rid or record.get('project_id')!=project_id or record.get('batch_id')!=batch['batch_id']:
                raise ValueError('Batch plan identity mismatch')
            seen.add(rid)
            yield run,record


def find_batch(store, project_id, batch_id):
    project_id=store.project(project_id)['id']
    safe_id(batch_id)
    return next(((folder,meta) for folder,meta in batch_folders(store.project_dir(project_id),project_id)
                 if meta['batch_id']==batch_id),None)


def read_batch(store, project_id, batch_id):
    found=find_batch(store,project_id,batch_id)
    if found is None: raise FileNotFoundError('Unknown batch: '+batch_id)
    return found


def batch_payload(store, project_id, batch_id):
    with store_lock(store.root):
        folder, meta = read_batch(store, project_id, batch_id)
        if meta['schema_version']=='resim-batch/1':
            text=(folder/'inputs/input.yml').read_text(encoding='utf-8')
        else:
            if not meta['plans']:raise ValueError('此批次尚无已保存方案')
            text=store.snapshot(project_id,meta['plans'][0]['record_id'])
        return dict(batch=meta,batch_dir=str(folder),base_yaml=text)


def save_plan(store, request):
    # Validate and evaluate before creating any project or batch directories.
    base, project = loads(request.base_yaml), loads(request.yaml)
    batch_id = safe_id(request.batch_id)
    batch_name = normalize_result_folder_name(request.batch_name)
    plan_name = normalize_result_folder_name(request.plan_name)
    if not batch_name or not plan_name:
        raise ValueError('请填写批次文件夹名称和方案名称')
    if fingerprint(base, True) != fingerprint(project, True):
        raise ValueError('架构、工艺、约束或搜索配置已变化，请建立新批次')
    if request.project_id and request.project_dir is not None:
        raise ValueError('已有项目不能更改项目文件夹')
    report = evaluate(project)
    if request.preview_plan_id != report['plan_id']:
        raise ValueError('保存内容与预览不一致，请重新应用预览')
    if request.candidate_metadata:
        report['candidate'] = deepcopy(request.candidate_metadata)
    digest = fingerprint(project)
    with store_lock(store.root):
        # Resolve retry after a first-save response was lost, including a new project.
        project_id = request.project_id
        if project_id is None:
            matches = [p['id'] for p in store.projects() if find_batch(store,p['id'],batch_id) is not None]
            if len(matches) > 1: raise ValueError('Duplicate batch identity')
            if matches: project_id = matches[0]
        if project_id:
            store.project(project_id)
        else:
            validate_project_folder(request.project_dir)
            project_id = store.create(request.base_yaml, name=request.project_name, project_dir=request.project_dir)['id']
        root = store.project_dir(project_id)
        existing_batch=find_batch(store,project_id,batch_id)
        if existing_batch is not None:
            folder, meta = existing_batch
            if meta['family_sha256'] != fingerprint(base,True) or (meta['schema_version']=='resim-batch/1' and meta['input_sha256'] != fingerprint(base)):
                raise ValueError('批次架构、工艺或约束已经变化，请建立新批次')
            if meta['name'] != batch_name:
                raise ValueError('已保存批次的名称不能在追加方案时更改')
        else:
            folder = create_result_folder(root,batch_name)
            meta = dict(schema_version='resim-batch/2',batch_id=batch_id,project_id=project_id,
                        name=batch_name,folder=folder.name,created_at=now(),kind=request.kind,
                        initial_input_sha256=fingerprint(base),family_sha256=fingerprint(base,True),
                        simulator_version=report['simulator_version'],provenance=deepcopy(report.get('provenance',{})),
                        search_config=base.search.model_dump(mode='json'),
                        search_metadata=deepcopy(request.search_metadata),plans=[])
            write_json(folder/'run.json',meta)
        for existing in meta['plans']:
            if existing['source_key'] == request.source_key and existing['input_sha256'] == digest:
                return dict(batch=meta,report=store.result(project_id,existing['record_id'])['result'],reused=True)
        if request.parent_record_id:
            if not any(p['record_id']==request.parent_record_id for p in meta['plans']):
                raise ValueError('父方案必须属于同一批次')
        record_id='plan-'+uuid4().hex
        target=create_result_folder(folder,plan_name)
        stage=Path(tempfile.mkdtemp(prefix='.pending-',dir=folder))
        entry=dict(record_id=record_id,source_key=request.source_key,input_sha256=digest,
                   plan_id=report['plan_id'],name=plan_name,folder=target.name,
                   parent_record_id=request.parent_record_id,parent_source_key=request.parent_source_key,
                   created_at=now())
        storage=dict(project_id=project_id,project_name=store.project(project_id)['name'],project_dir=str(root),
                     run_id=record_id,run_name=plan_name,run_dir=str(target),results_dir=str(target),
                     results_subdir='.',result_folder_name=target.name,batch_id=batch_id,
                     batch_name=meta['name'],batch_dir=str(folder),source_key=request.source_key,
                     parent_record_id=request.parent_record_id,parent_source_key=request.parent_source_key)
        record=dict(**storage,mode='evaluate',status='completed',created_at=entry['created_at'],
                    finished_at=now(),input_sha256=digest,simulator_version=report['simulator_version'],
                    output_run_dir=str(target),assessment_status=report['status'])
        compact=meta['schema_version']=='resim-batch/2'
        if compact:
            record['input_layout']='per-plan/2'
            report['storage_format']='resim-report/2'
        report['storage']=storage
        committed=False
        try:
            if compact:
                save_report(report,stage,compact=True)
            else:
                # An old batch keeps one uniform legacy layout when appended to.
                atomic_text(stage/'input.yml',request.yaml)
                atomic_text(stage/'resolved-input.yml',dumps(project))
                save_report(report,stage)
            write_json(stage/'run.json',record)
            # Only move files under the verified batch folder into its reserved empty child.
            inside(folder,stage);inside(folder,target)
            for file in stage.iterdir(): file.rename(target/file.name)
            updated=deepcopy(meta);updated['plans'].append(entry);updated['updated_at']=now()
            write_json(folder/'run.json',updated)
            committed=True
            return dict(batch=updated,report=report,reused=False)
        finally:
            if stage.exists() and stage.parent==folder and stage.name.startswith('.pending-'):
                shutil.rmtree(stage)
            if not committed and target.exists() and target.parent==folder:
                shutil.rmtree(target)
