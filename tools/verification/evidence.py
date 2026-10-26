"""Source identity and streaming evidence hashing; no retention deletion."""

import hashlib
import os
from pathlib import Path
import subprocess


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def revision(root, excludes):
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True)
    if head.returncode:
        return {'sha': None, 'dirtySha256': None, 'versioned': False}
    paths = ['.', *[':(exclude)' + str(p) for p in excludes]]
    changed = subprocess.run(['git', 'diff', 'HEAD', '--binary', '--', *paths], cwd=root,
                             capture_output=True, check=True).stdout
    untracked = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard', '-z', '--', *paths],
                               cwd=root, capture_output=True, check=True).stdout
    state = hashlib.sha256(changed)
    names = sorted(name for name in untracked.split(b'\0') if name)
    for name in names:
        path = root / os.fsdecode(name)
        if path.is_symlink():
            value = os.readlink(path)
        elif path.is_file():
            value = digest(path)
        else:
            raise RuntimeError('Cannot fingerprint an untracked source entry')
        state.update(name + b'\0' + value.encode() + b'\0')
    return {'sha': head.stdout.decode().strip(), 'dirtySha256': state.hexdigest() if changed or names else None,
            'versioned': True}


def below(root, value):
    path = (root / value).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f'Path must be inside repository: {value}')
    return path


def artifact_snapshot(root, paths):
    found = {}
    for item in paths:
        source = below(root, item)
        if not source.exists():
            continue
        for file in source.rglob('*') if source.is_dir() else [source]:
            if not file.is_symlink() and file.is_file():
                found[str(file)] = digest(file)
    return found
