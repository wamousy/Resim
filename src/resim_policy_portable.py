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
    if meta['id'] != folder.name: raise ValueError('Project ID does not match directory')
    sources = {'project/project.json': folder / 'project.json'}
    for name in ('chip-architecture.yml', 'technology.yml'):
        sources['project/inputs/' + name] = folder / 'inputs' / name
    runs = []
    for pointer in sorted((folder / 'runs').glob('*/run.json')):
        record = read_json(pointer)
        if record.get('status') == 'running': raise ValueError('Cannot pack a running project')
        run = Path(record.get('output_run_dir') or pointer.parent).resolve()
        actual = read_json(run / 'run.json')
        if actual.get('project_id') != meta['id'] or actual.get('run_id') != pointer.parent.name:
            raise ValueError('External run identity mismatch')
        runs.append({'id': pointer.parent.name, 'original_path': str(run)})
        for path in sorted(run.rglob('*')):
            if path.is_symlink() or not path.resolve().is_relative_to(run):
                raise ValueError('Run contains a link outside its directory')
            if path.is_file(): sources['runs/' + pointer.parent.name + '/' + path.relative_to(run).as_posix()] = path
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
            archive.writestr('bundle.json', json.dumps({'format': 'resim-project-bundle/1', 'project_id': meta['id'], 'runs': runs, 'files': files}, ensure_ascii=False))
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
            def relocate(value, rid):
                if isinstance(value, list): return [relocate(v, rid) for v in value]
                if not isinstance(value, dict): return value
                result = {k: relocate(v, rid) for k, v in value.items() if k != 'output_run_dir'}
                if 'run_dir' in result: result['run_dir'] = str(target / 'runs' / rid)
                return result
            for rid in run_ids:
                record = read_json(stage / 'runs' / rid / 'run.json')
                if record.get('project_id') != project_id or record.get('run_id') != rid: raise ValueError('Run identity mismatch')
                for path in (stage / 'runs' / rid).rglob('*.json'):
                    path.write_text(json.dumps(relocate(read_json(path), rid), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            (stage / 'import-receipt.json').write_text(json.dumps({'format': 'resim-import/1', 'bundle_sha256': digest(Path(archive_path).read_bytes()), 'original_runs': manifest['runs']}, ensure_ascii=False, indent=2), encoding='utf-8')
            os.rename(stage, target)
        finally:
            if stage.exists() and stage.parent == projects and stage.name.startswith('.resim-import-'):
                shutil.rmtree(stage)
    return {'project_id': project_id, 'project_dir': str(target), 'runs': len(run_ids)}
