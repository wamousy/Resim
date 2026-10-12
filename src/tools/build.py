"""Build a complete Windows app from source, without reading the existing app/.

Run with src/tools/.venv/Scripts/python.exe. Output is a new staging directory;
the running application and user projects are never overwritten by this script.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import importlib.metadata as metadata
import json
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'src/backend'
FRONTEND = ROOT / 'src/frontend'


def source_manifest():
    paths = sorted([*BACKEND.glob('*.py'), *(BACKEND / 'resim').glob('*.py')])
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.relative_to(BACKEND).as_posix().encode() + b'\0' + path.read_bytes())
    sources = [*paths, BACKEND / 'desktop/ResimHost.cs', BACKEND / 'requirements-lock.txt',
               *[p for p in FRONTEND.rglob('*') if p.is_file()]]
    return {'created_at': datetime.now(timezone.utc).isoformat(), 'python': sys.version,
            'backend_source_sha256': digest.hexdigest(),
            'files': {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(sources)},
            'dependencies': {d.metadata['Name']: d.version for d in metadata.distributions()}}


def build(output):
    if sys.version_info[:2] != (3, 13) or os.name != 'nt':
        raise SystemExit('Build requires Windows x64 and Python 3.13.')
    output = output.resolve()
    staging = (ROOT / 'src/tools/.build').resolve()
    if not output.is_relative_to(staging) or output == staging:
        raise ValueError('Build output must be a new subdirectory of src/tools/.build.')
    output.mkdir(parents=True, exist_ok=False)
    manifest = output / 'build-manifest.json'
    manifest.write_text(json.dumps(source_manifest(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onedir', '--console',
               '--name', 'Resim.Engine', '--paths', str(BACKEND),
               '--collect-binaries', 'ortools', '--hidden-import', 'ortools.sat.python.cp_model_helper',
               '--exclude-module', 'pytest', '--exclude-module', '_pytest',
               '--exclude-module', 'shapely.tests', '--exclude-module', 'pandas.tests', '--exclude-module', 'numpy.tests',
               '--add-data', str(FRONTEND) + ':resim/static',
               '--add-data', str(manifest) + ':resim',
               '--distpath', str(output / 'dist'), '--workpath', str(output / 'work'), '--specpath', str(output)]
    for name in ('fastapi', 'numpy', 'ortools', 'pydantic', 'ruamel.yaml', 'shapely', 'uvicorn'):
        command += ['--copy-metadata', name]
    subprocess.run(command + [str(BACKEND / 'entry.py')], cwd=ROOT, check=True)
    application = output / 'app'
    (output / 'dist/Resim.Engine').rename(application)
    csc = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    subprocess.run([str(csc), '/nologo', '/target:exe', '/optimize+', '/reference:System.Web.Extensions.dll',
                    '/out:' + str(application / 'Resim.exe'), str(BACKEND / 'desktop/ResimHost.cs')], check=True)
    (application / '启动Resim.cmd').write_text('@echo off\ncd /d "%~dp0"\n"%~dp0Resim.exe"\nif errorlevel 1 pause\n', encoding='utf-8')
    shutil.copy2(manifest, application / 'build-manifest.json')
    licenses = application / 'licenses'
    records = []
    for dist in metadata.distributions():
        entries = []
        for file in dist.files or []:
            # License files from locked distributions; never copy arbitrary source paths.
            if Path(str(file)).name.lower().startswith(('license', 'copying', 'notice')):
                original = Path(dist.locate_file(file))
                if original.is_file():
                    target = licenses / dist.metadata['Name'] / str(file).replace('..', '_')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(original, target)
                    entries.append(target.relative_to(application).as_posix())
        records.append({'name': dist.metadata['Name'], 'version': dist.version, 'license_files': entries})
    licenses.mkdir(exist_ok=True)
    (licenses / 'dependencies.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'application': str(application), 'manifest': str(manifest)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'src/tools/.build' / datetime.now().strftime('release-%Y%m%d-%H%M%S'))
    build(parser.parse_args().output)
