"""Resim: architecture-level 3D chip resource exploration."""
__version__ = "0.12.0"

# The maintained 0.12 compatibility layer applies to library, CLI and Web use.
# All imported modules are normal Python source; no bundled-bytecode dependency.
from resim_search_policy import apply as _apply_runtime
_apply_runtime()
del _apply_runtime
