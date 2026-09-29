"""Project ownership, immutable run snapshots, and persistent simulation results."""
from __future__ import annotations
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from . import __version__
from .engine import evaluate
from .export import save_report
from .optimizer import optimize
from .paths import get_projects_root
from .schema import loads, dumps


def now():
    return datetime.now(timezone.utc).isoformat()


def normalize_run_name(value):
    if value is not None:
        if not isinstance(value, str) or not value.strip() or len(value) > 120 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('结果名称须为 1–120 个字符，不能包含换行或控制字符')
        return value.strip()
    return None


def normalize_result_folder_name(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError('结果文件夹名称必须是文本')
    value = value.strip()
    try:
        length = len(value.encode('utf-16-le')) // 2
    except UnicodeEncodeError as exc:
        raise ValueError('结果文件夹名称包含无效字符') from exc
    if not 1 <= length <= 120:
        raise ValueError('结果文件夹名称须为 1–120 个字符')
    if re.search(r'[<>:"/\\|?*\x00-\x1f\x7f]', value) or value.endswith('.'):
        raise ValueError('结果文件夹名称不能包含 < > : " / \\ | ? *、控制字符，或以句点结尾')
    stem = value.split('.')[0].rstrip().upper()
    reserved = {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
                *(f'{prefix}{i}' for prefix in ('COM', 'LPT') for i in '123456789¹²³')}
    if stem in reserved:
        raise ValueError('结果文件夹名称不能使用系统保留名称')
    return value


def create_result_folder(parent, name):
    """Reserve a new child atomically; existing directories/files are never reused."""
    name = normalize_result_folder_name(name)
    parent = canonical_path(parent)
    parent.mkdir(parents=True, exist_ok=True)
    number = 1
    while True:
        candidate = name if number == 1 else f'{name} ({number})'
        # Match Windows even when a project is created on a case-sensitive filesystem.
        reserved = {'inputs', 'runs', '_batch-index', 'project.json', '_project-location.json',
                    '.resim-input-transaction.json', '.resim-store.lock', 'import-receipt.json'}
        if candidate.casefold() in reserved | {p.name.casefold() for p in parent.iterdir()}:
            number += 1
            continue
        folder = inside(parent, parent/candidate)
        try:
            folder.mkdir(exist_ok=False)
            return folder
        except FileExistsError:
            number += 1
        except OSError as exc:
            raise ValueError(f'无法创建结果文件夹，请检查路径长度及目录写入权限：{folder}') from exc


def safe_id(value):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}', value):
        raise ValueError('ID must contain lowercase letters, numbers, hyphens or underscores (max 80 characters)')
    if value in {'con','prn','aux','nul',*[f'com{i}' for i in range(1,10)],*[f'lpt{i}' for i in range(1,10)]}:
        raise ValueError('Reserved directory name')
    return value


def canonical_path(value):
    resolved = str(Path(value).resolve())
    # Windows may add an extended-length prefix only to the deeper path.
    # Normalize the spelling after resolving symlinks, before ancestry checks.
    if os.name == 'nt':
        if resolved.startswith('\\\\?\\UNC\\'):
            resolved = '\\\\' + resolved[8:]
        elif resolved.startswith('\\\\?\\') and len(resolved) > 6 and resolved[5] == ':':
            resolved = resolved[4:]
    return Path(resolved)


def inside(root, path):
    root, path = canonical_path(root), canonical_path(path)
    if not path.is_relative_to(root) or path == root:
        raise ValueError('Path escapes its project directory')
    return path


def atomic_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    temp.write_text(text, encoding='utf-8')
    temp.replace(path)


def write_json(path, data):
    atomic_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def validate_project_folder(value):
    """A selected path is the project itself, never an output root."""
    if value is None or not value.strip():
        return None
    if not Path(value).is_absolute():
        raise ValueError('项目文件夹必须是绝对路径')
    folder = canonical_path(value)
    program = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[2]
    if folder.is_relative_to(program):
        raise ValueError('请选择程序目录之外的项目文件夹')
    if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
        raise ValueError('新项目请选择空文件夹或尚不存在的文件夹，已有项目请从列表载入或打开项目文件夹')
    return folder


class ProjectStore:
    def __init__(self, root=None):
        self.root = canonical_path(root if root is not None else get_projects_root())
        # External projects belong to this running session, never an index file.
        self._opened = {}

    @staticmethod
    def _read_project(folder):
        path = folder/'project.json'
        if not path.is_file():
            raise FileNotFoundError(f'此文件夹没有 project.json：{folder}')
        meta = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(meta, dict) or not isinstance(meta.get('id'), str):
            raise ValueError('project.json 缺少有效项目编号')
        safe_id(meta['id'])
        if not isinstance(meta.get('name'), str) or not meta['name'].strip():
            raise ValueError('project.json 缺少项目名称')
        return {**meta, 'project_dir': str(folder)}

    def _locations(self):
        """Discover by metadata, independent of directory spelling or display name."""
        locations = {}

        def add(folder, expected=None):
            try:
                folder = canonical_path(folder)
                meta = self._read_project(folder)
                if expected is None or meta['id'] == expected:
                    locations.setdefault(meta['id'], {})[folder] = meta
            except (OSError, ValueError, TypeError):
                # Unrelated, incomplete or inaccessible folders are not projects.
                pass

        if self.root.is_dir():
            for child in sorted(self.root.iterdir()):
                if not child.is_dir() or child.name.startswith('.'):
                    continue
                add(child)
                # Read old location entries for compatibility; never create any.
                marker = child/'_project-location.json'
                if marker.is_file():
                    try:
                        location = json.loads(marker.read_text(encoding='utf-8'))
                        if location.get('id') == child.name and Path(location['project_dir']).is_absolute():
                            add(location['project_dir'], child.name)
                    except (OSError, ValueError, TypeError, KeyError, AttributeError):
                        pass
        for project_id, folder in self._opened.copy().items():
            add(folder, project_id)
        return locations

    @staticmethod
    def _unique_location(project_id, matches):
        if len(matches) != 1:
            raise ValueError(f'多个文件夹使用同一项目编号 {project_id}，请移出重复副本后重新打开：' + '；'.join(map(str, matches)))
        return next(iter(matches))

    def project_index(self, project_id):
        project_id = safe_id(project_id)
        aliases = inside(self.root,self.root/'_project-aliases.json')
        if aliases.is_file():
            mapping = json.loads(aliases.read_text(encoding='utf-8'))
            project_id = safe_id(mapping.get(project_id,project_id))
        return inside(self.root, self.root / project_id)

    def project_dir(self, project_id):
        project_id = self.project_index(project_id).name
        matches = self._locations().get(project_id, {})
        if not matches:
            raise FileNotFoundError(f'未找到项目 {project_id}，请使用“打开项目文件夹”重新载入')
        return self._unique_location(project_id, matches)

    def project(self, project_id):
        folder = self.project_dir(project_id)
        return self._read_project(folder)

    def projects(self):
        items = []
        for project_id, matches in self._locations().items():
            self._unique_location(project_id, matches)
            items.append(self.project(project_id))
        return sorted(items, key=lambda item: (item['name'].casefold(), item['id']))

    def open_project(self, project_dir):
        """Open a self-contained project for this session without copying its data."""
        if not isinstance(project_dir, str) or not project_dir.strip() or not Path(project_dir).is_absolute():
            raise ValueError('请选择项目文件夹的完整绝对路径')
        folder = canonical_path(project_dir)
        meta = self._read_project(folder)
        project_id = meta['id']
        from resim_policy_storage import store_lock
        with store_lock(self.root):
            matches = self._locations().get(project_id, {})
            self._unique_location(project_id, {**matches, folder: meta})
            previous = self._opened.get(project_id)
            self._opened[project_id] = folder
            try:
                loads(self.input(project_id))
                return self.project(project_id)
            except Exception:
                if previous is None:
                    self._opened.pop(project_id, None)
                else:
                    self._opened[project_id] = previous
                raise

    def create(self, text, name=None, project_id=None, project_dir=None):
        project = loads(text)
        title = name.strip() if name and name.strip() else project.name
        if project_id is None:
            # Display names never determine directory names.
            project_id = 'project-' + uuid4().hex[:12]
        selected = validate_project_folder(project_dir)
        index = self.project_index(project_id)
        folder = selected or index
        if folder == self.root:
            raise ValueError('请选择独立的项目文件夹，不能使用整个工程管理目录')
        if selected:
            if any((parent/'project.json').is_file() for parent in folder.parents):
                raise ValueError('项目文件夹不能放在另一个项目内')
            for existing in self.projects():
                owner = self.project_dir(existing['id'])
                if folder.is_relative_to(owner) or owner.is_relative_to(folder):
                    raise ValueError('项目文件夹不能放在另一个项目内，也不能包含已有项目')
        if index.exists() or project_id in self._locations():
            raise FileExistsError('Project already exists: ' + project_id)
        self.root.mkdir(parents=True, exist_ok=True)
        # Folder selection may have created an empty directory already.
        folder.mkdir(parents=True, exist_ok=selected is not None)
        if any(folder.iterdir()):
            raise ValueError('项目文件夹已被使用，请选择其他空文件夹')
        meta = dict(id=project_id, name=title, created_at=now(), input='inputs/architecture.yml')
        if project_dir is not None:
            meta['storage_layout'] = 'project-folder/1'
        atomic_text(inside(folder, folder/'inputs/architecture.yml'), text)
        write_json(inside(folder, folder/'project.json'), meta)
        self._opened[project_id] = folder
        return meta

    def input(self, project_id):
        self.project(project_id)
        folder = self.project_dir(project_id)
        return inside(folder, folder/'inputs/architecture.yml').read_text(encoding='utf-8')

    def infer_project(self, input_path):
        path = canonical_path(input_path)
        for meta in self.projects():
            folder = self.project_dir(meta['id'])
            if path != folder and path.is_relative_to(folder):
                return meta['id']
        return None

    def run_dir(self, project_id, run_id):
        run_id=safe_id(run_id)
        folder = self.project_dir(project_id)
        from .batches import batch_plans
        for run,record in batch_plans(folder,self.project(project_id)['id']):
            if record['run_id']==run_id:
                return run
        index=inside(folder, folder/'runs'/safe_id(run_id))
        marker=index/'run.json'
        if marker.is_file():
            record=json.loads(marker.read_text(encoding='utf-8'))
            target=record.get('output_run_dir')
            if target:
                target=canonical_path(target)
                previous_root=record.get('project_dir')
                if previous_root and target.is_relative_to(canonical_path(previous_root)):
                    # A moved self-contained project must use its own local result,
                    # even if the original absolute directory still exists.
                    return inside(folder,folder/target.relative_to(canonical_path(previous_root)))
                return target  # Legacy results intentionally stored outside a project.
        return index

    def runs(self, project_id):
        project=self.project(project_id)
        folder = self.project_dir(project_id)
        from .batches import batch_plans
        result={}
        for run,meta in batch_plans(folder,project['id']):
            rid=meta['run_id'];meta.update(self._storage(project_id,rid,run))
            result[rid]=meta
        parent = inside(folder, folder/'runs')
        for path in parent.glob('*/run.json'):
            if path.parent.name in result: continue  # Old duplicate batch pointer.
            meta = json.loads(inside(folder,path).read_text(encoding='utf-8'))
            meta.update(self.storage(project_id,path.parent.name))
            result[meta['run_id']]=meta
        return sorted(result.values(),key=lambda m:(m.get('created_at') or '',m['run_id']),reverse=True)

    def metadata(self, project_id, run_id):
        self.project(project_id)
        run = self.run_dir(project_id, run_id)
        path = inside(run, run/'run.json')
        if not path.exists():
            raise FileNotFoundError('Unknown run')
        meta = json.loads(path.read_text(encoding='utf-8'))
        meta.update(self.storage(project_id,run_id))
        return meta

    def storage(self, project_id, run_id):
        run = self.run_dir(project_id,run_id)
        return self._storage(project_id,run_id,run)

    def _storage(self, project_id, run_id, run):
        meta = self.project(project_id)
        marker = run/'run.json'
        record = json.loads(marker.read_text(encoding='utf-8')) if marker.is_file() else {}
        if record.get('results_subdir','results') not in ('.','results'):
            raise ValueError('Unknown result directory layout')
        return dict(project_id=meta['id'], project_name=meta['name'], run_id=run_id,
                    project_dir=str(self.project_dir(project_id)),
                    run_dir=str(run), run_name=record.get('run_name'),
                    results_dir=str(run if record.get('results_subdir')=='.' else inside(run,run/'results')),
                    results_subdir=record.get('results_subdir','results'),
                    result_folder_name=record.get('result_folder_name'),
                    **({'batch_dir':str(run.parent)} if record.get('batch_id') else {}),
                    **{key:record[key] for key in ('batch_id','batch_name','source_key','parent_record_id','parent_source_key') if key in record})

    def results_dir(self, project_id, run_id):
        run = self.run_dir(project_id,run_id)
        marker = run/'run.json'
        record = json.loads(marker.read_text(encoding='utf-8')) if marker.is_file() else {}
        subdir = record.get('results_subdir','results')
        if subdir == '.':
            return run
        if subdir != 'results':
            raise ValueError('Unknown result directory layout')
        return inside(run,run/'results')

    def result(self, project_id, run_id):
        meta = self.metadata(project_id, run_id)
        if meta['status'] != 'completed':
            raise ValueError(f"Run is {meta['status']}: {meta.get('error','')}")
        run = self.run_dir(project_id,run_id)
        filename = 'search-result.json' if meta['mode']=='optimize' else 'resource-report.json'
        result = json.loads(inside(run,self.results_dir(project_id,run_id)/filename).read_text(encoding='utf-8'))
        if result.get('storage_format')=='resim-report/2':
            result['project']=loads(self.snapshot(project_id,run_id)).model_dump(mode='json')
        result['storage'] = self.storage(project_id,run_id)
        return dict(mode=meta['mode'], result=result)

    def snapshot(self, project_id, run_id):
        meta=self.metadata(project_id,run_id)
        run = self.run_dir(project_id,run_id)
        if meta.get('input_layout')=='per-plan/2':
            from .plan_files import input_snapshot
            from .batches import fingerprint
            text=input_snapshot(run)
            if fingerprint(loads(text))!=meta['input_sha256']:
                raise ValueError('方案输入已被修改，与已保存报告不一致；请作为新输入重新评估')
            return text
        return inside(run,run/'input.yml').read_text(encoding='utf-8')

    def simulate(self, text, mode='evaluate', project_id=None, name=None, output_dir=None, run_name=None, result_folder_name=None, project_dir=None):
        if mode not in ('evaluate','optimize'):
            raise ValueError('Unknown simulation mode')
        run_name = normalize_run_name(run_name)
        result_folder_name = normalize_result_folder_name(result_folder_name)
        if project_id and project_dir is not None:
            raise ValueError('已有项目的文件夹不能在保存结果时更改')
        if project_dir is not None and output_dir:
            raise ValueError('项目文件夹与旧版独立结果目录不能同时指定')
        destination=None
        if output_dir and output_dir.strip():
            if not Path(output_dir).is_absolute():
                raise ValueError('结果目录必须是绝对路径')
            destination=canonical_path(output_dir)
            if destination.exists() and not destination.is_dir():
                raise ValueError('结果目录指向文件，请选择文件夹')
            program=Path(sys.executable).parent if getattr(sys,'frozen',False) else Path(__file__).resolve().parents[2]
            if destination.is_relative_to(program):
                raise ValueError('请选择程序目录之外的结果文件夹')
        project = loads(text)
        meta = self.project(project_id) if project_id else self.create(text,name=name,project_dir=project_dir)
        if meta.get('storage_layout') == 'project-folder/1' and destination:
            raise ValueError('此项目的结果必须存入项目文件夹内')
        project_id = meta['id']
        # A renamed project's old browser/history can still submit its previous name.
        # Keep its raw run snapshot, but use the current project name for future input/results.
        working_text = text
        if meta.get('previous_ids') and project.name != meta['name']:
            project.name = meta['name']
            working_text = dumps(project)
        run_id = datetime.now(timezone.utc).strftime('%Y%m%dt%H%M%S%f') + '-' + mode + '-' + uuid4().hex[:8]
        index=self.run_dir(project_id,run_id)
        if result_folder_name:
            parent=inside(destination,destination/project_id) if destination else self.project_dir(project_id)
            run=create_result_folder(parent,result_folder_name)
            results=run
        else:
            run=inside(destination,destination/project_id/run_id) if destination else index
            run.mkdir(parents=True,exist_ok=False)
            results=run/'results'
        redirected=run!=index
        if redirected:
            write_json(index/'run.json',dict(output_run_dir=str(run),status='running'))
        storage = self.storage(project_id,run_id)
        storage.update(results_dir=str(results),results_subdir='.' if result_folder_name else 'results',
                       result_folder_name=run.name if result_folder_name else None)
        storage['run_name'] = run_name or result_folder_name or ('布局评估' if mode == 'evaluate' else '自动寻优') + ' ' + datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        run_meta = dict(**storage,mode=mode,status='running',created_at=now(),input_sha256=hashlib.sha256(text.encode('utf-8')).hexdigest(),simulator_version=__version__,python_version=sys.version.split()[0])
        if redirected:run_meta['output_run_dir']=str(run)
        atomic_text(run/'input.yml',text)
        atomic_text(run/'resolved-input.yml',dumps(project))
        write_json(run/'run.json',run_meta)
        if redirected:write_json(index/'run.json',run_meta)
        folder = self.project_dir(project_id)
        try:
            if mode == 'evaluate':
                result = evaluate(project)
                result['storage'] = storage
                save_report(result,results)
                run_meta['assessment_status'] = result['status']
            else:
                result = optimize(project)
                result['storage'] = storage
                if result['baseline']:
                    save_report(result['baseline'],results/'baseline')
                for i, report in enumerate(result['candidates']):
                    save_report(report,results/f'candidate-{i+1}')
                write_json(results/'search-result.json',result)
                run_meta['search_status'] = result['search_status']
            # Failed runs retain their snapshot without replacing the last usable input.
            atomic_text(inside(folder,folder/'inputs/architecture.yml'),working_text)
            run_meta.update(status='completed',finished_at=now())
            write_json(run/'run.json',run_meta)
            if redirected:write_json(index/'run.json',run_meta)
            return result
        except Exception as exc:
            run_meta.update(status='failed',finished_at=now(),error=str(exc))
            write_json(run/'run.json',run_meta)
            if redirected:write_json(index/'run.json',run_meta)
            raise
