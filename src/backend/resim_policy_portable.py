"""Portable project archives with external runs gathered and verified before import."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import shutil
import tempfile
import uuid
import zipfile

LIMIT = 2 * 1024 ** 3


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def pack_project(folder, output):
    folder, output = Path(folder).resolve(), Path(output).resolve()
    if output.exists(): raise FileExistsError('Archive already exists')
    meta = read_json(folder / 'project.json')
    from resim.workspace import safe_id
    safe_id(meta['id'])
    sources = {'project/project.json': folder / 'project.json'}
    for name in ('chip-architecture.yml', 'technology.yml'):
        sources['project/inputs/' + name] = folder / 'inputs' / name
    from resim.workspace import inside
    from resim.batches import batch_folders, batch_plans
    batches=[]
    for batch,record in batch_folders(folder,meta['id']):
        bid=record['batch_id'];batches.append(bid)
        names=('run.json',) if record['schema_version']=='resim-batch/2' else ('run.json','inputs/input.yml','inputs/chip-architecture.yml','inputs/technology.yml')
        for name in names:
            path=inside(batch,batch/name)
            sources['project/_batch-data/'+bid+'/'+name]=path
    runs = []
    records={record['run_id']:(run,record) for run,record in batch_plans(folder,meta['id'])}
    for pointer in sorted((folder / 'runs').glob('*/run.json')):
        if pointer.parent.name in records: continue
        record = read_json(pointer)
        run = Path(record.get('output_run_dir') or pointer.parent).resolve()
        actual = read_json(run / 'run.json')
        if actual.get('project_id') != meta['id'] or actual.get('run_id') != pointer.parent.name:
            raise ValueError('External run identity mismatch')
        records[pointer.parent.name]=(run,actual)
    for rid,(run,record) in sorted(records.items()):
        if record.get('status') == 'running': raise ValueError('Cannot pack a running project')
        runs.append({'id': rid, 'original_path': str(run)})
        for path in sorted(run.rglob('*')):
            if path.is_symlink() or not path.resolve().is_relative_to(run):
                raise ValueError('Run contains a link outside its directory')
            if path.is_file(): sources['runs/' + rid + '/' + path.relative_to(run).as_posix()] = path
    if sum(p.stat().st_size for p in sources.values()) > LIMIT: raise ValueError('Archive exceeds 2 GiB limit')
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name('.' + output.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        files = {}
        with zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, path in sources.items():
                data = path.read_bytes()
                files[name] = {'sha256': digest(data), 'size': len(data)}
                archive.writestr(name, data)
            archive.writestr('bundle.json', json.dumps({'format': 'resim-project-bundle/1', 'project_id': meta['id'], 'runs': runs, 'batches':batches, 'files': files}, ensure_ascii=False))
        # Publish only a complete ZIP, exclusively; never overwrite another export.
        os.link(temp, output)
    finally:
        temp.unlink(missing_ok=True)
    return {'archive': str(output), 'runs': len(runs), 'files': len(files)}


def unpack_project(archive_path, projects):
    projects = Path(projects).resolve()
    projects.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)): raise ValueError('Duplicate archive entries')
        if sum(item.file_size for item in archive.infolist()) > LIMIT: raise ValueError('Archive exceeds 2 GiB limit')
        manifest = json.loads(archive.read('bundle.json'))
        if manifest.get('format') != 'resim-project-bundle/1': raise ValueError('Unsupported bundle format')
        project_id = manifest.get('project_id', '')
        if not project_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in project_id):
            raise ValueError('Invalid project ID')
        target = projects / project_id
        if target.exists(): raise FileExistsError('Project already exists: ' + project_id)
        files = manifest['files']
        if set(names) != set(files) | {'bundle.json'}: raise ValueError('Archive file inventory mismatch')
        for name in files:
            parts = PurePosixPath(name).parts
            if '\\' in name or ':' in name or name.startswith('/') or '..' in parts or not parts or parts[0] not in ('project', 'runs'):
                raise ValueError('Unsafe archive path')
            if any(part.endswith((' ', '.')) or part.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))} for part in parts):
                raise ValueError('Unsafe platform path')
        if len({name.casefold() for name in files}) != len(files): raise ValueError('Case-colliding archive paths')
        stage = Path(tempfile.mkdtemp(prefix='.resim-import-', dir=projects))
        try:
            run_ids = {r['id'] for r in manifest['runs']}
            if any(not rid or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in rid) for rid in run_ids):
                raise ValueError('Invalid run ID')
            for name, expected in files.items():
                data = archive.read(name)
                if len(data) != expected['size'] or digest(data) != expected['sha256']: raise ValueError('Archive checksum mismatch: ' + name)
                parts = PurePosixPath(name).parts
                if parts[0] == 'runs' and (len(parts) < 3 or parts[1] not in run_ids): raise ValueError('Unlisted run')
                relative = PurePosixPath(*parts[1:]) if parts[0] == 'project' else PurePosixPath(*parts)
                dest = stage / str(relative)
                if dest.exists(): raise ValueError('Duplicate extraction target')
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            if read_json(stage / 'project.json')['id'] != project_id: raise ValueError('Project identity mismatch')
            for required in ('chip-architecture.yml','technology.yml'):
                if not (stage / 'inputs' / required).is_file(): raise ValueError('Missing split input')
            from resim.workspace import create_result_folder, normalize_result_folder_name, safe_id
            batch_targets={};batch_records={}
            for bid in manifest.get('batches',[]):
                safe_id(bid)
                if bid in batch_targets: raise ValueError('Duplicate batch')
                source=stage/'_batch-data'/bid
                record=read_json(source/'run.json')
                if record.get('batch_id')!=bid or record.get('project_id')!=project_id: raise ValueError('Batch identity mismatch')
                if not {p['record_id'] for p in record['plans']} <= run_ids: raise ValueError('Batch has missing plans')
                destination=create_result_folder(stage,normalize_result_folder_name(record['folder']))
                if not source.resolve().is_relative_to(stage) or not destination.resolve().is_relative_to(stage): raise ValueError('Batch relocation escapes staging')
                if record.get('schema_version')=='resim-batch/1':
                    (source/'inputs').rename(destination/'inputs')
                elif record.get('schema_version')!='resim-batch/2':raise ValueError('Unsupported batch version')
                (source/'run.json').unlink();source.rmdir()
                record['folder']=destination.name
                batch_targets[bid]=destination;batch_records[bid]=record
            if (stage/'_batch-data').exists(): (stage/'_batch-data').rmdir()
            def relocate(value, run_target, folder_name):
                if isinstance(value, list): return [relocate(v, run_target, folder_name) for v in value]
                if not isinstance(value, dict): return value
                result = {k: relocate(v, run_target, folder_name) for k, v in value.items() if k != 'output_run_dir'}
                if 'run_dir' in result: result['run_dir'] = str(run_target)
                if 'project_dir' in result: result['project_dir'] = str(target)
                if 'results_dir' in result: result['results_dir'] = str(run_target if folder_name else run_target/'results')
                if folder_name and 'result_folder_name' in result: result['result_folder_name'] = folder_name
                if result.get('batch_id') in batch_targets and 'batch_dir' in result:
                    result['batch_dir']=str(target/batch_targets[result['batch_id']].relative_to(stage))
                return result
            for rid in sorted(run_ids):
                source = stage/'runs'/rid
                record = read_json(source/'run.json')
                if record.get('project_id') != project_id or record.get('run_id') != rid: raise ValueError('Run identity mismatch')
                named = record.get('results_subdir') == '.'
                if named:
                    from resim.workspace import create_result_folder, normalize_result_folder_name
                    folder_name = normalize_result_folder_name(record.get('result_folder_name'))
                    if not folder_name: raise ValueError('Missing named result folder')
                    bid=record.get('batch_id')
                    if bid and bid not in batch_targets: raise ValueError('Missing batch metadata')
                    destination = create_result_folder(batch_targets[bid] if bid else stage,folder_name)
                    if bid:
                        entry=next((p for p in batch_records[bid]['plans'] if p['record_id']==rid),None)
                        if entry is None: raise ValueError('Plan missing from batch inventory')
                        entry['folder']=destination.name
                else:
                    if record.get('results_subdir','results') != 'results': raise ValueError('Unknown result directory layout')
                    destination = source
                folder_name = destination.name if named else None
                run_target = target/destination.relative_to(stage)
                for path in source.rglob('*.json'):
                    path.write_text(json.dumps(relocate(read_json(path),run_target,folder_name), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                if named:
                    # Both paths are contained in this disposable import stage.
                    if not source.resolve().is_relative_to(stage) or not destination.resolve().is_relative_to(stage):
                        raise ValueError('Result relocation escapes staging directory')
                    for path in source.iterdir():
                        path.rename(destination/path.name)
                    record = read_json(destination/'run.json')
                    record['output_run_dir'] = str(run_target)
                    for path in ((destination/'run.json',) if bid else (source/'run.json',destination/'run.json')):
                        path.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
                    if bid: source.rmdir()
            if (stage/'runs').is_dir() and not any((stage/'runs').iterdir()): (stage/'runs').rmdir()
            for bid,record in batch_records.items():
                (batch_targets[bid]/'run.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
            (stage / 'import-receipt.json').write_text(json.dumps({'format': 'resim-import/1', 'bundle_sha256': digest(Path(archive_path).read_bytes()), 'original_runs': manifest['runs']}, ensure_ascii=False, indent=2), encoding='utf-8')
            os.rename(stage, target)
        finally:
            if stage.exists() and stage.parent == projects and stage.name.startswith('.resim-import-'):
                shutil.rmtree(stage)
    return {'project_id': project_id, 'project_dir': str(target), 'runs': len(run_ids)}
