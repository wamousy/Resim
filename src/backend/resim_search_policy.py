"""Shared 0.12 compatibility policies for the restored source engine.

Besides removing the obsolete candidate-count ceiling, this hook makes the two
new YAML documents the project storage format. The engine still receives a
validated, merged Project in memory and run folders keep their complete snapshot.
"""
from pathlib import Path
import io
import json
import re
import sys
import copy
import hashlib
from functools import lru_cache
from contextvars import ContextVar
from typing import Literal

from ruamel.yaml import YAML

from resim.schema import Project, Search, dumps, loads
from resim.workspace import ProjectStore, normalize_run_name, normalize_result_folder_name, validate_project_folder
from resim_policy_stack import migrate_stack, assess, RULE_VERSION
from resim_policy_storage import commit_inputs, recover, store_lock, atomic_text

POLICY_VERSION = '0.12.0'


CHIP_INPUT = Path('inputs/chip-architecture.yml')
TECHNOLOGY_INPUT = Path('inputs/technology.yml')
LEGACY_INPUT = Path('inputs/architecture.yml')
STACK_BLOCK = re.compile(r'\n?\[resim-stack/1\]\n([\s\S]*?)\n\[/resim-stack\]')
CREATED_PROJECT = ContextVar('resim_created_project', default=None)


def validate_stack(stack, chip):
    if not isinstance(stack, dict) or set(stack) != {'die_faces'} or not isinstance(stack['die_faces'], dict):
        raise ValueError('stack requires a die_faces mapping')
    ids = {die['id'] for die in chip['architecture']['dies']}
    for die, face in stack['die_faces'].items():
        if die not in ids or face not in ('up', 'down', 'unknown'):
            raise ValueError('Invalid stack die or face: ' + str(die))
    return stack


def encode_stack(chip):
    return migrate_stack(chip)


def decode_stack(chip):
    return migrate_stack(chip)


def yaml_data(text):
    if len(text.encode('utf-8')) > 4_000_000:
        raise ValueError('YAML exceeds 4 MB')
    yaml = YAML(typ='safe')
    value = yaml.load(text)
    if not isinstance(value, dict):
        raise ValueError('YAML top level must be an object')
    return value


def yaml_text(value):
    yaml = YAML()
    yaml.default_flow_style = False
    yaml.width = 110
    yaml.indent(mapping=2, sequence=4, offset=2)
    stream = io.StringIO()
    yaml.dump(value, stream)
    return stream.getvalue()


def merge_inputs(folder):
    recover(folder)
    chip_path = folder / CHIP_INPUT
    technology_path = folder / TECHNOLOGY_INPUT
    if not chip_path.is_file() or not technology_path.is_file():
        raise FileNotFoundError('Project requires inputs/chip-architecture.yml and inputs/technology.yml')
    chip = yaml_data(chip_path.read_text(encoding='utf-8'))
    technology = yaml_data(technology_path.read_text(encoding='utf-8'))
    if chip.pop('schema_version', None) != 'resim-architecture/1':
        raise ValueError('Unsupported chip architecture YAML version')
    if set(chip) - {'name', 'architecture', 'constraints', 'floorplan', 'search', 'stack'}:
        raise ValueError('Unexpected chip architecture fields')
    if technology.get('schema_version') != 'resim-technology/1' or not isinstance(technology.get('resources'), dict):
        raise ValueError('Unsupported technology YAML version')
    if set(technology) - {'schema_version', 'resources'}:
        raise ValueError('Unexpected technology fields')
    merged = {'schema_version': 'resim/0.1', **encode_stack(chip), 'resources': technology['resources']}
    return dumps(loads(yaml_text(merged)))


def updated_manifest(folder):
    path = folder / 'project.json'
    metadata = json.loads(path.read_text(encoding='utf-8'))
    metadata.pop('input', None)
    metadata['architecture_input'] = CHIP_INPUT.as_posix()
    metadata['technology_input'] = TECHNOLOGY_INPUT.as_posix()
    return metadata


def split_input(folder, text):
    full = yaml_data(dumps(loads(text)))
    resources = full.pop('resources')
    full.pop('schema_version', None)
    chip = {'schema_version': 'resim-architecture/1', **decode_stack(full)}
    technology = {'schema_version': 'resim-technology/1', 'resources': resources}
    metadata = updated_manifest(folder)
    commit_inputs(folder, {CHIP_INPUT.as_posix(): yaml_text(chip), TECHNOLOGY_INPUT.as_posix(): yaml_text(technology),
                          'project.json': json.dumps(metadata, ensure_ascii=False, indent=2) + '\n'})
    return metadata


def apply_split_project_storage():
    import resim.workspace as workspace
    original_create = ProjectStore.create
    original_simulate = ProjectStore.simulate
    original_project = ProjectStore.project
    original_runs = ProjectStore.runs
    original_write = workspace.atomic_text

    def project(self, project_id):
        with store_lock(self.root):
            folder = self.project_dir(project_id)
            recover(folder)
            metadata = original_project(self, project_id)
            legacy = folder / LEGACY_INPUT
            if legacy.is_file():
                split_input(folder, legacy.read_text(encoding='utf-8'))
                metadata = original_project(self, project_id)
            return metadata

    def write(path, text):
        path = Path(path)
        if path.name == 'architecture.yml' and path.parent.name == 'inputs' and (path.parent.parent / 'project.json').exists():
            split_input(path.parent.parent, text)
        else:
            original_write(path, text)

    def project_input(self, project_id):
        with store_lock(self.root):
            self.project(project_id)
            return merge_inputs(self.project_dir(project_id))

    def create(self, text, name=None, project_id=None, project_dir=None):
        # Reject malformed input before the write lock creates a store directory.
        loads(text)
        validate_project_folder(project_dir)
        with store_lock(self.root):
            metadata = original_create(self, text, name=name, project_id=project_id, project_dir=project_dir)
            folder = self.project_dir(metadata['id'])
            split_input(folder, text)
            CREATED_PROJECT.set(metadata['id'])
            return self.project(metadata['id'])

    def simulate(self, text, mode='evaluate', project_id=None, name=None, output_dir=None, run_name=None, result_folder_name=None, project_dir=None):
        loads(text)
        # Validate before acquiring the lock, which may create the project root.
        run_name = normalize_run_name(run_name)
        result_folder_name = normalize_result_folder_name(result_folder_name)
        if project_id and project_dir is not None:
            raise ValueError('已有项目的文件夹不能在保存结果时更改')
        if project_dir is not None and output_dir:
            raise ValueError('项目文件夹与旧版独立结果目录不能同时指定')
        validate_project_folder(project_dir)
        resolved_id = project_id
        token = CREATED_PROJECT.set(None)
        try:
            with store_lock(self.root):
                return original_simulate(
                    self, text, mode=mode, project_id=project_id, name=name, output_dir=output_dir, run_name=run_name, result_folder_name=result_folder_name, project_dir=project_dir
                )
        finally:
            try:
                if resolved_id is None:
                    resolved_id = CREATED_PROJECT.get()
                if resolved_id is not None:
                    with store_lock(self.root):
                        folder = self.project_dir(resolved_id)
                        recover(folder)
            finally:
                CREATED_PROJECT.reset(token)

    def runs(self, project_id):
        with store_lock(self.root):
            rows = original_runs(self, project_id)
            for row in rows:
                if row.get('status') != 'running': continue
                # Acquiring the store lock proves no cooperating writer is active.
                row.update(status='interrupted', error='Previous process stopped before committing this run')
                for path in {self.run_dir(project_id, row['run_id']) / 'run.json', self.project_dir(project_id) / 'runs' / row['run_id'] / 'run.json'}:
                    data = json.loads(path.read_text(encoding='utf-8'))
                    data.update(status=row['status'], error=row['error'])
                    atomic_text(path, json.dumps(data, ensure_ascii=False, indent=2))
            return rows

    workspace.atomic_text = write
    ProjectStore.project = project
    ProjectStore.runs = runs
    ProjectStore.input = project_input
    ProjectStore.create = create
    ProjectStore.simulate = simulate


def install_schema():
    global Project
    import resim.schema as schema
    from pydantic import BaseModel, ConfigDict, Field, model_validator

    class Stack(BaseModel):
        model_config = ConfigDict(extra='forbid')
        die_faces: dict[str, Literal['up', 'down', 'unknown']] = Field(default_factory=dict)

    old_project = schema.Project

    class NativeProject(old_project):
        schema_version: Literal['resim/0.1'] = 'resim/0.1'
        stack: Stack = Field(default_factory=Stack)

        @model_validator(mode='before')
        @classmethod
        def legacy_stack(cls, value):
            return migrate_stack(value)

        @model_validator(mode='after')
        def stack_references(self):
            unknown = set(self.stack.die_faces) - {d.id for d in self.architecture.dies}
            if unknown: raise ValueError('stack.die_faces: unknown Die IDs: ' + ', '.join(sorted(unknown)))
            return self

    Project = NativeProject
    for module in list(sys.modules.values()):
        if getattr(module, '__name__', '').startswith('resim') and getattr(module, 'Project', None) is old_project:
            module.Project = NativeProject
    schema.Project = NativeProject


@lru_cache(maxsize=1)
def release_identity():
    from importlib import import_module
    root = Path(__file__).resolve().parent
    manifest = root / 'resim' / 'build-manifest.json'
    if getattr(sys, 'frozen', False) and manifest.is_file():
        source_hash = json.loads(manifest.read_text(encoding='utf-8'))['backend_source_sha256']
    else:
        digest = hashlib.sha256()
        for path in sorted([*root.glob('*.py'), *(root / 'resim').glob('*.py')]):
            digest.update(path.relative_to(root).as_posix().encode() + b'\0' + path.read_bytes())
        source_hash = digest.hexdigest()
    identity = {'release_version': POLICY_VERSION, 'stack_rule_version': RULE_VERSION,
            'engine_sha256': hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest() if getattr(sys, 'frozen', False) else source_hash,
            'backend_source_sha256': source_hash,
            'execution_mode': 'packaged' if getattr(sys, 'frozen', False) else 'source',
            'schema_sha256': hashlib.sha256(json.dumps(Project.model_json_schema(), sort_keys=True).encode()).hexdigest(),
            'dependency_versions': {name: getattr(import_module(name), '__version__', 'unavailable') for name in ('numpy', 'ortools', 'pydantic', 'shapely')},
            'identity_scope': 'backend source, executable when packaged, input schema, policy and numerical library versions'}
    identity['model_fingerprint'] = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return identity


def install_assessment():
    import resim.engine as engine
    original = engine.evaluate

    def evaluate(project):
        report = assess(original(project))
        report['provenance'] = {**report.get('provenance', {}), **release_identity(), 'input_sha256': hashlib.sha256(project.model_dump_json().encode()).hexdigest(),
                                'calibration': 'unverified', 'accuracy_interval': None}
        # Preserve the core engine's status vocabulary; stack errors must invalidate it.
        report['status'] = 'violations' if report['summary']['errors'] else 'incomplete' if report['summary']['unknowns'] else 'within_model_constraints'
        return report

    for module in list(sys.modules.values()):
        if getattr(module, '__name__', '').startswith('resim') and getattr(module, 'evaluate', None) is original:
            module.evaluate = evaluate
    engine.evaluate = evaluate


def input_models():
    from pydantic import create_model, ConfigDict
    fields = {name: (field.annotation, copy.deepcopy(field)) for name, field in Project.model_fields.items()}
    fields.pop('resources')
    fields['schema_version'] = (Literal['resim-architecture/1'], ...)
    chip = create_model('ArchitectureInput', __config__=ConfigDict(extra='forbid'), **fields)
    tech = create_model('TechnologyInput', __config__=ConfigDict(extra='forbid'),
                        schema_version=(Literal['resim-technology/1'], ...),
                        resources=(Project.model_fields['resources'].annotation, ...))
    return chip, tech


def maintenance_cli():
    if len(sys.argv) == 2 and sys.argv[1] in ('--help', '-h'):
        print('Additional commands: export-schemas, check-inputs, pack-project, unpack-project (use <command> --help).', flush=True)
    if len(sys.argv) < 2 or sys.argv[1] not in ('export-schemas', 'check-inputs', 'pack-project', 'unpack-project'):
        return
    import argparse
    from pydantic import ValidationError
    parser = argparse.ArgumentParser(prog='Resim.exe ' + sys.argv[1])
    if sys.argv[1] in ('pack-project', 'unpack-project'):
        from zipfile import BadZipFile
        from resim_policy_portable import pack_project, unpack_project
        if sys.argv[1] == 'pack-project':
            parser.add_argument('--project-dir', type=Path, required=True)
            parser.add_argument('--output', type=Path, required=True)
            args = parser.parse_args(sys.argv[2:])
            try:
                with store_lock(args.project_dir.resolve().parent):
                    recover(args.project_dir)
                    result = pack_project(args.project_dir, args.output)
            except (ValueError, OSError, KeyError, TypeError, BadZipFile) as exc:
                print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False)); raise SystemExit(1)
        else:
            parser.add_argument('--archive', type=Path, required=True)
            parser.add_argument('--projects-dir', type=Path, required=True)
            args = parser.parse_args(sys.argv[2:])
            try:
                with store_lock(args.projects_dir): result = unpack_project(args.archive, args.projects_dir)
            except (ValueError, OSError, KeyError, TypeError, BadZipFile) as exc:
                print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False)); raise SystemExit(1)
        print(json.dumps({'ok': True, **result}, ensure_ascii=False)); raise SystemExit(0)
    if sys.argv[1] == 'export-schemas':
        parser.add_argument('--output', type=Path, required=True)
        args = parser.parse_args(sys.argv[2:])
        args.output.mkdir(parents=True, exist_ok=True)
        for name, model in zip(('chip-architecture', 'technology', 'project'), (*input_models(), Project)):
            doc = model.model_json_schema()
            doc['$schema'] = 'https://json-schema.org/draft/2020-12/schema'
            atomic_text(args.output / (name + '.schema.json'), json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
        from resim.server import app
        contract = app.openapi()
        contract['info']['version'] = POLICY_VERSION
        atomic_text(args.output / 'engine.openapi.json', json.dumps(contract, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'ok': True, 'output': str(args.output.resolve()), **release_identity()}))
        raise SystemExit(0)
    parser.add_argument('--architecture', type=Path, required=True)
    parser.add_argument('--technology', type=Path, required=True)
    args = parser.parse_args(sys.argv[2:])
    try:
        chip_model, tech_model = input_models()
        chip = chip_model.model_validate(yaml_data(args.architecture.read_text(encoding='utf-8'))).model_dump()
        tech = tech_model.model_validate(yaml_data(args.technology.read_text(encoding='utf-8'))).model_dump()
        chip['schema_version'] = 'resim/0.1'
        project = Project.model_validate({**chip, 'resources': tech['resources']})
        from resim_policy_stack import stack_issues
        issues = stack_issues(project.model_dump())
        errors = [i for i in issues if i['severity'] == 'error']
        print(json.dumps({'ok': not errors, 'issues': issues}, ensure_ascii=False))
        raise SystemExit(1 if errors else 0)
    except (ValueError, OSError) as exc:
        errors = [{'path': '.'.join(map(str, e['loc'])), 'message': e['msg']} for e in exc.errors()] if isinstance(exc, ValidationError) else [{'path': '$', 'message': str(exc)}]
        print(json.dumps({'ok': False, 'errors': errors}, ensure_ascii=False))
        raise SystemExit(1)


_APPLIED = False


def apply():
    global _APPLIED
    if _APPLIED:
        return
    for module in list(sys.modules.values()):
        if getattr(module, '__name__', '').startswith('resim') and hasattr(module, '__version__'):
            module.__version__ = POLICY_VERSION
    field = Search.model_fields['candidates']
    field.metadata = [item for item in field.metadata if not hasattr(item, 'le')]
    Search.model_rebuild(force=True)
    Project.model_rebuild(force=True)
    assert 'maximum' not in Search.model_json_schema()['properties']['candidates']
    install_schema()
    install_assessment()
    apply_split_project_storage()
    _APPLIED = True
