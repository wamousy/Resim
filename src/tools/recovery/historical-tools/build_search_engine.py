"""Add a source-controlled runtime hook to the existing PyInstaller engine.

Keeps the bootloader and every original archive entry byte-for-byte. No external
build dependency, decompilation or changes to solver code. CArchive format:
https://github.com/pyinstaller/pyinstaller/blob/develop/PyInstaller/archive/readers.py
Run with the same Python major/minor as the bundled engine (3.13).
"""
from pathlib import Path
import argparse
import hashlib
import marshal
import struct
import sys
import zlib

MAGIC = b'MEI\x0c\x0b\x0a\x0b\x0e'
COOKIE = struct.Struct('!8sIIII64s')
ENTRY = struct.Struct('!IIIIBc')
HOOK = 'resim_search_policy'


def parse(data):
    offset = data.rfind(MAGIC)
    if offset < 0 or offset + COOKIE.size != len(data):
        raise ValueError('Expected unsigned PyInstaller engine with trailing cookie')
    magic, length, toc, size, version, library = COOKIE.unpack_from(data, offset)
    start = len(data) - length
    if start < 0 or toc + size != length - COOKIE.size:
        raise ValueError('Invalid archive bounds')
    entries, cursor, end = [], start + toc, start + toc + size
    while cursor < end:
        n, pos, stored, plain, compressed, kind = ENTRY.unpack_from(data, cursor)
        if n < ENTRY.size or cursor + n > end or pos + stored > toc:
            raise ValueError('Invalid archive entry')
        name = data[cursor + ENTRY.size:cursor + n].rstrip(b'\0').decode('utf-8')
        entries.append((name, pos, stored, plain, compressed, kind))
        cursor += n
    if cursor != end:
        raise ValueError('Invalid table of contents')
    return start, toc, version, library, entries


def build(source, output, hook):
    if source.resolve() == output.resolve():
        raise ValueError('Build to a staging executable, never overwrite the running engine')
    data = source.read_bytes()
    start, toc, version, library, entries = parse(data)
    if version != sys.version_info.major * 100 + sys.version_info.minor:
        raise ValueError('Build Python version must match engine bytecode version')
    if not any(e[0] == 'entry' and e[5] == b's' for e in entries):
        raise ValueError('Unexpected engine entry point')
    # Remove any previous edition of this hook, preserving all original entries.
    entries = [e for e in entries if e[0] != HOOK]
    # Embed maintained extension modules; the installed application needs no src folder.
    extension_sources = [(p.stem, p.read_text(encoding='utf-8')) for p in sorted(hook.parent.glob('resim_policy_*.py'))]
    prelude = 'import sys, types\n'
    for name, code in extension_sources:
        prelude += f"_m = types.ModuleType({name!r}); _m.__file__ = {name + '.py'!r}; sys.modules[{name!r}] = _m\n"
        prelude += f"exec(compile({code!r}, {name + '.py'!r}, 'exec'), _m.__dict__)\n"
    plain = marshal.dumps(compile(prelude + hook.read_text(encoding='utf-8'), 'resim_search_policy.py', 'exec'))
    compressed = zlib.compress(plain)
    payload = data[start:start + toc] + compressed
    hook_entry = (HOOK, toc, len(compressed), len(plain), 1, b's')
    entries.insert(next(i for i, e in enumerate(entries) if e[0] == 'entry'), hook_entry)
    table = bytearray()
    for name, pos, stored, plain_size, flag, kind in entries:
        encoded = name.encode('utf-8') + b'\0'
        length = (ENTRY.size + len(encoded) + 15) // 16 * 16
        table += ENTRY.pack(length, pos, stored, plain_size, flag, kind)
        table += encoded.ljust(length - ENTRY.size, b'\0')
    archive_length = len(payload) + len(table) + COOKIE.size
    result = data[:start] + payload + table + COOKIE.pack(MAGIC, archive_length, len(payload), len(table), version, library)
    out_start, _, _, _, out_entries = parse(result)
    for name, pos, size, plain_size, flag, kind in entries:
        if name != HOOK and data[start + pos:start + pos + size] != result[out_start + pos:out_start + pos + size]:
            raise AssertionError('An original entry changed: ' + name)
    output.write_bytes(result)
    print('Built', output.name, 'sha256', hashlib.sha256(result).hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    root = Path(__file__).resolve().parents[2]
    parser.add_argument('--source', type=Path, default=root / 'app/Resim.Engine.exe')
    parser.add_argument('--output', type=Path, default=root / 'app/Resim.Engine.next.exe')
    args = parser.parse_args()
    build(args.source, args.output, root / 'src/resim_search_policy.py')
