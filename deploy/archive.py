#!/usr/bin/env python3
"""Extract a Git source archive without links, special files, or host path escapes."""
import pathlib
import shutil
import sys
import tarfile


def extract(archive, destination):
    root = pathlib.Path(destination)
    if root.is_symlink() or not root.is_dir() or any(root.iterdir()):
        raise ValueError('release destination must be an empty directory')
    with tarfile.open(archive, 'r:') as source:
        members = source.getmembers()
        if len(members) > 50000 or sum(m.size for m in members) > 512 * 1024 * 1024:
            raise ValueError('source archive exceeds limits')
        seen = set()
        for item in members:
            path = pathlib.PurePosixPath(item.name)
            if (not item.name or path.is_absolute() or '..' in path.parts
                    or '\\' in item.name or item.name in seen
                    or not (item.isfile() or item.isdir())):
                raise ValueError('unsafe archive entry')
            if any(p in ('.git', 'node_modules', '.next', '.pixloom', '.pixloom-release')
                   or p.startswith('.next-') or (p.startswith('.env') and p != '.env.example')
                   for p in path.parts):
                raise ValueError('runtime state or credentials must not be in a source archive')
            seen.add(item.name)
        for item in members:
            target = root.joinpath(*pathlib.PurePosixPath(item.name).parts)
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with source.extractfile(item) as content, target.open('xb') as output:
                    shutil.copyfileobj(content, output)
                target.chmod(0o755 if item.mode & 0o111 else 0o644)


if __name__ == '__main__':
    try:
        extract(*sys.argv[1:])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
