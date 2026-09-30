"""Recoverable small-file transactions and a reentrant process lock.

The committed journal is the redo record. Readers recover it under the same lock.
Uncommitted staging files never replace inputs. This is not a filesystem-wide ACID database.
"""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import json
import os
import threading
import time
import tempfile
import uuid

_mutex = threading.RLock()
_held = threading.local()
JOURNAL = '.resim-input-transaction.json'
ALLOWED = {'inputs/chip-architecture.yml', 'inputs/technology.yml', 'project.json'}


@contextmanager
def _windows_store_lock(key, timeout):
    """A kernel mutex leaves no lock file and is released after process failure."""
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
    kernel.ReleaseMutex.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    name = 'Global\\Resim.Store.' + hashlib.sha256(key.encode('utf-8')).hexdigest()
    handle = kernel.CreateMutexW(None, False, name)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    acquired = False
    try:
        status = kernel.WaitForSingleObject(handle, min(0xfffffffe, max(0, int(timeout * 1000))))
        if status == 0x102:
            raise TimeoutError('Project store is busy; retry after the current save')
        if status not in (0, 0x80):  # WAIT_OBJECT_0 / WAIT_ABANDONED: both grant ownership.
            raise ctypes.WinError(ctypes.get_last_error())
        acquired = True
        # Callers recover committed input journals before accessing project data.
        yield
    finally:
        try:
            if acquired and not kernel.ReleaseMutex(handle):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            kernel.CloseHandle(handle)


@contextmanager
def _posix_store_lock(key, timeout):
    """Portable development fallback; its stable lock lives outside project data."""
    import fcntl
    cache = Path(tempfile.gettempdir()) / ('resim-locks-' + str(os.getuid()))
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = cache / (hashlib.sha256(key.encode('utf-8')).hexdigest() + '.lock')
    with open(path, 'a+b') as stream:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Project store is busy; retry after the current save')
                time.sleep(.05)
        try:
            yield
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


@contextmanager
def store_lock(root, timeout=30):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with _mutex:
        key = os.path.normcase(str(root))
        active = getattr(_held, 'roots', set())
        if key in active:
            yield
            return
        process_lock = _windows_store_lock if os.name == 'nt' else _posix_store_lock
        with process_lock(key, timeout):
            _held.roots = active | {key}
            try:
                yield
            finally:
                _held.roots = active


def atomic_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with open(temp, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(text); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def recover(folder, checkpoint=lambda step: None):
    folder = Path(folder).resolve()
    journal = folder / JOURNAL
    if not journal.exists(): return False
    data = json.loads(journal.read_text(encoding='utf-8'))
    if data.get('version') != 1 or set(data.get('files', {})) != ALLOWED:
        raise ValueError('Invalid input transaction journal')
    for name, item in data['files'].items():
        target = (folder / name).resolve()
        if not target.is_relative_to(folder): raise ValueError('Input transaction escapes project')
        if hashlib.sha256(item['text'].encode('utf-8')).hexdigest() != item['sha256']:
            raise ValueError('Input transaction checksum mismatch')
    for name, item in data['files'].items():
        atomic_text(folder / name, item['text'])
        checkpoint(name)
    (folder / 'inputs/architecture.yml').unlink(missing_ok=True)
    journal.unlink()
    return True


def commit_inputs(folder, files, checkpoint=lambda step: None):
    if set(files) != ALLOWED: raise ValueError('Expected both inputs and manifest')
    recover(folder)
    record = {'version': 1, 'files': {name: {'text': text, 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()} for name, text in files.items()}}
    atomic_text(Path(folder) / JOURNAL, json.dumps(record, ensure_ascii=False))
    checkpoint('journal')
    recover(folder, checkpoint)
