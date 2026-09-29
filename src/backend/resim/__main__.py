import argparse
import json
import os
from pathlib import Path
from .schema import loads
from .workspace import ProjectStore
from .paths import get_projects_root


def main():
    from resim_search_policy import maintenance_cli
    maintenance_cli()
    parser = argparse.ArgumentParser(description='Resim architecture-level resource simulator')
    sub = parser.add_subparsers(dest='command',required=True)
    for name in ['validate','evaluate','optimize']:
        p = sub.add_parser(name)
        p.add_argument('input',type=Path,nargs='?')
        p.add_argument('--project',help='Existing project ID')
        p.add_argument('--name',help='Display name for a new project')
        p.add_argument('--new-project',action='store_true')
        p.add_argument('--project-dir',help='Folder containing the complete new project and its results')
        p.add_argument('--output-dir',help='Absolute root for per-project, per-run outputs')
        p.add_argument('--result-folder-name',help='Physical result folder name; duplicates get a numeric suffix')
        p.add_argument('--projects-dir',type=Path,default=get_projects_root())
    p = sub.add_parser('init')
    p.add_argument('input',type=Path)
    p.add_argument('--id',help='New project ID; never overwrite an existing ID')
    p.add_argument('--name')
    p.add_argument('--project-dir',help='Folder containing the complete new project')
    p.add_argument('--projects-dir',type=Path,default=get_projects_root())
    p = sub.add_parser('list-projects')
    p.add_argument('--projects-dir',type=Path,default=get_projects_root())
    p = sub.add_parser('serve')
    p.add_argument('--port',type=int,default=8770)
    p.add_argument('--projects-dir',type=Path,default=get_projects_root())
    p.add_argument('--open-browser',action='store_true')
    p = sub.add_parser('import-lef')
    p.add_argument('tech',type=Path); p.add_argument('cells',type=Path); p.add_argument('--out',type=Path,required=True)
    args = parser.parse_args()
    if args.command == 'serve':
        import uvicorn
        import threading
        import time
        import webbrowser
        import urllib.request
        os.environ['RESIM_PROJECTS_DIR'] = str(args.projects_dir.resolve())
        url = f'http://127.0.0.1:{args.port}'
        try:
            with urllib.request.urlopen(url+'/api/health',timeout=1) as response:
                existing = json.load(response)
        except (OSError,ValueError):
            existing = None
        if existing and existing.get('application') == 'Resim':
            if Path(existing['projects_dir']).resolve() != args.projects_dir.resolve():
                parser.error('This port serves a different project directory; select another --port')
            if args.open_browser:
                webbrowser.open(url)
            print('Resim is already running:',url)
            return
        from .server import app
        server = uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=args.port,loop='asyncio',http='h11',ws='none'))
        if args.open_browser:
            def open_when_ready():
                for _ in range(300):
                    if server.started:
                        webbrowser.open(url)
                        return
                    time.sleep(.1)
            threading.Thread(target=open_when_ready,daemon=True).start()
        print('Projects:',args.projects_dir.resolve())
        print('Open:',url,'  (Ctrl+C to stop)')
        server.run()
        return
    if args.command == 'import-lef':
        from .lef import import_lef
        if args.out.exists():
            parser.error('Output already exists; choose a new resource file')
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(import_lef(args.tech,args.cells),indent=2),encoding='utf-8')
        return
    store = ProjectStore(args.projects_dir)
    if args.command == 'list-projects':
        print(json.dumps(store.projects(),ensure_ascii=True,indent=2)); return
    if args.command == 'init':
        meta = store.create(args.input.read_text(encoding='utf-8'),name=args.name,project_id=args.id,project_dir=args.project_dir)
        print(json.dumps(meta,ensure_ascii=True,indent=2)); return
    if args.new_project and args.project:
        parser.error('--new-project and --project cannot be combined')
    if not args.input and not args.project:
        parser.error('Provide an input YAML or --project')
    text = args.input.read_text(encoding='utf-8') if args.input else store.input(args.project)
    if args.command == 'validate':
        print('VALID:',loads(text).name); return
    project_id = args.project
    if args.input and not project_id and not args.new_project:
        project_id = store.infer_project(args.input)
    result = store.simulate(text,args.command,project_id=project_id,name=args.name,project_dir=args.project_dir,output_dir=args.output_dir,result_folder_name=args.result_folder_name)
    print(json.dumps(dict(storage=result['storage'],status=result.get('status',result.get('search_status')),summary=result.get('summary',result.get('comparison'))),ensure_ascii=True,indent=2))


if __name__ == '__main__':
    main()
