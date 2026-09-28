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
import uuid

_mutex = threading.RLock()
_held = threading.local()
JOURNAL = '.resim-input-transaction.json'
ALLOWED = {'inputs/chip-architecture.yml', 'inputs/technology.yml', 'project.json'}


@contextmanager
def store_lock(root, timeout=30):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with _mutex:
        key = str(root)
        active = getattr(_held, 'roots', set())
        if key in active:
            yield
            return
        path = root / '.resim-store.lock'
        with open(path, 'a+b') as stream:
            stream.seek(0, 2)
            if stream.tell() == 0:
                stream.write(b'0'); stream.flush()
            deadline = time.monotonic() + timeout
            while True:
                try:
                    stream.seek(0)
                    if os.name == 'nt':
                        import msvcrt
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Project store is busy; retry after the current save')
                    time.sleep(.05)
            _held.roots = active | {key}
            try:
                yield
            finally:
                _held.roots = active
                stream.seek(0)
                if os.name == 'nt': msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


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
