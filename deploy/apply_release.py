"""Verified release transaction. Importing this module never deploys a site."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

PROTECTED_PATHS = (
    'data/manual_overrides.json', 'data/ranking_manual_offers.json',
    'data/daily_prices_feed.json', 'data/market_observations.jsonl', 'data/affiliate_config.json',
)


@dataclass(frozen=True)
class ReleasePaths:
    root: Path = Path('/var/www/yesspec')
    nginx: Path = Path('/etc/nginx/sites-available/yesspec')
    auth: Path = Path('/etc/yesspec-admin.json')
    backups: Path = Path('/root/yesspec-backups')
    state: Path = Path('/var/lib/yesspec-deploy')
    origin: str = 'https://yesspec.com'


class ReleaseFailure(RuntimeError):
    def __init__(self, result):
        self.result = result
        super().__init__(result['error'])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def file_state(path):
    require(not path.is_symlink(), 'Refusing symlink: '+str(path))
    require(not path.exists() or path.is_file(), 'Expected a file: '+str(path))
    return {'sha256': digest(path), 'mode': path.stat().st_mode & 0o777 if path.exists() else None}


def replace_file(source, dest):
    """Atomic same-filesystem replacement, retaining the supplied file's mode."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.'+dest.name+'.release-', dir=dest.parent)
    os.close(fd)
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, dest)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def data_lock(root):
    # This is the same inode/path used by runtime_lock.py for admin writes.
    fd = os.open(root/'.yesspec-data.lock', os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def request(path, body=None, authorized=True, *, origin='https://yesspec.com', token='', opener=None):
    headers = {'Content-Type': 'application/json'}
    if authorized:
        headers['X-Admin-Token'] = token
    req = urllib.request.Request(origin+path,
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with (opener or urllib.request.urlopen)(req, timeout=25) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read())
        except (ValueError, UnicodeDecodeError):
            payload = {'ok': False, 'error': 'HTTP '+str(error.code)}
        return error.code, payload


class System:
    """Host adapter; tests replace commands/HTTP while using real temporary files."""
    def __init__(self, paths):
        self.paths = paths

    def run(self, *args):
        return subprocess.run(args, check=True, capture_output=True, text=True, timeout=60).stdout.strip()

    def replace(self, source, dest):
        replace_file(source, dest)

    def preflight(self, stage):
        # Separate process prevents a previous release's cached imports from being reused.
        code = r'''
import json, sys
from pathlib import Path
root=Path(sys.argv[1]); sys.path.insert(0,str(root))
for path in list(root.glob('*.py'))+list((root/'deploy').glob('*.py')):
    compile(path.read_bytes(),str(path),'exec')
import ranking_offers as ranking
import admin_server as api
api.AUTH_CONFIG_PATH=Path(sys.argv[2])
catalog=ranking.payload(root)
feed=json.loads((root/'data/shopee_feed_rankings.json').read_text())
assert catalog['total']==feed['listing_count']>0, 'Catalog count mismatch'
phones_only=feed.get('catalog_mode')=='smartphone_30'
categories=[c['id'] for c in catalog['categories']]
assert not phones_only or (catalog['total']==30 and categories==['smartphone']), 'Phone catalog mismatch'
cfg=api._get_auth_config()
token=api._make_token(cfg.get('username',''),cfg.get('password_sha256',''),cfg.get('secret',''))
assert token and api._verify_token(token), 'Existing auth config failed preflight'
legacy=api.load_all_products_payload()
print(json.dumps(dict(total=catalog['total'],categories=categories,phones_only=phones_only,legacy_total=legacy['total'],token=token)))
'''
        return json.loads(self.run(sys.executable, '-B', '-c', code, str(stage), str(self.paths.auth)))

    def request(self, path, body=None, authorized=True, token=''):
        return request(path, body, authorized, origin=self.paths.origin, token=token)

    def admin_ready(self):
        url = self.paths.origin+'/admin/'
        with urllib.request.urlopen(url, timeout=5) as response:
            return (response.status == 200 and response.geturl() == url
                    and response.headers.get_content_type() == 'text/html'
                    and '<base href="/">' in response.read().decode())

    def sleep(self, seconds):
        time.sleep(seconds)

def prepare_admin_routes(config, phones_only):
    """Serve the ranking admin at /admin/ and preserve existing entry points."""
    marker = '    location = /admin.html {'
    assert marker in config, 'Expected the legacy admin route'
    headers = ('add_header X-Robots-Tag "noindex, nofollow" always;\n'
               '        add_header Cache-Control "private, no-store" always;\n        ')
    routes = {
        '/admin': 'return 302 /admin/$is_args$args;',
        '/admin/': 'default_type text/html;\n        try_files /admin-ranking.html =404;',
        '/admin-ranking.html': 'return 302 /admin/$is_args$args;',
        '/admin.html': 'return 302 /admin/$is_args$args;' if phones_only else 'try_files $uri =404;',
    }
    for path, body in routes.items():
        block = '    location = '+path+' {\n        '+headers+body+'\n    }'
        pattern = r'    location = '+re.escape(path)+r' \{[^}]*\}'
        config, count = re.subn(pattern, lambda _: block, config)
        assert count <= 1, 'Duplicate admin route: '+path
        if count == 0:
            config = config.replace(marker, block+'\n\n'+marker, 1)
    return config


def prepare_nginx(config, phones_only):
    marker = '    location = /admin.html {'
    if 'location ^~ /deploy/' not in config:
        config = config.replace(marker, '    location ^~ /deploy/ { return 404; }\n\n'+marker, 1)
    if 'location = /data/ranking_manual_offers.json' not in config:
        require(marker in config, 'Expected the legacy admin route')
        config = config.replace(marker, '''    location = /data/ranking_manual_offers.json {
        default_type application/json;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        try_files $uri =404;
    }

'''+marker, 1)
    config = config.replace('location ~ \\.py$ {', 'location ~ \\.py[co]?$ {')
    dist_body = ('add_header Cache-Control "no-store" always;\n        return 302 /;' if phones_only else
                 'add_header Cache-Control "public, max-age=3600";\n        try_files $uri $uri.html $uri/ =404;')
    config, count = re.subn(r'location (?:\^~ )?/dist/ \{[^}]*\}',
        'location ^~ /dist/ {\n        '+dist_body+'\n    }', config)
    require(count == 1, 'Expected one legacy content route')
    return prepare_admin_routes(config, phones_only)


def release_path(root, name):
    relative = Path(name)
    require(isinstance(name, str) and name and relative.as_posix() == name and
            not relative.is_absolute() and '..' not in relative.parts and '\\' not in name and name != '.',
            'Unsafe release path: '+str(name))
    path = root/relative
    require(path.resolve().is_relative_to(root.resolve()), 'Release path escapes root: '+name)
    part = path
    while part != root:
        require(not part.is_symlink(), 'Release path contains symlink: '+name)
        part = part.parent
    return path


def catalog_match(live_index, staged_index):
    pattern = r'const CATEGORIES = (\[[\s\S]*?\n\s*\]);'
    old, new = re.search(pattern, live_index), re.search(pattern, staged_index)
    require(old is not None and new is not None, 'Missing legacy catalog')
    old_data, new_data = json.loads(old[1]), json.loads(new[1])
    require([c['id'] for c in old_data] == [c['id'] for c in new_data], 'Legacy category IDs changed')
    require({p['id'] for c in old_data for p in c['products']} ==
            {p['id'] for c in new_data for p in c['products']}, 'Legacy product IDs changed')
    return staged_index[:new.start(1)]+old[1]+staged_index[new.end(1):]


def wait_for(system, check, message):
    for attempt in range(20):
        try:
            if check():
                return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        if attempt < 19:
            system.sleep(0.5)
    raise ValueError(message)


def verify_live(system, expected, *, market_checks=True):
    wait_for(system, system.admin_ready, 'Canonical admin page or its asset base failed the live check')
    def catalog_ready():
        status, payload = system.request('/api/admin/ranking-products', token=expected['token'])
        return (status == 200 and payload.get('total') == expected['total'] and
                [c['id'] for c in payload.get('categories', [])] == expected['categories'])
    wait_for(system, catalog_ready, 'Ranking admin API failed the live check')
    status, legacy = system.request('/api/admin/products', token=expected['token'])
    require(status == 200 and legacy.get('total') == expected['legacy_total'], 'Legacy admin API failed')
    require(system.run('systemctl', 'is-active', 'yesspec-admin') == 'active', 'Admin service is not active')
    if not market_checks:
        return []
    status, _ = system.request('/api/admin/check-ranking-price',
        {'platform':'shopee','url':'https://shopee.co.th/product/53892420/45260867994'}, authorized=False)
    require(status == 401, 'Price API must require login')
    status, invalid = system.request('/api/admin/check-ranking-price',
        {'platform':'tiktok','url':'https://example.com/'}, token=expected['token'])
    require(status == 400 and invalid.get('ok') is False, 'Price API input validation failed')
    checks = []
    for platform, url in [('shopee','https://shopee.co.th/product/53892420/45260867994'),
                          ('lazada','https://www.lazada.co.th/products/pdp-i5631405294-s23976778493.html')]:
        status, result = system.request('/api/admin/check-ranking-price', {'platform':platform,'url':url}, token=expected['token'])
        require(status == 200 and result.get('ok') and result.get('requires_confirmation'), 'Price API read-only check failed')
        checks.append({'platform':platform, 'status':result['status'], 'candidates':len(result['candidates'])})
    return checks


def write_private(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    path.chmod(0o600)


def snapshot_backup(paths, backup, files):
    states = {name:file_state(release_path(paths.root, name)) for name in sorted(set(files) | set(PROTECTED_PATHS))}
    external = {'nginx.conf':paths.nginx, 'auth.json':paths.auth, 'current-commit':paths.state/'current-commit'}
    config_states = {name:file_state(path) for name, path in external.items()}
    backup.mkdir(parents=True, mode=0o700)
    backup.chmod(0o700)
    with tarfile.open(backup/'files.tar.gz', 'w:gz') as archive:
        for name, state in states.items():
            if state['sha256'] is not None:
                archive.add(paths.root/name, arcname=name, recursive=False)
    (backup/'files.tar.gz').chmod(0o600)
    # Verify backups before modifying live files; extraction uses our validated name list.
    with tarfile.open(backup/'files.tar.gz') as archive:
        for name, state in states.items():
            if state['sha256'] is not None:
                require(hashlib.sha256(archive.extractfile(name).read()).hexdigest() == state['sha256'], 'Backup checksum mismatch: '+name)
    for name, path in external.items():
        if config_states[name]['sha256'] is not None:
            shutil.copy2(path, backup/name)
            (backup/name).chmod(0o600)
            require(digest(backup/name) == config_states[name]['sha256'], 'Backup checksum mismatch: '+name)
    write_private(backup/'before.json', {'files':states, 'external':config_states})
    return states, external, config_states


def check_unchanged(paths, states, external, config_states):
    for name, expected in states.items():
        require(file_state(paths.root/name) == expected, 'Production changed during preparation: '+name)
    for name, path in external.items():
        require(file_state(path) == config_states[name], 'Configuration changed during preparation: '+name)


def restore(system, source, dest, previous):
    if previous['sha256'] is None:
        if dest.exists():
            dest.unlink()
    elif file_state(dest) != previous:
        system.replace(source, dest)
        dest.chmod(previous['mode'])


def rollback(system, paths, backup, states, external, config_states, previous_catalog):
    errors = []
    def attempt(label, action):
        try:
            action()
        except Exception as error:
            errors.append(label+': '+str(error))
    attempt('stop admin', lambda:system.run('systemctl', 'stop', 'yesspec-admin'))
    restore_root = backup/'restore'
    try:
        restore_root.mkdir(exist_ok=True)
        with tarfile.open(backup/'files.tar.gz') as archive:
            for name, previous in states.items():
                def restore_one(name=name, previous=previous):
                    source = restore_root/name
                    if previous['sha256'] is not None:
                        content = archive.extractfile(name).read()
                        require(hashlib.sha256(content).hexdigest() == previous['sha256'], 'Restore checksum mismatch')
                        source.parent.mkdir(parents=True, exist_ok=True)
                        source.write_bytes(content)
                        source.chmod(previous['mode'])
                    restore(system, source, paths.root/name, previous)
                attempt('restore '+name, restore_one)
    except Exception as error:
        errors.append('read backup: '+str(error))
    for name, path in external.items():
        attempt('restore '+name, lambda name=name,path=path:restore(system, backup/name, path, config_states[name]))
    attempt('validate nginx', lambda:system.run('nginx', '-t'))
    attempt('start admin', lambda:system.run('systemctl', 'start', 'yesspec-admin'))
    attempt('reload nginx', lambda:system.run('systemctl', 'reload', 'nginx'))
    attempt('verify restored files', lambda:check_unchanged(paths, states, external, config_states))
    attempt('verify restored site', lambda:verify_live(system, previous_catalog, market_checks=False))
    return errors


def apply_release(stage, paths=None, system=None):
    paths = paths or ReleasePaths()
    system = system or System(paths)
    stage = Path(stage).resolve()
    require(stage != paths.root.resolve() and not stage.is_relative_to(paths.root.resolve()) and
            not paths.root.resolve().is_relative_to(stage), 'Staging and live roots must be separate')
    manifest = json.loads((stage/'manifest.json').read_text())
    release, revision = manifest['release'], manifest['revision']
    require(re.fullmatch(r'yesspec-price-check-\d{8}T\d{6}Z', release), 'Invalid release name')
    require(re.fullmatch(r'[0-9a-f]{40}', revision), 'A reviewed full commit SHA is required')
    require(isinstance(manifest.get('files'), dict) and manifest['files'], 'Empty release manifest')
    files = list(manifest['files'])
    require(not set(files).intersection((*PROTECTED_PATHS, '.yesspec-data.lock')), 'Runtime data must not be in a release')
    require('index.html' in files, 'Release must include the public index')
    for name, expected in manifest['files'].items():
        path = release_path(stage, name)
        require(path.is_file() and digest(path) == expected, 'Bundle checksum mismatch: '+name)
        release_path(paths.root, name)
    expected_catalog = system.preflight(stage)
    backup = paths.backups/release
    with data_lock(paths.root):
        previous_catalog = system.preflight(paths.root)
        require(expected_catalog['legacy_total'] == previous_catalog['legacy_total'], 'Legacy admin item count changed')
        require(system.run('systemctl','is-active','yesspec-admin') == 'active', 'Existing admin service must be active')
        # Capture runtime evidence before preparing the content that must preserve it.
        live_index = (paths.root/'index.html').read_text()
        original_nginx = paths.nginx.read_text()
        prepared_index = catalog_match(live_index, (stage/'index.html').read_text())
        prepared_nginx = prepare_nginx(original_nginx, expected_catalog['phones_only'])
        states, external, config_states = snapshot_backup(paths, backup, files)
        (stage/'index.html').write_text(prepared_index)
        (stage/'nginx-yesspec.conf').write_text(prepared_nginx)
        (stage/'nginx-yesspec.conf').chmod(0o644)
        check_unchanged(paths, states, external, config_states)
        try:
            system.run('systemctl', 'stop', 'yesspec-admin')
            for name in files:
                # Git archives may carry group-write bits; keep published files
                # at the established mode without changing backup restore modes.
                (stage/name).chmod(0o644)
                system.replace(stage/name, paths.root/name)
            store = paths.root/'data/ranking_manual_offers.json'
            if not store.exists():
                with store.open('x') as handle:
                    json.dump({'schema_version':1, 'items':{}}, handle)
                store.chmod(0o644)
            system.replace(stage/'nginx-yesspec.conf', paths.nginx)
            system.run('nginx', '-t')
            system.run('systemctl', 'start', 'yesspec-admin')
            system.run('systemctl', 'reload', 'nginx')
            checks = verify_live(system, expected_catalog)
            for name in PROTECTED_PATHS:
                if name == 'data/ranking_manual_offers.json' and states[name]['sha256'] is None:
                    require(json.loads(store.read_text()) == {'schema_version':1, 'items':{}}, 'Read-only check wrote offers')
                else:
                    require(file_state(paths.root/name) == states[name], 'Existing stored data changed: '+name)
            require(file_state(paths.auth) == config_states['auth.json'], 'Auth config changed')
            deployed = {name:digest(paths.root/name) for name in files}
            marker = stage/'deployed-commit'
            marker.write_text(revision+'\n'); marker.chmod(0o600)
            system.replace(marker, paths.state/'current-commit')
            require((paths.state/'current-commit').read_text() == revision+'\n', 'Commit marker verification failed')
            result = {'ok':True, 'release':release, 'deployed_revision':revision, 'backup':str(backup),
                'files':len(files), 'categories':len(expected_catalog['categories']), 'items':expected_catalog['total'],
                'legacy_items':expected_catalog['legacy_total'], 'checks':checks,
                'existing_data_preserved':True, 'credentials_unchanged':True}
            write_private(backup/'deployed.json', {**result, 'files':deployed})
            return result
        except Exception as error:
            errors = rollback(system, paths, backup, states, external, config_states, previous_catalog)
            result = {'ok':False, 'rolled_back':not errors, 'backup':str(backup),
                      'error':str(error), 'rollback_errors':errors}
            try:
                write_private(backup/'failed.json', result)
            except Exception as report_error:
                # Reporting failure must not hide the original fault or recovery outcome.
                result['report_error'] = str(report_error)
            raise ReleaseFailure(result) from error


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description='Apply a reviewed release bundle and verify rollback on failure')
    parser.add_argument('stage', type=Path)
    args = parser.parse_args(argv)
    try:
        result = apply_release(args.stage)
    except ReleaseFailure as error:
        print(json.dumps(error.result, ensure_ascii=False))
        return 1
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
