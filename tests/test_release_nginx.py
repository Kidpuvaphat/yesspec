"""Exercise generated routes in a separate Nginx process and private web root.

No system service or production config is read or changed. This test is skipped
when Nginx is unavailable; it can also run on a host with Nginx installed.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


@unittest.skipUnless(shutil.which('nginx'), 'Nginx is not installed; run this isolated test on an Nginx host')
class ReleaseNginxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Import only after the availability check; the library itself is tested
        # for import safety by the release workflow tests.
        from deploy.apply_release import prepare_nginx
        cls.prepare_nginx = staticmethod(prepare_nginx)
        cls.nginx = shutil.which('nginx')
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, origin, path):
        try:
            response = self.opener.open(origin + path, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read(), response.geturl()

    @contextmanager
    def site(self, phones_only):
        with tempfile.TemporaryDirectory(prefix='yesspec-nginx-test-') as directory:
            base = Path(directory)
            root = base/'site'
            for name in ('assets', 'data', 'deploy', 'dist'):
                (root/name).mkdir(parents=True)
            admin_html = b'<!doctype html><html><head><base href="/"></head><body>ranking admin fixture</body></html>'
            (root/'admin-ranking.html').write_bytes(admin_html)
            (root/'admin.html').write_text('legacy admin fixture')
            (root/'index.html').write_text('home fixture')
            (root/'assets/probe.js').write_text('window.nginxFixture = true;')
            (root/'data/ranking_manual_offers.json').write_text(json.dumps({'schema_version': 1, 'items': {}}))
            (root/'deploy/private.txt').write_text('must not be served')
            (root/'private.py').write_text('must not be served')
            (root/'private.pyc').write_text('must not be served')
            (root/'dist/old.html').write_text('retained legacy article')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            server = f'''server {{
    listen 127.0.0.1:{port};
    server_name localhost;
    root "{root}";
    location = /admin {{ return 302 /admin-ranking.html; }}
    location = /admin-ranking.html {{ try_files $uri =404; }}
    location = /admin.html {{ try_files $uri =404; }}
    location /dist/ {{ try_files $uri =404; }}
    location ~ \\.py$ {{ return 404; }}
    location / {{ try_files $uri $uri/ =404; }}
}}'''
            server = self.prepare_nginx(server, phones_only)
            # All paths, including implicit HTTP temp directories, stay private.
            temp_paths = '\n'.join(f'    {kind}_temp_path "{base/kind}";' for kind in
                                   ('client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'))
            user = 'user root;\n' if hasattr(os, 'geteuid') and os.geteuid() == 0 else ''
            config = base/'nginx.conf'
            config.write_text(user + f'''master_process off;
pid "{base/'nginx.pid'}";
error_log "{base/'error.log'}" notice;
events {{ worker_connections 32; }}
http {{
    default_type text/plain;
    access_log "{base/'access.log'}";
{temp_paths}
{server}
}}
''')
            command = [self.nginx, '-p', str(base)+'/', '-c', str(config)]
            check = subprocess.run(command + ['-t'], capture_output=True, text=True, timeout=10)
            self.assertEqual(check.returncode, 0, check.stderr)
            with (base/'process.log').open('w+') as log:
                process = subprocess.Popen(command + ['-g', 'daemon off;'], stdout=log, stderr=subprocess.STDOUT)
                try:
                    origin = f'http://127.0.0.1:{port}'
                    deadline = time.monotonic() + 5
                    ready = False
                    while time.monotonic() < deadline:
                        if process.poll() is not None:
                            break
                        try:
                            ready = self.get(origin, '/assets/probe.js')[0] == 200
                        except (urllib.error.URLError, ConnectionError):
                            pass
                        if ready:
                            break
                        time.sleep(0.025)
                    if not ready:
                        log.seek(0)
                        self.fail('Isolated Nginx did not start: ' + log.read())
                    yield origin, admin_html
                finally:
                    # Terminate only this Popen child; never signal by service name.
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)

    def test_phone_admin_routes_assets_and_private_files_through_real_nginx(self):
        with self.site(phones_only=True) as (origin, admin_html):
            status, headers, body, url = self.get(origin, '/admin/?source=qa&keep=yes')
            self.assertEqual(status, 200)
            self.assertEqual(url, origin + '/admin/?source=qa&keep=yes')
            self.assertEqual(body, admin_html)
            self.assertEqual(headers.get_content_type(), 'text/html')
            self.assertIn('no-store', headers['Cache-Control'])
            self.assertIn('noindex', headers['X-Robots-Tag'])
            for path in ('/admin', '/admin.html', '/admin-ranking.html'):
                status, headers, _, _ = self.get(origin, path + '?source=qa&keep=yes')
                self.assertEqual(status, 302, path)
                location = urllib.parse.urlsplit(headers['Location'])
                self.assertEqual(location.path, '/admin/')
                self.assertEqual(location.query, 'source=qa&keep=yes')
            status, _, body, _ = self.get(origin, '/assets/probe.js')
            self.assertEqual(status, 200)
            self.assertEqual(body, b'window.nginxFixture = true;')
            status, headers, body, _ = self.get(origin, '/data/ranking_manual_offers.json')
            self.assertEqual(status, 200)
            self.assertEqual(headers.get_content_type(), 'application/json')
            self.assertIn('no-store', headers['Cache-Control'])
            self.assertEqual(json.loads(body), {'schema_version': 1, 'items': {}})
            for path in ('/deploy/private.txt', '/private.py', '/private.pyc'):
                self.assertEqual(self.get(origin, path)[0], 404, path)
            status, headers, _, _ = self.get(origin, '/dist/old.html')
            self.assertEqual(status, 302)
            self.assertEqual(urllib.parse.urlsplit(headers['Location']).path, '/')

    def test_legacy_mode_keeps_legacy_admin_and_articles_without_changing_canonical_route(self):
        with self.site(phones_only=False) as (origin, admin_html):
            status, headers, body, _ = self.get(origin, '/admin/')
            self.assertEqual(status, 200)
            self.assertEqual(body, admin_html)
            self.assertEqual(headers.get_content_type(), 'text/html')
            status, _, body, _ = self.get(origin, '/admin.html')
            self.assertEqual(status, 200)
            self.assertEqual(body, b'legacy admin fixture')
            status, _, body, _ = self.get(origin, '/dist/old.html')
            self.assertEqual(status, 200)
            self.assertEqual(body, b'retained legacy article')


if __name__ == '__main__':
    unittest.main()
