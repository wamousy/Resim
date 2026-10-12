"""The maintained source is a real engine, not a wrapper around the old exe."""
import importlib
from pathlib import Path
from resim.schema import loads
from resim.server import starter
from resim.engine import evaluate
from resim_search_policy import apply


def test_every_recovered_core_module_loads_from_python_source():
    root = Path(__file__).resolve().parents[2] / 'backend'
    modules = ['schema', 'engine', 'optimizer', 'routing', 'physical', 'metal_routing',
               'wiring', 'supply', 'workspace', 'export', 'explain', 'feasibility',
               'methodology', 'lef', 'paths', 'server']
    for name in modules:
        path = Path(importlib.import_module('resim.' + name).__file__).resolve()
        assert path.suffix == '.py' and path.is_relative_to(root)


def test_initialization_is_idempotent_and_reports_identify_source():
    project = loads(starter()['yaml'])
    first = evaluate(project)
    apply()
    assert evaluate(project) == first
    identity = first['provenance']
    assert identity['execution_mode'] == 'source'
    assert len(identity['backend_source_sha256']) == 64
    assert identity['engine_sha256'] == identity['backend_source_sha256']
