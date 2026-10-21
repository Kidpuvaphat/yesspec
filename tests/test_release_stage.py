import hashlib
import importlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from deploy import publish


SOURCE = Path(__file__).resolve().parents[1]
REVISION = 'a' * 40
NOW = datetime(2026, 10, 22, 1, 2, 3, tzinfo=timezone.utc)


class ReleaseStageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.stage, self.live = self.base / 'stage', self.base / 'live'
        for root in (self.stage, self.live):
            for name in ('data', 'dist/articles', 'assets', 'deploy'):
                (root / name).mkdir(parents=True)
        self.files = ['index.html', 'generator.py', 'deploy/release-files.json']
        (self.stage / 'deploy/release-files.json').write_text(json.dumps(self.files))
        (self.stage / 'index.html').write_text('reviewed page')
        (self.stage / 'generator.py').write_text('print("reviewed generator")')
        (self.live / 'index.html').write_text('live page with manual catalog values')
        (self.live / 'data/ranking_manual_offers.json').write_text(
            '{"url":"https://s.shopee.co.th/keep?affiliate=mine","price":6808}')
        (self.live / 'data/affiliate_config.json').write_text('{"keep":"affiliate"}')
        self.calls = []

    def snapshot(self, root):
        return {p.relative_to(root).as_posix(): p.read_bytes()
                for p in root.rglob('*') if p.is_file() and not p.is_symlink()}

    def generate(self, args, **kwargs):
        self.calls.append((args, kwargs))
        self.assertEqual(Path(args[-1]), self.stage / 'generator.py')
        self.assertEqual(kwargs['cwd'], self.stage)
        self.assertEqual(kwargs['env']['TZ'], 'Asia/Bangkok')
        self.assertTrue(kwargs['check'])
        (self.stage / 'dist/generated.html').write_text('generated output')
        (self.stage / 'sitemap.xml').write_text('<sitemap/>')
        return subprocess.CompletedProcess(args, 0, '', '')

    def prepare(self, **kwargs):
        return publish.prepare_release(self.stage, REVISION, self.live,
                                       runner=self.generate, now=NOW, **kwargs)

    def test_import_does_not_read_files_run_commands_or_change_process_settings(self):
        before_path, before_argv = list(sys.path), list(sys.argv)
        bytecode = sys.dont_write_bytecode
        with patch.object(Path, 'read_text', side_effect=AssertionError('Unexpected file read')), \
                patch.object(Path, 'write_text', side_effect=AssertionError('Unexpected file write')), \
                patch('subprocess.run', side_effect=AssertionError('Unexpected command')):
            importlib.reload(publish)
        # Restore the real default runner captured when function defaults are made.
        importlib.reload(publish)
        self.assertEqual(sys.path, before_path)
        self.assertEqual(sys.argv, before_argv)
        self.assertEqual(sys.dont_write_bytecode, bytecode)

    def test_monthly_history_and_generated_public_files_are_hashed_without_changing_live_data(self):
        for name in publish.MONTHLY_FILES:
            (self.live / name).write_text('{"history":"keep from server"}')
            (self.stage / name).write_text('{"history":"old Git version"}')
        (self.live / 'dist/articles/retained.html').write_text('server monthly article')
        (self.stage / 'dist/articles/retained.html').write_text('outdated Git article')
        (self.stage / 'assets/phone.webp').write_bytes(b'reviewed-image')
        (self.stage / 'assets/site.js').write_text('reviewed script')
        (self.stage / 'assets/not-public.py').write_text('excluded from automatic outputs')
        (self.stage / 'data/not-listed.json').write_text('{"not":"a release output"}')
        (self.stage / 'robots.txt').write_text('User-agent: *')
        before = self.snapshot(self.live)
        manifest = self.prepare()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(manifest['revision'], REVISION)
        self.assertEqual(manifest['release'], 'yesspec-price-check-20261022T010203Z')
        self.assertEqual(json.loads((self.stage / 'manifest.json').read_text()), manifest)
        self.assertEqual((self.stage / 'dist/articles/retained.html').read_text(), 'server monthly article')
        expected = set(self.files) | set(publish.MONTHLY_FILES) | {
            'dist/articles/retained.html', 'dist/generated.html', 'assets/phone.webp',
            'assets/site.js', 'sitemap.xml', 'robots.txt',
        }
        self.assertEqual(set(manifest['files']), expected)
        for name, digest in manifest['files'].items():
            self.assertEqual(digest, hashlib.sha256((self.stage / name).read_bytes()).hexdigest())
        self.assertEqual(self.snapshot(self.live), before)

    def test_generator_failure_leaves_live_tree_unchanged_and_does_not_keep_a_manifest(self):
        before = self.snapshot(self.live)
        (self.stage / 'manifest.json').write_text('{"old":"manifest"}')
        def fail(*args, **kwargs):
            (self.stage / 'index.html').write_text('partially generated')
            raise subprocess.CalledProcessError(1, args[0])
        with self.assertRaises(subprocess.CalledProcessError):
            publish.prepare_release(self.stage, REVISION, self.live, runner=fail, now=NOW)
        self.assertEqual(self.snapshot(self.live), before)
        self.assertFalse((self.stage / 'manifest.json').exists())

    def test_all_runtime_files_are_rejected_before_generator_or_monthly_copy(self):
        from deploy.apply_release import PROTECTED_PATHS
        for name in set(PROTECTED_PATHS) | {'.yesspec-data.lock'}:
            with self.subTest(name=name):
                (self.stage / 'deploy/release-files.json').write_text(json.dumps(self.files + [name]))
                before = self.snapshot(self.live)
                with self.assertRaisesRegex(ValueError, 'Runtime data'):
                    self.prepare()
                self.assertEqual(self.calls, [])
                self.assertEqual(self.snapshot(self.live), before)
                self.assertFalse((self.stage / 'manifest.json').exists())

    def test_manifest_path_aliases_and_symlinks_cannot_escape_or_include_runtime_data(self):
        for name in ('../outside', '/etc/passwd', 'data/./ranking_manual_offers.json',
                     'data//ranking_manual_offers.json', 'data\\ranking_manual_offers.json'):
            with self.subTest(name=name):
                (self.stage / 'deploy/release-files.json').write_text(json.dumps(self.files + [name]))
                with self.assertRaisesRegex(ValueError, 'Unsafe release path'):
                    self.prepare()
        (self.stage / 'deploy/release-files.json').write_text(json.dumps(self.files))
        (self.stage / 'assets/alias.json').symlink_to(self.live / 'data/ranking_manual_offers.json')
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            self.prepare()
        self.assertFalse((self.stage / 'manifest.json').exists())

    def test_symlinked_monthly_history_is_rejected_without_reading_or_copying_its_target(self):
        (self.live / 'dist/articles/private.json').symlink_to(self.live / 'data/affiliate_config.json')
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            self.prepare()
        self.assertEqual(self.calls, [])
        self.assertFalse((self.stage / 'dist/articles/private.json').exists())

    def test_invalid_revision_is_rejected_before_file_access_or_commands(self):
        for revision in ('main', '', 'abc', 'A' * 40, None):
            with self.subTest(revision=revision), \
                    patch.object(Path, 'resolve', side_effect=AssertionError('Unexpected path access')):
                with self.assertRaisesRegex(ValueError, '40-character'):
                    publish.prepare_release('/unused', revision, '/unused', runner=self.generate)
        self.assertEqual(self.calls, [])

    def test_sync_rejects_bad_arguments_without_requiring_any_external_commands(self):
        for args in ([], ['main'], ['a' * 40, 'extra']):
            result = subprocess.run(['/bin/bash', str(SOURCE / 'deploy/sync.sh'), *args],
                                    env={**os.environ, 'PATH': ''}, capture_output=True)
            self.assertEqual(result.returncode, 64)
            self.assertIn(b'Usage:', result.stderr)

    def test_staging_inside_live_or_equal_to_live_is_rejected_before_mutation(self):
        before = self.snapshot(self.live)
        for stage in (self.live, self.live / 'temporary-stage', self.base):
            with self.assertRaisesRegex(ValueError, 'separate'):
                publish.prepare_release(stage, REVISION, self.live, runner=self.generate, now=NOW)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.snapshot(self.live), before)

    def test_missing_explicit_file_does_not_produce_a_partial_manifest(self):
        (self.stage / 'deploy/release-files.json').write_text(json.dumps(self.files + ['missing.js']))
        with self.assertRaisesRegex(ValueError, 'Missing release file'):
            self.prepare()
        self.assertFalse((self.stage / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
