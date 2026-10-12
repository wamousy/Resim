from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, Response, JSONResponse
from collections import OrderedDict
from functools import lru_cache
from threading import Lock
from pydantic import BaseModel, Field
from .schema import loads, dumps, Project
from .engine import evaluate
from .optimizer import optimize
from .workspace import ProjectStore, inside
from .paths import STATIC_ROOT, references_root, get_projects_root
from . import __version__

app = FastAPI(title='Resim local resource simulator',version=__version__)
app.mount('/static',StaticFiles(directory=STATIC_ROOT),name='static')
exports = OrderedDict()
_session_store_lock = Lock()


def remember(report):
    exports[report['plan_id']] = report
    exports.move_to_end(report['plan_id'])
    while len(exports) > 48:
        exports.popitem(last=False)
    return report


@app.get('/api/exports/{plan_id}/{format}')
def export_result(plan_id: str, format: str):
    report = exports.get(plan_id)
    if report is None:
        raise HTTPException(404,'Result expired; evaluate the layout again')
    if format == 'report.json':
        return JSONResponse(report,headers={'Content-Disposition':f'attachment; filename="resource-report-{plan_id}.json"'})
    if format == 'layout.yml':
        return Response(dumps(report['project']),media_type='application/yaml',headers={'Content-Disposition':f'attachment; filename="layout-plan-{plan_id}.yml"'})
    raise HTTPException(404,'Unknown export format')


class Request(BaseModel):
    yaml: str = Field(max_length=4_000_000)
    project_id: str | None = None
    project_name: str | None = Field(default=None,max_length=200)
    project_dir: str | None = Field(default=None,max_length=2000)
    output_dir: str | None = Field(default=None,max_length=2000)
    run_name: str | None = Field(default=None,max_length=120)
    result_folder_name: str | None = Field(default=None,max_length=120)


@lru_cache(maxsize=None)
def session_store(root):
    return ProjectStore(root)


def get_store():
    with _session_store_lock:
        return session_store(str(get_projects_root().resolve()))


class OpenProjectRequest(BaseModel):
    project_dir: str = Field(min_length=1, max_length=2000)


@app.post('/api/projects/open')
def open_project(request: OpenProjectRequest, store: ProjectStore = Depends(get_store)):
    return guarded(lambda: store.open_project(request.project_dir))


class BatchPlanRequest(BaseModel):
    project_id: str | None = None
    project_name: str | None = Field(default=None,max_length=200)
    project_dir: str | None = Field(default=None,max_length=2000)
    batch_id: str = Field(pattern=r'^batch-[a-f0-9-]{32,36}$')
    batch_name: str = Field(min_length=1,max_length=120)
    plan_name: str = Field(min_length=1,max_length=120)
    base_yaml: str = Field(max_length=4_000_000)
    yaml: str = Field(max_length=4_000_000)
    preview_plan_id: str
    source_key: str = Field(min_length=1,max_length=120)
    kind: str = Field(default='manual',pattern=r'^(manual|optimize)$')
    parent_record_id: str | None = None
    parent_source_key: str | None = Field(default=None,max_length=120)
    candidate_metadata: dict | None = None
    search_metadata: dict = Field(default_factory=dict)


@app.post('/api/batches/save-plan')
def save_batch_plan(request: BatchPlanRequest,store: ProjectStore = Depends(get_store)):
    from .batches import save_plan
    return guarded(lambda:save_plan(store,request))


@app.get('/api/projects/{project_id}/batches/{batch_id}')
def get_batch(project_id: str,batch_id: str,store: ProjectStore = Depends(get_store)):
    from .batches import batch_payload
    return guarded(lambda:batch_payload(store,project_id,batch_id))


def guarded(action):
    try:
        return action()
    except FileNotFoundError as exc:
        raise HTTPException(404,str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(409,str(exc)) from exc
    except (ValueError,TypeError,KeyError) as exc:
        raise HTTPException(422,str(exc)) from exc


@app.get('/')
def index():
    return FileResponse(STATIC_ROOT/'index.html',headers={'Cache-Control':'no-store'})


@app.get('/api/health')
def health():
    return dict(application='Resim',version=__version__,projects_dir=str(get_projects_root()))


@app.get('/api/projects')
def projects(store: ProjectStore = Depends(get_store)):
    return guarded(store.projects)


@app.get('/api/projects/{project_id}/input')
def project_input(project_id: str,store: ProjectStore = Depends(get_store)):
    return PlainTextResponse(guarded(lambda:store.input(project_id)))


@app.get('/api/projects/{project_id}/runs')
def history(project_id: str,store: ProjectStore = Depends(get_store)):
    return guarded(lambda:store.runs(project_id))


@app.get('/api/projects/{project_id}/runs/{run_id}/input')
def run_input(project_id: str,run_id: str,store: ProjectStore = Depends(get_store)):
    return PlainTextResponse(guarded(lambda:store.snapshot(project_id,run_id)))


@app.get('/api/projects/{project_id}/runs/{run_id}/result')
def historical_result(project_id: str,run_id: str,store: ProjectStore = Depends(get_store)):
    payload = guarded(lambda:store.result(project_id,run_id))
    cache_result(payload['result'],payload['mode'])
    return payload


@app.get('/api/projects/{project_id}/runs/{run_id}/export/{format}')
def historical_export(project_id: str,run_id: str,format: str,candidate: str = 'current',store: ProjectStore = Depends(get_store)):
    def action():
        payload = store.result(project_id,run_id)
        result = payload['result']
        if payload['mode'] == 'evaluate':
            report = result
        elif candidate == 'base':
            report = result['baseline']
        elif candidate.isdigit() and int(candidate) < len(result['candidates']):
            report = result['candidates'][int(candidate)]
        else:
            raise ValueError('Unknown candidate')
        if report is None:
            raise ValueError('No report for this selection')
        if format == 'report.json':
            return JSONResponse(report,headers={'Content-Disposition':f'attachment; filename="{project_id}-{run_id}-report.json"'})
        if format == 'layout.yml':
            return Response(dumps(report['project']),media_type='application/yaml',headers={'Content-Disposition':f'attachment; filename="{project_id}-{run_id}-layout.yml"'})
        if format in ('report.html','floorplan.svg'):
            subfolder = '' if payload['mode'] == 'evaluate' else 'baseline' if candidate == 'base' else f'candidate-{int(candidate)+1}'
            run_dir = store.run_dir(project_id,run_id)
            path = inside(run_dir, store.results_dir(project_id,run_id)/subfolder/format)
            if not path.is_file():
                if format=='floorplan.svg':
                    from .plan_files import floorplan_svg
                    return Response(floorplan_svg(report),media_type='image/svg+xml')
                raise FileNotFoundError('Report file missing')
            return FileResponse(path,media_type='text/html' if format=='report.html' else 'image/svg+xml')
        raise FileNotFoundError('Unknown format')
    return guarded(action)


@app.post('/api/projects/{project_id}/runs/{run_id}/open-folder')
def open_run_folder(project_id: str,run_id: str,candidate: str = 'current',store: ProjectStore = Depends(get_store)):
    def action():
        import os
        meta = store.metadata(project_id,run_id)
        folder = store.results_dir(project_id,run_id)
        if meta['mode'] == 'optimize':
            if candidate == 'base':
                folder = inside(folder,folder/'baseline')
            elif candidate.isdigit() and len(candidate) <= 2:
                folder = inside(folder,folder/f'candidate-{int(candidate)+1}')
            elif candidate != 'current':
                raise ValueError('Unknown candidate')
        if not folder.is_dir():
            raise FileNotFoundError('Result folder missing')
        if os.name != 'nt':
            raise ValueError('Open-folder is available on Windows; copy the displayed path instead')
        try:
            os.startfile(str(folder))
        except OSError as exc:
            raise HTTPException(503,'当前程序的启动环境不允许打开系统文件夹。可复制结果路径，或关闭此服务后双击 Resim.exe 正常启动。') from exc
        return dict(path=str(folder))
    return guarded(action)


def cache_result(result,mode):
    if mode == 'evaluate':
        remember(result)
    else:
        if result['baseline']:
            remember(result['baseline'])
        for report in result['candidates']:
            remember(report)
    return result


@app.get('/api/schema')
def schema():
    return Project.model_json_schema()


@app.get('/api/sources')
def sources():
    import json
    path = references_root()/'sources/manifest.json'
    if path.is_file():
        return json.loads(path.read_text(encoding='utf-8'))
    return dict(files=[],notes=['This project store has no shared source manifest. YAML inputs carry their resource parameters.'])


def run(request, action):
    try:
        p = loads(request.yaml)
        return action(p)
    except FileNotFoundError as exc:
        raise HTTPException(404,str(exc)) from exc
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(422,str(exc)) from exc
    except Exception as exc:
        from ruamel.yaml.error import YAMLError
        if isinstance(exc,YAMLError):
            raise HTTPException(422,str(exc)) from exc
        raise


@app.post('/api/validate')
def validate(request: Request):
    return run(request,lambda p:dict(valid=True,modules=len(p.architecture.modules),dies=len(p.architecture.dies)))


@app.post('/api/layout/preview')
def preview_layout(project: Project):
    """Re-evaluate an interactive draft without writing project or run files."""
    return guarded(lambda: dict(report=evaluate(project), yaml=dumps(project)))


@app.post('/api/preview')
def preview_yaml(request: Request):
    """Validate YAML and evaluate it without changing projects or saved histories."""
    return run(request, lambda p: dict(report=evaluate(p), yaml=dumps(p)))


@app.post('/api/evaluate')
def assess(request: Request,store: ProjectStore = Depends(get_store)):
    return run(request,lambda p:cache_result(store.simulate(request.yaml,'evaluate',project_id=request.project_id,name=request.project_name,project_dir=request.project_dir,output_dir=request.output_dir,run_name=request.run_name,result_folder_name=request.result_folder_name),'evaluate'))


@app.post('/api/optimize/preview')
def search_preview(request: Request):
    """Generate and evaluate candidate drafts; no project or run files are written."""
    return run(request, optimize)


@app.post('/api/optimize')
def search(request: Request,store: ProjectStore = Depends(get_store)):
    return run(request,lambda p:cache_result(store.simulate(request.yaml,'optimize',project_id=request.project_id,name=request.project_name,project_dir=request.project_dir,output_dir=request.output_dir,run_name=request.run_name,result_folder_name=request.result_folder_name),'optimize'))


@app.post('/api/yaml')
def normalized(request: Request):
    return PlainTextResponse(run(request,dumps))

@app.get('/api/starter')
def starter():
    project=Project.model_validate(dict(name='新架构工程',architecture=dict(chip='new_chip',description='网页创建的初始占位工程；请补充模块、连接和工艺数据。',dies=[dict(id='die_0',kind='logic',order=0,width_um=10000,height_um=10000,thickness_um=100,voltage_V=1)],cores=[dict(id='core0')],modules=[dict(id='module0',core='core0',kind='logic',allowed_dies=['die_0'],area_known=False,stdcell_area_um2=0,macro_area_um2=0,width_um=1000,height_um=1000,power_W=None,provenance='网页新建占位，真实面积、功耗和模块定义待补充')]),resources=dict(technology='待定义',technology_provenance='网页新建，未选择工艺库'),floorplan=dict(placements=[dict(module='module0',die='die_0',x_um=1000,y_um=1000,width_um=1000,height_um=1000)])))
    return dict(report=evaluate(project),yaml=dumps(project))
