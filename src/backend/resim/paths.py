"""Read-only application assets and a separately located writable project store."""
import os
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
if getattr(sys, 'frozen', False):
    APPLICATION_ROOT = Path(sys.executable).resolve().parent
    STATIC_ROOT = PACKAGE_ROOT / 'static'
elif PACKAGE_ROOT.parent.name == 'backend':
    APPLICATION_ROOT = PACKAGE_ROOT.parents[2]
    STATIC_ROOT = PACKAGE_ROOT.parents[1] / 'frontend'
else:
    APPLICATION_ROOT = None  # Installed Python package: use a user data directory.
    STATIC_ROOT = PACKAGE_ROOT / 'static'


def get_projects_root():
    override = os.environ.get('RESIM_PROJECTS_DIR')
    if override:
        return Path(override).expanduser().resolve()
    if APPLICATION_ROOT is not None:
        return APPLICATION_ROOT.parent / 'ResimProjects'
    return Path.home() / 'Documents' / 'ResimProjects'


def references_root():
    return get_projects_root() / '_references'
