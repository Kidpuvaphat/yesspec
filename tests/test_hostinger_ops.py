import json
import ast
import io
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import urllib.error
import urllib.request

from deploy import maintenance as ops
from runtime_lock import runtime_lock

SOURCE = Path(__file__).resolve().parents[1]


class HostingerOpsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base/'site'
        (self.root/'data').mkdir(parents=True)
        self.backups = self.base/'backups'
        self.state = self.base/'state'
        for name in ops.SOURCES:
            shutil.copy2(SOURCE/name, self.root/name)
        catalog = [{'id': 'smartphone', 'products': [{'id': 'p', 'name': 'Phone', 'price': 100}]}]
        (self.root/'index.html').write_text('const CATEGORIES = '+json.dumps(catalog, indent=2)+';')
        self.store = {
            'platform': 'shopee', 'evidence_version': 2, 'source': 'manual',
            'confirmed_match': True, 'observed_at': '2026-01-01T00:00:00+00:00',
            'candidate_price': 99, 'price_basis': 'member', 'variant': '128GB',
            'link': 'https://shopee.co.th/product/1/2'
        }
        self.write('data/daily_prices_feed.json', {'items_by_id': {
            'p': {'id': 'p', 'name': 'Phone', 'stores_sorted': [self.store]}}})
        self.write('data/ranking_manual_offers.json', {
            'schema_version': 1, 'items': {'p': {'tiktok': {'url': 'https://vt.tiktok.com/test', 'price': 88, 'price_type': 'vip'}}}})
        self.write('data/manual_overrides.json', {})
        self.write('data/products.json', {'affiliate_config': {'domain': 'https://yesspec.com'},
                                         'categories': [], 'products': []})
        self.auth = self.base/'auth.json'
        self.auth.write_text('{"secret":"fixture-only"}')
        self.configs = {'config/yesspec-admin.json': self.auth}

    def write(self, name, value):
        (self.root/name).write_text(json.dumps(value))

    def test_backup_verifies_and_restores_exact_bytes_in_isolated_directory(self):
        backup = ops.backup_data(self.root, self.backups, self.configs)
        manifest = ops.verify_backup(backup)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.backups.stat().st_mode & 0o777, 0o700)
        restored = self.base/'restore'
        with zipfile.ZipFile(backup) as archive:
            for name in manifest['files']:
                target = restored/name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
        self.assertEqual((restored/'site/data/ranking_manual_offers.json').read_bytes(),
                         (self.root/'data/ranking_manual_offers.json').read_bytes())
        self.assertEqual((restored/'config/yesspec-admin.json').read_bytes(), self.auth.read_bytes())
        broken = self.base/'broken.zip'
        with zipfile.ZipFile(backup) as source, zipfile.ZipFile(broken, 'w') as target:
            for name in source.namelist():
                target.writestr(name, b'corrupt' if name == 'site/index.html' else source.read(name))
        with self.assertRaisesRegex(ValueError, 'checksum'):
            ops.verify_backup(broken)

    def test_retention_only_removes_our_old_archives_after_new_backup_is_verified(self):
        first = ops.backup_data(self.root, self.backups, self.configs, keep=2)
        sentinel = self.backups/'manual-keep.zip'
        sentinel.write_bytes(b'keep')
        second = ops.backup_data(self.root, self.backups, self.configs, keep=2)
        third = ops.backup_data(self.root, self.backups, self.configs, keep=2)
        self.assertFalse(first.exists())
        self.assertTrue(second.exists() and third.exists() and sentinel.exists())

    def test_daily_jobs_keep_manual_prices_links_and_observation_time(self):
        names = ['index.html', 'data/manual_overrides.json', 'data/ranking_manual_offers.json']
        before = {n: (self.root/n).read_bytes() for n in names}
        result = ops.run_daily(self.root, self.backups, self.state, configs=self.configs)
        self.assertTrue(result['backup_verified'])
        self.assertFalse(result['price_observations_refreshed'])
        for name in names:
            self.assertEqual((self.root/name).read_bytes(), before[name])
        feed = json.loads((self.root/'data/daily_prices_feed.json').read_text())
        offer = next(s for s in feed['items_by_id']['p']['stores_sorted'] if s['platform'] == 'shopee')
        self.assertEqual(offer['observed_at'], self.store['observed_at'])
        self.assertEqual(offer['candidate_price'], 99)
        self.assertIsNone(offer['net_price'])  # Old evidence stays old.
        status = json.loads((self.root/'data/monthly_status.json').read_text())
        self.assertTrue(status['updated_at_iso'].endswith('+07:00'))
        self.assertFalse(status['price_observations_refreshed'])
        self.assertTrue((self.state/'last-success.json').exists())

    def test_job_failure_keeps_live_files_and_leaves_a_verified_backup(self):
        before = {p.relative_to(self.root): p.read_bytes() for p in ops.data_files(self.root)}
        def fail(*args, **kwargs):
            raise subprocess.CalledProcessError(1, args[0])
        with self.assertRaises(subprocess.CalledProcessError):
            ops.run_daily(self.root, self.backups, self.state, configs=self.configs, runner=fail)
        for name, content in before.items():
            self.assertEqual((self.root/name).read_bytes(), content)
        self.assertFalse((self.state/'last-success.json').exists())
        ops.verify_backup(next(self.backups.glob('*.zip')))

    def test_publish_failure_rolls_back_already_replaced_files(self):
        stage = self.base/'stage'
        (stage/'data').mkdir(parents=True)
        for name in ops.OUTPUTS:
            (stage/name).write_text('{}' if name.endswith('.json') else '<xml/>')
        old = (self.root/'data/daily_prices_feed.json').read_bytes()
        original = ops.replace_file
        calls = 0
        def replace(source, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('simulated disk failure')
            return original(source, target)
        with patch.object(ops, 'replace_file', side_effect=replace), self.assertRaises(OSError):
            ops.publish_outputs(stage, self.root)
        self.assertEqual((self.root/'data/daily_prices_feed.json').read_bytes(), old)
        self.assertFalse((self.root/'data/monthly_seo_articles.json').exists())

    def test_runtime_lock_blocks_another_writer(self):
        script = '''import fcntl, sys
with open(sys.argv[1], "a") as handle:
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(7)
'''
        command = [sys.executable, '-c', script, str(self.root/'.yesspec-data.lock')]
        with runtime_lock(self.root):
            self.assertEqual(subprocess.run(command).returncode, 7)
        self.assertEqual(subprocess.run(command).returncode, 0)

    def test_deploy_requires_a_specific_commit_before_any_network_or_server_action(self):
        for args in ([], ['main'], ['abcdef'], ['a'*40, 'extra']):
            result = subprocess.run(['bash', str(SOURCE/'deploy/sync.sh'), *args], capture_output=True)
            self.assertEqual(result.returncode, 64)

    def test_deploy_health_probe_handles_nginx_html_during_api_startup(self):
        # Load only this pure function; importing the release script would deploy.
        tree = ast.parse((SOURCE/'deploy/apply_release.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'request')
        scope = {'json': json, 'urllib': urllib, 'token': 'test-only'}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<health-probe>', 'exec'), scope)
        error = urllib.error.HTTPError('https://yesspec.com', 502, 'Bad Gateway', {}, io.BytesIO(b'<html>502</html>'))
        with patch('urllib.request.urlopen', side_effect=error):
            status, payload = scope['request']('/api/admin/ranking-products')
        self.assertEqual(status, 502)
        self.assertFalse(payload['ok'])

    def admin_routes(self):
        tree = ast.parse((SOURCE/'deploy/apply_release.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'prepare_admin_routes')
        scope = {'re': re}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<admin-routes>', 'exec'), scope)
        return scope['prepare_admin_routes']

    def test_canonical_admin_routes_upgrade_old_config_and_are_idempotent(self):
        config = '''server {
    location ^~ /api/admin/ { proxy_pass http://127.0.0.1:3195/api/admin/; }
    location = /admin { return 302 /admin-ranking.html; }
    location = /admin-ranking.html { try_files $uri =404; }
    location = /admin.html { return 302 /admin-ranking.html; }
}'''
        prepare = self.admin_routes()
        result = prepare(config, True)
        self.assertEqual(prepare(result, True), result)
        self.assertEqual(result.count('return 302 /admin/$is_args$args;'), 3)
        canonical = re.search(r'location = /admin/ \{([^}]+)\}', result)[1]
        self.assertIn('alias /var/www/yesspec/admin-ranking.html;', canonical)
        self.assertIn('default_type text/html;', canonical)
        self.assertIn('"private, no-store" always;', canonical)
        self.assertIn('"noindex, nofollow" always;', canonical)
        self.assertNotIn('return 302', canonical)
        self.assertIn('location ^~ /api/admin/ { proxy_pass http://127.0.0.1:3195/api/admin/; }', result)

    def test_admin_routes_handle_missing_entries_and_retain_legacy_mode(self):
        prepare = self.admin_routes()
        config = 'server {\n    location = /admin.html { try_files $uri =404; }\n}'
        result = prepare(config, False)
        self.assertEqual(result.count('location = /admin/ {'), 1)
        self.assertEqual(result.count('return 302 /admin/$is_args$args;'), 2)
        legacy = re.search(r'location = /admin\.html \{([^}]+)\}', result)[1]
        self.assertIn('try_files $uri =404;', legacy)
        self.assertEqual(prepare(prepare(result, True), False), result)
        with self.assertRaisesRegex(AssertionError, 'Duplicate admin route'):
            prepare(config + '\n    location = /admin { return 302 /; }\n    location = /admin { return 302 /; }', True)


if __name__ == '__main__':
    unittest.main()
