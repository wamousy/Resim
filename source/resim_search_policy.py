"""Runtime policies added to the preserved bundled engine.

Besides removing the obsolete candidate-count ceiling, this hook makes the two
new YAML documents the project storage format. The engine still receives a
validated, merged Project in memory and run folders keep their complete snapshot.
"""
from pathlib import Path
import io
import json
import re
from contextvars import ContextVar

from ruamel.yaml import YAML

from resim.schema import Project, Search, dumps, loads
from resim.workspace import ProjectStore


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
    stack = chip.pop('stack', None)
    if stack is not None:
        validate_stack(stack, chip)
        description = STACK_BLOCK.sub('', chip['architecture'].get('description', '')).strip()
        chip['architecture']['description'] = description + '\n[resim-stack/1]\n' + json.dumps(stack) + '\n[/resim-stack]'
    return chip


def decode_stack(chip):
    description = chip['architecture'].get('description', '')
    match = STACK_BLOCK.search(description)
    if match:
        chip['stack'] = validate_stack(json.loads(match.group(1)), chip)
        chip['architecture']['description'] = STACK_BLOCK.sub('', description).strip()
    return chip


def yaml_data(text):
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


def update_manifest(folder):
    path = folder / 'project.json'
    metadata = json.loads(path.read_text(encoding='utf-8'))
    metadata.pop('input', None)
    metadata['architecture_input'] = CHIP_INPUT.as_posix()
    metadata['technology_input'] = TECHNOLOGY_INPUT.as_posix()
    path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return metadata


def split_input(folder, text):
    full = yaml_data(dumps(loads(text)))
    resources = full.pop('resources')
    full.pop('schema_version', None)
    chip = {'schema_version': 'resim-architecture/1', **decode_stack(full)}
    technology = {'schema_version': 'resim-technology/1', 'resources': resources}
    (folder / 'inputs').mkdir(parents=True, exist_ok=True)
    (folder / CHIP_INPUT).write_text(yaml_text(chip), encoding='utf-8')
    (folder / TECHNOLOGY_INPUT).write_text(yaml_text(technology), encoding='utf-8')
    legacy = folder / LEGACY_INPUT
    if legacy.exists():
        legacy.unlink()
    return update_manifest(folder)


def apply_split_project_storage():
    original_create = ProjectStore.create
    original_simulate = ProjectStore.simulate

    def project_input(self, project_id):
        self.project(project_id)
        return merge_inputs(self.project_dir(project_id))

    def create(self, text, name=None, project_id=None):
        metadata = original_create(self, text, name=name, project_id=project_id)
        folder = self.project_dir(metadata['id'])
        split_input(folder, text)
        CREATED_PROJECT.set(metadata['id'])
        return self.project(metadata['id'])

    def simulate(self, text, mode='evaluate', project_id=None, name=None, output_dir=None):
        resolved_id = project_id
        token = CREATED_PROJECT.set(None)
        try:
            return original_simulate(
                self, text, mode=mode, project_id=project_id, name=name, output_dir=output_dir
            )
        finally:
            try:
                if resolved_id is None:
                    resolved_id = CREATED_PROJECT.get()
                if resolved_id is not None:
                    folder = self.project_dir(resolved_id)
                    legacy = folder / LEGACY_INPUT
                    if legacy.is_file():
                        split_input(folder, legacy.read_text(encoding='utf-8'))
            finally:
                CREATED_PROJECT.reset(token)

    ProjectStore.input = project_input
    ProjectStore.create = create
    ProjectStore.simulate = simulate


def apply():
    field = Search.model_fields['candidates']
    field.metadata = [item for item in field.metadata if not hasattr(item, 'le')]
    Search.model_rebuild(force=True)
    Project.model_rebuild(force=True)
    assert 'maximum' not in Search.model_json_schema()['properties']['candidates']
    apply_split_project_storage()


apply()
