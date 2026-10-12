from pathlib import Path
import json
import pytest
from resim.workspace import ProjectStore
from resim.server import starter
from resim.schema import loads

def test_custom_output_keeps_history_and_snapshots(tmp_path):
    text=starter()['yaml'];store=ProjectStore(tmp_path/'projects')
    a=store.simulate(text,output_dir=str(tmp_path/'custom'))
    pid=a['storage']['project_id'];rid=a['storage']['run_id'];run=Path(a['storage']['run_dir'])
    assert run.is_relative_to(tmp_path/'custom')
    assert store.snapshot(pid,rid)==text
    assert store.result(pid,rid)['result']['storage']['run_dir']==str(run)
    assert store.runs(pid)[0]['run_dir']==str(run)
    for name in ['output-manifest.json','implementation-difficulties.md','implementation-difficulties.json','resource-report.json','layout-plan.yml','report.html']:
        assert (run/'results'/name).is_file()
    report=json.loads((run/'results/implementation-difficulties.json').read_text(encoding='utf-8'))
    assert any(g['severity']=='unknown' for g in report['groups'])
    original=(run/'input.yml').read_bytes()
    b=store.simulate(text,project_id=pid,output_dir=str(tmp_path/'another'))
    assert b['storage']['run_dir']!=str(run)
    assert (run/'input.yml').read_bytes()==original
    assert len(store.runs(pid))==2
    with pytest.raises(ValueError):store.simulate(text,project_id=pid,output_dir='relative/path')

def test_starter_is_valid_and_clearly_uncharacterized():
    project=loads(starter()['yaml'])
    assert len(project.architecture.dies)==1
    assert not project.architecture.modules[0].area_known
