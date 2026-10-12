"""Offline commands; schemas are generated on demand, never loaded from docs."""
import json
from pathlib import Path
from zipfile import BadZipFile

from pydantic import ValidationError


def register_commands(subparsers):
    parser = subparsers.add_parser('export-schemas', help='Export current input schemas and API description')
    parser.add_argument('--output', type=Path, required=True)
    parser.set_defaults(handler=export_schemas)

    parser = subparsers.add_parser('check-inputs', help='Validate architecture and technology YAML files')
    parser.add_argument('--architecture', type=Path, required=True)
    parser.add_argument('--technology', type=Path, required=True)
    parser.set_defaults(handler=check_inputs)

    parser = subparsers.add_parser('pack-project', help='Pack a project and its results into an archive')
    parser.add_argument('--project-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.set_defaults(handler=pack_project)

    parser = subparsers.add_parser('unpack-project', help='Restore an archive into a projects directory')
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--projects-dir', type=Path, required=True)
    parser.set_defaults(handler=unpack_project)


def run_command(args):
    """Print one JSON result and preserve the CLI's success/failure exit status."""
    try:
        result = args.handler(args)
    except ValidationError as exc:
        result = {'ok': False, 'errors': [
            {'path': '.'.join(map(str, error['loc'])), 'message': error['msg']}
            for error in exc.errors()
        ]}
    except (ValueError, OSError, KeyError, TypeError, BadZipFile) as exc:
        if args.command == 'check-inputs':
            result = {'ok': False, 'errors': [{'path': '$', 'message': str(exc)}]}
        else:
            result = {'ok': False, 'error': str(exc)}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['ok'] else 1


def export_schemas(args):
    from resim_search_policy import input_models, release_identity, POLICY_VERSION
    from resim_policy_storage import atomic_text
    from .schema import Project
    from .server import app

    args.output.mkdir(parents=True, exist_ok=True)
    for name, model in zip(('chip-architecture', 'technology', 'project'), (*input_models(), Project)):
        schema = model.model_json_schema()
        schema['$schema'] = 'https://json-schema.org/draft/2020-12/schema'
        atomic_text(args.output / (name + '.schema.json'), json.dumps(schema, ensure_ascii=False, indent=2) + '\n')
    api = app.openapi()
    api['info']['version'] = POLICY_VERSION
    atomic_text(args.output / 'engine.openapi.json', json.dumps(api, ensure_ascii=False, indent=2) + '\n')
    return {'ok': True, 'output': str(args.output.resolve()), **release_identity()}


def check_inputs(args):
    from resim_search_policy import input_models, yaml_data
    from resim_policy_stack import stack_issues
    from .schema import Project

    chip_model, technology_model = input_models()
    chip = chip_model.model_validate(yaml_data(args.architecture.read_text(encoding='utf-8'))).model_dump()
    technology = technology_model.model_validate(yaml_data(args.technology.read_text(encoding='utf-8'))).model_dump()
    chip['schema_version'] = 'resim/0.1'
    project = Project.model_validate({**chip, 'resources': technology['resources']})
    issues = stack_issues(project.model_dump())
    return {'ok': not any(issue['severity'] == 'error' for issue in issues), 'issues': issues}


def pack_project(args):
    from resim_policy_portable import pack_project as pack
    from resim_policy_storage import recover, store_lock

    with store_lock(args.project_dir.resolve().parent):
        recover(args.project_dir)
        return {'ok': True, **pack(args.project_dir, args.output)}


def unpack_project(args):
    from resim_policy_portable import unpack_project as unpack
    from resim_policy_storage import store_lock

    with store_lock(args.projects_dir):
        return {'ok': True, **unpack(args.archive, args.projects_dir)}
