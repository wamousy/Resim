"""Runtime policy for the bundled engine. No fixed candidate-count ceiling.

The preserved engine already enumerates distinct placement assignments and stops
at the configured time budget or exhausted search space. Only its old input cap
of ten is removed here. The search grid, resource checks and time cap are retained.
"""
from resim.schema import Project, Search


def apply():
    field = Search.model_fields['candidates']
    field.metadata = [item for item in field.metadata if not hasattr(item, 'le')]
    Search.model_rebuild(force=True)
    Project.model_rebuild(force=True)
    assert 'maximum' not in Search.model_json_schema()['properties']['candidates']


apply()
