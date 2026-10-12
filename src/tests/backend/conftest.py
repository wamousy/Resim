"""Every test receives an isolated store; real user projects are never fixtures."""
import pytest


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv('RESIM_PROJECTS_DIR', str(tmp_path / 'isolated-projects'))
