"""Exercise the same release transaction as the CLI, against real temporary files."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from deploy import apply_release as release


SOURCE = Path(__file__).resolve().parents[1]
REVISION = 'b' * 40
PREVIOUS = 'a' * 40


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FakeSystem:
    """Real file replacements; only host commands, time and HTTP are substituted."""
    def __init__(self, paths):
        self.paths = paths
        self.calls = []
        self.stops = 0
        self.active = True
        self.copy_count = 0
        self.fail_copy_at = None
        self.fail_command = None
        self.command_failed = False
        self.fail_health = False
        self.fail_marker = False
        self.marker_failed = False
        self.fail_rollback_copy = False
        self.rollback_copy_failed = False
        self.first_copy = None
        self.ready_after = 0
        self.ready_calls = 0
        self.api_after = 0
        self.api_calls = 0
        self.lock_probe = None

    @property
    def rolling_back(self):
        return self.stops >= 2

    def preflight(self, stage):
        self.calls.append(('preflight', str(stage)))
        return {'total': 1, 'categories': ['smartphone'], 'phones_only': False,
                'legacy_total': 1, 'token': 'test-only-token'}

    def run(self, *args):
        self.calls.append(args)
        if args == ('systemctl', 'stop', 'yesspec-admin'):
            self.stops += 1
            self.active = False
        if tuple(args) == self.fail_command and not self.command_failed:
            self.command_failed = True
            raise subprocess.CalledProcessError(1, args, stderr='injected command failure')
        if args == ('systemctl', 'start', 'yesspec-admin'):
            self.active = True
        if args == ('systemctl', 'is-active', 'yesspec-admin'):
            return 'active' if self.active else 'inactive'
        return ''

    def replace(self, source, dest):
        source, dest = Path(source), Path(dest)
        self.calls.append(('replace', str(dest)))
        if self.lock_probe is not None:
            self.lock_probe()
            self.lock_probe = None
        if not self.rolling_back and dest != self.paths.state / 'current-commit':
            self.copy_count += 1
            if self.copy_count == self.fail_copy_at:
                raise OSError('injected partial copy failure')
            if self.first_copy is None:
                self.first_copy = dest
        if dest == self.paths.state / 'current-commit' and self.fail_marker and not self.marker_failed:
            self.marker_failed = True
            raise OSError('injected commit marker failure')
        if self.rolling_back and self.fail_rollback_copy and dest == self.first_copy and not self.rollback_copy_failed:
            self.rollback_copy_failed = True
            raise OSError('injected rollback copy failure')
        dest.parent.mkdir(parents=True, exist_ok=True)
        temporary = dest.with_name('.' + dest.name + '.test-replace')
        shutil.copy2(source, temporary)
        os.replace(temporary, dest)

    def request(self, path, body=None, authorized=True, token=''):
        self.calls.append(('request', path, authorized))
        if path == '/api/admin/ranking-products':
            self.api_calls += 1
            if not self.rolling_back and self.api_calls <= self.api_after:
                return 502, {'ok': False, 'error': 'HTTP 502'}
            return 200, {'ok': True, 'total': 1, 'categories': [{'id': 'smartphone'}]}
        if path == '/api/admin/products':
            return 200, {'ok': True, 'total': 1}
        if path == '/api/admin/check-ranking-price':
            if not authorized:
                return 401, {'ok': False, 'error': 'Unauthorized'}
            if body['url'] == 'https://example.com/':
                return 400, {'ok': False, 'error': 'Invalid URL'}
            return 200, {'ok': True, 'requires_confirmation': True,
                         'status': 'no_price', 'candidates': []}
        raise AssertionError('Unexpected request: ' + path)

    def admin_ready(self):
        self.ready_calls += 1
        self.calls.append(('admin_ready',))
        return self.rolling_back or (not self.fail_health and self.ready_calls > self.ready_after)

    def sleep(self, seconds):
        self.calls.append(('sleep', seconds))


class ReleaseWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base / 'site'
        self.stage = self.base / 'stage'
        self.root.mkdir()
        self.stage.mkdir()
        self.paths = release.ReleasePaths(root=self.root, nginx=self.base / 'nginx.conf',
                                          auth=self.base / 'auth.json', backups=self.base / 'backups',
                                          state=self.base / 'state', origin='https://release.test')
        self.paths.state.mkdir()
        (self.paths.state / 'current-commit').write_text(PREVIOUS + '\n')
        (self.paths.state / 'current-commit').chmod(0o600)
        self.paths.auth.write_text('{"secret":"fixture-only","username":"editor"}')
        self.paths.auth.chmod(0o600)
        self.paths.nginx.write_text('''server {
    root /var/www/yesspec;
    location ^~ /api/admin/ { proxy_pass http://127.0.0.1:3195/api/admin/; }
    location /dist/ { try_files $uri =404; }
    location ~ \\.py$ { return 404; }
    location = /admin.html { try_files $uri =404; }
}''')
        old_catalog = [{'id': 'smartphone', 'products': [{'id': 'phone', 'name': 'Phone',
                        'price': 6808, 'shopee': 'https://s.shopee.co.th/Keep?aff=mine'}]}]
        new_catalog = [{'id': 'smartphone', 'products': [{'id': 'phone', 'name': 'Phone', 'price': 1}]}]
        self.catalog = json.dumps(old_catalog, ensure_ascii=False, indent=2)
        for directory, label, catalog in ((self.root, 'old', self.catalog),
                                          (self.stage, 'new', json.dumps(new_catalog, indent=2))):
            (directory / 'assets').mkdir()
            (directory / 'data').mkdir()
            (directory / 'index.html').write_text('<h1>' + label + '</h1>\nconst CATEGORIES = ' + catalog + ';\n')
            (directory / 'admin-ranking.html').write_text('<base href="/"><main>' + label + '</main>')
            (directory / 'assets/app.js').write_text('const release = "' + label + '";')
            (directory / 'assets/phone-value.js').write_text('const unchangedSixModeFormula = true;')
            (directory / 'data/shopee_feed_rankings.json').write_text(json.dumps({
                'source': 'shopee_affiliate_csv', 'listing_count': 1, 'categories': [
                    {'id': 'smartphone', 'items': [{'listing_id': '1/2'}]}]}))
        (self.stage / 'assets/z-new.js').write_text('const newlyAdded = true;')
        for name in release.PROTECTED_PATHS:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({'preserved': name, 'price': 6808,
                                       'url': 'https://s.shopee.co.th/Keep?aff=mine'}))
            path.chmod(0o640)
        self.manifest = {'release': 'yesspec-price-check-20261022T010203Z', 'revision': REVISION,
                         'files': {path.relative_to(self.stage).as_posix(): checksum(path)
                                   for path in sorted(self.stage.rglob('*')) if path.is_file()}}
        self.write_manifest()
        self.system = FakeSystem(self.paths)
        self.before = self.live_snapshot()
        self.protected_before = {name: (self.root / name).read_bytes() for name in release.PROTECTED_PATHS}
        self.protected_modes_before = {name: stat.S_IMODE((self.root / name).stat().st_mode)
                                       for name in release.PROTECTED_PATHS}
        self.auth_before = self.paths.auth.read_bytes()

    def write_manifest(self):
        (self.stage / 'manifest.json').write_text(json.dumps(self.manifest))

    def live_snapshot(self):
        result = {'site/' + path.relative_to(self.root).as_posix(): path.read_bytes()
                  for path in self.root.rglob('*') if path.is_file() and path.name != '.yesspec-data.lock'}
        result.update({'nginx': self.paths.nginx.read_bytes(), 'auth': self.paths.auth.read_bytes(),
                       'commit': (self.paths.state / 'current-commit').read_bytes()})
        return result

    def assert_protected(self):
        for name, data in self.protected_before.items():
            self.assertEqual((self.root / name).read_bytes(), data, name)
            self.assertEqual(stat.S_IMODE((self.root / name).stat().st_mode), self.protected_modes_before[name], name)
        self.assertEqual(self.paths.auth.read_bytes(), self.auth_before)
        self.assertEqual(stat.S_IMODE(self.paths.auth.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.paths.state / 'current-commit').stat().st_mode), 0o600)

    def apply(self):
        return release.apply_release(self.stage, self.paths, self.system)

    def expect_rollback(self):
        with self.assertRaises(release.ReleaseFailure) as caught:
            self.apply()
        result = caught.exception.result
        self.assertFalse(result['ok'])
        self.assertTrue(result['rolled_back'], result)
        self.assertFalse(result['rollback_errors'], result)
        self.assertEqual(self.live_snapshot(), self.before)
        self.assert_protected()
        self.assertTrue(Path(result['backup']).is_dir())
        self.assertTrue(self.system.active)
        return result

    def test_import_has_no_deployment_io_or_global_path_configuration(self):
        script = '''import sys
from pathlib import Path
from unittest.mock import patch
sys.argv = ['unrelated-program', '/does-not-exist']
before_path = list(sys.path)
before_bytecode = sys.dont_write_bytecode
with patch.object(Path, 'read_text', side_effect=AssertionError('import read a deployment file')), \\
     patch.object(Path, 'read_bytes', side_effect=AssertionError('import read a deployment file')), \\
     patch('subprocess.run', side_effect=AssertionError('import ran a command')), \\
     patch('urllib.request.urlopen', side_effect=AssertionError('import made a request')):
    from deploy import apply_release
assert callable(apply_release.apply_release)
assert sys.path == before_path
assert sys.dont_write_bytecode == before_bytecode
print('imported safely')
'''
        result = subprocess.run([sys.executable, '-B', '-c', script], cwd=self.base,
                                env={**os.environ, 'PYTHONPATH': str(SOURCE)}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'imported safely')
        self.assertEqual(self.live_snapshot(), self.before)

    def test_success_publishes_new_code_retains_catalog_runtime_auth_and_updates_commit_last(self):
        result = self.apply()
        self.assertTrue(result['ok'])
        self.assertIn('<h1>new</h1>', (self.root / 'index.html').read_text())
        self.assertIn(self.catalog, (self.root / 'index.html').read_text())
        self.assertEqual((self.root / 'assets/app.js').read_bytes(), (self.stage / 'assets/app.js').read_bytes())
        self.assertTrue((self.root / 'assets/z-new.js').is_file())
        self.assertEqual((self.root / 'assets/phone-value.js').read_bytes(), self.before['site/assets/phone-value.js'])
        self.assert_protected()
        self.assertEqual((self.paths.state / 'current-commit').read_text(), REVISION + '\n')
        marker = self.system.calls.index(('replace', str(self.paths.state / 'current-commit')))
        readiness = self.system.calls.index(('admin_ready',))
        self.assertGreater(marker, readiness)
        self.assertIn('try_files /admin-ranking.html =404;', self.paths.nginx.read_text())

    def test_protected_manifest_file_is_rejected_before_service_or_live_mutation(self):
        name = sorted(release.PROTECTED_PATHS)[0]
        (self.stage / name).write_text('{"must_not_replace":true}')
        self.manifest['files'][name] = checksum(self.stage / name)
        self.write_manifest()
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.live_snapshot(), self.before)
        self.assertFalse(any(call[:2] == ('systemctl', 'stop') for call in self.system.calls))

    def test_bad_checksum_and_parent_path_are_rejected_before_service_or_live_mutation(self):
        for name, digest in [('assets/app.js', '0' * 64), ('../outside', '0' * 64)]:
            with self.subTest(name=name):
                original = dict(self.manifest['files'])
                self.manifest['files'][name] = digest
                self.write_manifest()
                with self.assertRaises(ValueError):
                    self.apply()
                self.assertEqual(self.live_snapshot(), self.before)
                self.assertFalse(any(call[:2] == ('systemctl', 'stop') for call in self.system.calls))
                self.manifest['files'] = original

    def test_partial_install_restores_replaced_files_and_removes_new_files(self):
        self.system.fail_copy_at = 5
        self.expect_rollback()
        self.assertFalse((self.root / 'assets/z-new.js').exists())

    def test_nginx_validation_failure_restores_files_config_service_and_commit(self):
        self.system.fail_command = ('nginx', '-t')
        self.expect_rollback()

    def test_start_failure_restores_files_config_service_and_commit(self):
        self.system.fail_command = ('systemctl', 'start', 'yesspec-admin')
        self.expect_rollback()

    def test_reload_failure_restores_files_config_service_and_commit(self):
        self.system.fail_command = ('systemctl', 'reload', 'nginx')
        self.expect_rollback()

    def test_health_timeout_restores_previous_release_and_checks_it_again(self):
        self.system.fail_health = True
        self.expect_rollback()
        self.assertGreater(self.system.ready_calls, 1)

    def test_slow_nginx_and_api_readiness_retry_without_false_rollback(self):
        self.system.ready_after = 3
        self.system.api_after = 2
        result = self.apply()
        self.assertTrue(result['ok'])
        self.assertGreaterEqual(self.system.ready_calls, 4)
        self.assertGreaterEqual(self.system.api_calls, 3)
        self.assertEqual(self.system.stops, 1)
        self.assert_protected()

    def test_commit_marker_failure_is_part_of_the_rollback_transaction(self):
        self.system.fail_marker = True
        self.expect_rollback()

    def test_success_metadata_failure_restores_commit_already_written_and_previous_release(self):
        write_private = release.write_private
        def write(path, data):
            if path.name == 'deployed.json':
                raise OSError('injected success metadata failure')
            return write_private(path, data)
        with patch.object(release, 'write_private', side_effect=write):
            result = self.expect_rollback()
        self.assertIn('success metadata failure', result['error'])
        self.assertEqual(self.system.calls.count(('replace', str(self.paths.state / 'current-commit'))), 2)

    def test_failure_metadata_error_does_not_mask_original_error_or_verified_rollback(self):
        self.system.fail_copy_at = 3
        write_private = release.write_private
        def write(path, data):
            if path.name == 'failed.json':
                raise OSError('injected failure metadata error')
            return write_private(path, data)
        with patch.object(release, 'write_private', side_effect=write):
            result = self.expect_rollback()
        self.assertIn('partial copy failure', result['error'])

    def test_restore_directory_error_keeps_recovering_config_and_service_and_reports_failure(self):
        self.system.fail_copy_at = 3
        mkdir = Path.mkdir
        def make_directory(path, *args, **kwargs):
            if path.name == 'restore' and path.parent.parent == self.paths.backups:
                raise OSError('injected restore directory failure')
            return mkdir(path, *args, **kwargs)
        with patch.object(Path, 'mkdir', new=make_directory):
            with self.assertRaises(release.ReleaseFailure) as caught:
                self.apply()
        result = caught.exception.result
        self.assertFalse(result['ok'])
        self.assertFalse(result['rolled_back'], result)
        self.assertIn('partial copy failure', result['error'])
        self.assertTrue(any('restore directory failure' in error for error in result['rollback_errors']), result)
        self.assertIn(('nginx', '-t'), self.system.calls)
        self.assertIn(('systemctl', 'start', 'yesspec-admin'), self.system.calls)
        self.assertIn(('systemctl', 'reload', 'nginx'), self.system.calls)
        self.assertEqual(self.paths.nginx.read_bytes(), self.before['nginx'])
        self.assertEqual((self.paths.state / 'current-commit').read_bytes(), self.before['commit'])
        self.assert_protected()

    def test_failed_rollback_is_reported_truthfully_and_does_not_skip_later_recovery_steps(self):
        self.system.fail_copy_at = 3
        self.system.fail_rollback_copy = True
        with self.assertRaises(release.ReleaseFailure) as caught:
            self.apply()
        result = caught.exception.result
        self.assertFalse(result['ok'])
        self.assertFalse(result['rolled_back'], result)
        self.assertTrue(result['rollback_errors'], result)
        self.assertIn('partial copy', result['error'])
        self.assertTrue(self.system.rollback_copy_failed)
        self.assertIn(('nginx', '-t'), self.system.calls)
        self.assertIn(('systemctl', 'start', 'yesspec-admin'), self.system.calls)
        self.assertIn(('systemctl', 'reload', 'nginx'), self.system.calls)
        self.assertEqual(self.paths.nginx.read_bytes(), self.before['nginx'])
        self.assertEqual((self.paths.state / 'current-commit').read_bytes(), self.before['commit'])
        self.assert_protected()

    def test_release_holds_the_same_file_lock_as_admin_writes_and_releases_it_afterward(self):
        script = '''import fcntl, sys
with open(sys.argv[1], 'a') as handle:
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(7)
'''
        command = [sys.executable, '-c', script, str(self.root / '.yesspec-data.lock')]
        probes = []
        def probe():
            status = subprocess.run(command).returncode
            probes.append(status)
            self.assertEqual(status, 7)
        self.system.lock_probe = probe
        self.apply()
        self.assertEqual(probes, [7])
        self.assertEqual(subprocess.run(command).returncode, 0)


if __name__ == '__main__':
    unittest.main()
