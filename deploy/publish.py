#!/usr/bin/env python3
"""Prepare a reviewed Git checkout without touching the live site, then apply it."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile


PUBLIC_EXTENSIONS = {
    '.html', '.json', '.xml', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg',
    '.webp', '.ico', '.woff', '.woff2',
}
MONTHLY_FILES = ('data/monthly_seo_articles.json', 'data/monthly_status.json')


def _safe_file(root, name):
    """Resolve a manifest file without following a link outside its checkout."""
    if (not isinstance(name, str) or not name or '\\' in name
            or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts
            or name != PurePosixPath(name).as_posix() or name == '.'):
        raise ValueError('Unsafe release path: ' + str(name))
    path = root / name
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('Release paths must not contain symlinks: ' + name)
    if root not in path.resolve().parents:
        raise ValueError('Release path leaves its checkout: ' + name)
    return path


def prepare_release(stage, revision, live_root, *, runner=subprocess.run, now=None):
    """Return and write a manifest, retaining monthly history only in staging.

    The caller serializes this preparation with scheduled jobs. All production
    mutation, data locking, health checks and commit-state writes belong to
    apply_release; a preparation failure leaves the live tree untouched.
    """
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('A reviewed full 40-character commit SHA is required')
    stage, live = Path(stage).resolve(), Path(live_root).resolve()
    if stage == live or stage in live.parents or live in stage.parents:
        raise ValueError('Staging must be separate from the live site')
    # Import here so loading this preparation module never initializes deployment.
    from .apply_release import PROTECTED_PATHS

    files = json.loads(_safe_file(stage, 'deploy/release-files.json').read_text())
    if not isinstance(files, list) or not files or any(not isinstance(name, str) for name in files):
        raise ValueError('Release file list must be a nonempty list of paths')
    for name in files:
        _safe_file(stage, name)
    if set(files).intersection(set(PROTECTED_PATHS) | {'.yesspec-data.lock'}):
        raise ValueError('Runtime data must not be in a release')
    generator = _safe_file(stage, 'generator.py')
    if not generator.is_file():
        raise ValueError('Reviewed release generator is missing')
    manifest_path = _safe_file(stage, 'manifest.json')
    manifest_path.unlink(missing_ok=True)

    articles = _safe_file(live, 'dist/articles')
    if articles.exists():
        if not articles.is_dir():
            raise ValueError('Monthly article history must be a directory')
        for path in articles.rglob('*'):
            _safe_file(live, path.relative_to(live).as_posix())
        target = _safe_file(stage, 'dist/articles')
        if target.exists():
            for path in target.rglob('*'):
                _safe_file(stage, path.relative_to(stage).as_posix())
        shutil.copytree(articles, target, dirs_exist_ok=True)
    for name in MONTHLY_FILES:
        source = _safe_file(live, name)
        if source.is_file():
            target = _safe_file(stage, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    runner([sys.executable, '-B', str(generator)], cwd=stage, check=True,
           capture_output=True, text=True, timeout=60,
           env={**os.environ, 'TZ': 'Asia/Bangkok'})
    public_outputs = [
        path.relative_to(stage).as_posix()
        for directory in ('dist', 'assets')
        for path in _safe_file(stage, directory).rglob('*')
        if path.is_file() and path.suffix.lower() in PUBLIC_EXTENSIONS
    ]
    for name in ('sitemap.xml', 'robots.txt', *MONTHLY_FILES):
        if _safe_file(stage, name).is_file():
            public_outputs.append(name)
    files = sorted(set(files + public_outputs))
    if set(files).intersection(set(PROTECTED_PATHS) | {'.yesspec-data.lock'}):
        raise ValueError('Runtime data must not be in a release')
    hashes = {}
    for name in files:
        source = _safe_file(stage, name)
        if not source.is_file():
            raise ValueError('Missing release file: ' + name)
        hashes[name] = hashlib.sha256(source.read_bytes()).hexdigest()
    timestamp = now if now is not None else datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        raise ValueError('Release time must include a timezone')
    release = 'yesspec-price-check-' + timestamp.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    manifest = {'release': release, 'revision': revision, 'files': hashes}
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=stage,
                                     prefix='.manifest-', delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(manifest, handle, indent=2)
    try:
        os.replace(temporary, manifest_path)
    finally:
        temporary.unlink(missing_ok=True)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', type=Path)
    parser.add_argument('revision')
    args = parser.parse_args(argv)
    from .apply_release import ReleaseFailure, ReleasePaths, System, apply_release
    paths = ReleasePaths(root=Path('/var/www/yesspec'),
                         nginx=Path('/etc/nginx/sites-available/yesspec'),
                         auth=Path('/etc/yesspec-admin.json'),
                         backups=Path('/root/yesspec-backups'),
                         state=Path('/var/lib/yesspec-deploy'),
                         origin='https://yesspec.com')
    try:
        manifest = prepare_release(args.stage, args.revision, paths.root)
        result = apply_release(args.stage, paths, System(paths))
    except ReleaseFailure as error:
        print(json.dumps(error.result, ensure_ascii=False))
        return 1
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    print(json.dumps({'deployed_revision': args.revision, 'release': manifest['release']}))
    return 0


if __name__ == '__main__':
    # Use the package beside this controller, including the old-commit fallback.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from deploy.publish import main as staged_main
    raise SystemExit(staged_main())
