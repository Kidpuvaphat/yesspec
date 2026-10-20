#!/usr/bin/env python3
"""Hostinger-only daily work. No Git, marketplace scraping, or new price observations."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_lock import runtime_lock

JOBS = ('price_sync_mcp.py', 'monthly_updater.py', 'seo_article_generator.py', 'generator.py')
SOURCES = JOBS + ('market_data.py',)
OUTPUTS = ('data/daily_prices_feed.json', 'data/monthly_status.json',
           'data/monthly_seo_articles.json', 'sitemap.xml')
CONFIGS = {
    'config/yesspec-admin.json': Path('/etc/yesspec-admin.json'),
    'config/nginx-yesspec.conf': Path('/etc/nginx/sites-available/yesspec'),
    'config/yesspec-admin.service': Path('/etc/systemd/system/yesspec-admin.service'),
    'config/yesspec-maintenance.service': Path('/etc/systemd/system/yesspec-maintenance.service'),
    'config/yesspec-maintenance.timer': Path('/etc/systemd/system/yesspec-maintenance.timer'),
    'config/deployed-commit': Path('/var/lib/yesspec-deploy/current-commit'),
}


def fingerprint(data):
    return hashlib.sha256(data).hexdigest()


def data_files(root):
    paths = [root / 'index.html']
    paths += sorted(p for p in (root / 'data').rglob('*') if p.is_file())
    for path in paths:
        if path.is_symlink():
            raise ValueError('Runtime data must not contain symlinks')
    return paths


def verify_backup(path):
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        expected = manifest['files']
        if set(archive.namelist()) != set(expected) | {'manifest.json'}:
            raise ValueError('Unexpected backup entries')
        for name, digest in expected.items():
            if Path(name).is_absolute() or '..' in Path(name).parts:
                raise ValueError('Unsafe backup path')
            if fingerprint(archive.read(name)) != digest:
                raise ValueError('Backup checksum mismatch: ' + name)
    return manifest


def backup_data(root, destination, configs=None, keep=30):
    """Caller holds the runtime lock. Retain only our own verified archives."""
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.chmod(0o700)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    final = destination / ('yesspec-data-' + stamp + '.zip')
    temporary = final.with_suffix('.partial')
    entries = {'site/' + p.relative_to(root).as_posix(): p for p in data_files(root)}
    # Historical generated articles cannot always be reproduced from today's data.
    for p in sorted((root / 'dist' / 'articles').glob('*.html')):
        if p.is_symlink():
            raise ValueError('Article must not be a symlink')
        entries['site/' + p.relative_to(root).as_posix()] = p
    entries.update({name: p for name, p in (CONFIGS if configs is None else configs).items() if p.is_file()})
    manifest = {'schema_version': 1, 'created_at': datetime.now(timezone.utc).isoformat(), 'files': {}}
    try:
        with temporary.open('xb') as handle:
            temporary.chmod(0o600)
            with zipfile.ZipFile(handle, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for name, path in entries.items():
                    content = path.read_bytes()
                    archive.writestr(name, content)
                    manifest['files'][name] = fingerprint(content)
                archive.writestr('manifest.json', json.dumps(manifest, indent=2))
        verify_backup(temporary)
        os.replace(temporary, final)
    finally:
        temporary.unlink(missing_ok=True)
    archives = sorted(p for p in destination.iterdir()
                      if re.fullmatch(r'yesspec-data-\d{8}T\d{12}Z\.zip', p.name) and p.is_file())
    for old in archives[:-max(1, keep)]:
        old.unlink()
    return final


def replace_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + target.name + '-', dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        shutil.copyfile(source, temporary)
        temporary.chmod(0o644)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def publish_outputs(stage, root):
    files = list(OUTPUTS)
    files += [p.relative_to(stage).as_posix() for p in (stage/'dist').rglob('*')
              if p.is_file() and p.suffix in {'.html', '.json', '.xml'}]
    files = sorted(set(files))
    if any(not (stage/name).is_file() for name in files):
        raise ValueError('Missing generated output')
    # All JSON must parse before the first live file changes.
    for name in files:
        if name.endswith('.json'):
            json.loads((stage/name).read_text())
    before = {name: (root/name).read_bytes() if (root/name).exists() else None for name in files}
    changed = []
    try:
        for name in files:
            changed.append(name)
            replace_file(stage/name, root/name)
    except Exception:
        for name in reversed(changed):
            if before[name] is None:
                (root/name).unlink(missing_ok=True)
            else:
                restore = stage / 'rollback' / name
                restore.parent.mkdir(parents=True, exist_ok=True)
                restore.write_bytes(before[name])
                replace_file(restore, root/name)
        raise
    return len(files)


def run_daily(root, backup_root, state, configs=None, runner=subprocess.run, backup_only=False):
    root, backup_root, state = Path(root), Path(backup_root), Path(state)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    # Also excludes manual deployments; admin requests wait only for the data lock.
    with runtime_lock(state), runtime_lock(root):
        backup = backup_data(root, backup_root, configs=configs)
        if backup_only:
            return {'ok': True, 'backup': str(backup), 'backup_verified': True}
        with tempfile.TemporaryDirectory(prefix='daily-', dir=state) as temporary:
            stage = Path(temporary)
            for source in SOURCES:
                shutil.copy2(root/source, stage/source)
            for source in data_files(root):
                target = stage / source.relative_to(root)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            # Preserve all existing month URLs in the generated sitemap.
            if (root/'dist').exists():
                shutil.copytree(root/'dist', stage/'dist')
            env = {**os.environ, 'TZ': 'Asia/Bangkok', 'PYTHONDONTWRITEBYTECODE': '1'}
            for job in JOBS:
                runner([sys.executable, str(stage/job)], cwd=stage, env=env,
                       check=True, capture_output=True, text=True, timeout=60)
            count = publish_outputs(stage, root)
        result = {'ok': True, 'completed_at': datetime.now(timezone.utc).isoformat(),
                  'timezone': 'Asia/Bangkok', 'backup': str(backup), 'backup_verified': True,
                  'files_generated': count, 'price_observations_refreshed': False}
        status = state/'last-success.tmp'
        status.write_text(json.dumps(result, indent=2))
        status.chmod(0o600)
        os.replace(status, state/'last-success.json')
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup-only', action='store_true')
    parser.add_argument('--verify-backup', type=Path)
    args = parser.parse_args()
    if args.verify_backup:
        result = verify_backup(args.verify_backup)
        print(json.dumps({'ok': True, 'files_verified': len(result['files'])}))
    else:
        result = run_daily('/var/www/yesspec', '/root/yesspec-data-backups',
                           '/var/lib/yesspec-ops', backup_only=args.backup_only)
        print(json.dumps(result))


if __name__ == '__main__':
    main()
