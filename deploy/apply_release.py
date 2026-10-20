import hashlib
import importlib
import json
import os
from pathlib import Path
import py_compile
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
stage = Path(sys.argv[1]).resolve()
root = Path('/var/www/yesspec')
nginx = Path('/etc/nginx/sites-available/yesspec')
auth = Path('/etc/yesspec-admin.json')
manifest = json.loads((stage/'manifest.json').read_text())
release = manifest['release']
assert re.fullmatch(r'yesspec-price-check-\d{8}T\d{6}Z', release)
backup = Path('/root/yesspec-backups')/release

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def run(*args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()

def replace(source, dest):
    dest.parent.mkdir(parents=True,exist_ok=True)
    temp = dest.with_name('.'+dest.name+'.'+release)
    shutil.copy2(source,temp)
    temp.chmod(0o644)
    os.replace(temp,dest)

files = list(manifest['files'])
protected_paths = {'data/manual_overrides.json','data/ranking_manual_offers.json','data/daily_prices_feed.json','data/market_observations.jsonl','data/affiliate_config.json'}
assert not protected_paths.intersection(files), 'Runtime data must not be in a release'
for name,expected in manifest['files'].items():
    assert not Path(name).is_absolute() and '..' not in Path(name).parts
    assert digest(stage/name)==expected, 'Bundle checksum mismatch: '+name
for path in stage.glob('*.py'):
    py_compile.compile(str(path),doraise=True)
sys.path.insert(0,str(stage))
ranking = importlib.import_module('ranking_offers')
api = importlib.import_module('admin_server')
assert ranking.payload(stage)['total']==640
cfg = api._get_auth_config()
token = api._make_token(cfg.get('username',''),cfg.get('password_sha256',''),cfg.get('secret',''))
assert token and api._verify_token(token), 'Existing auth config failed preflight'

catalog_pattern = r'const CATEGORIES = (\[[\s\S]*?\n\s*\]);'
live_index = (root/'index.html').read_text()
live_index_hash = hashlib.sha256(live_index.encode()).hexdigest()
prepared_index = (stage/'index.html').read_text()
old_catalog = re.search(catalog_pattern,live_index)
new_catalog = re.search(catalog_pattern,prepared_index)
assert old_catalog and new_catalog
old_data,new_data = json.loads(old_catalog[1]),json.loads(new_catalog[1])
assert [c['id'] for c in old_data]==[c['id'] for c in new_data]
assert {p['id'] for c in old_data for p in c['products']}=={p['id'] for c in new_data for p in c['products']}
# Keep the catalog last edited on production, including its stored sales values.
(stage/'index.html').write_text(prepared_index[:new_catalog.start(1)]+old_catalog[1]+prepared_index[new_catalog.end(1):])

original_nginx = nginx.read_text()
prepared_nginx = original_nginx
if 'location ^~ /deploy/' not in prepared_nginx:
    prepared_nginx = prepared_nginx.replace('    location = /admin.html {',
        '    location ^~ /deploy/ { return 404; }\n\n    location = /admin.html {',1)
if 'location = /admin {' not in prepared_nginx:
    marker = '    location = /admin.html {'
    assert marker in prepared_nginx
    prepared_nginx = prepared_nginx.replace(marker, '''    location = /admin {
        add_header Cache-Control "private, no-store" always;
        return 302 /admin-ranking.html;
    }

'''+marker,1)
if 'location = /admin-ranking.html' not in prepared_nginx:
    marker = '    location = /admin.html {'
    assert marker in prepared_nginx
    prepared_nginx = prepared_nginx.replace(marker,'''    location = /admin-ranking.html {
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Cache-Control "private, no-store" always;
        try_files $uri =404;
    }

    location = /data/ranking_manual_offers.json {
        default_type application/json;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        try_files $uri =404;
    }

'''+marker,1)
prepared_nginx = prepared_nginx.replace('location ~ \\.py$ {','location ~ \\.py[co]?$ {')
(stage/'nginx-yesspec.conf').write_text(prepared_nginx)

protected_names = ['data/manual_overrides.json','data/ranking_manual_offers.json','data/daily_prices_feed.json']
protected = {name:digest(root/name) for name in protected_names}
auth_before = digest(auth)
before = {name:digest(root/name) for name in files}
backup.mkdir(parents=True,mode=0o700)
shutil.copy2(nginx,backup/'nginx.conf')
with tarfile.open(backup/'files.tar.gz','w:gz') as archive:
    for name in sorted(set(files+protected_names)):
        if (root/name).exists():archive.add(root/name,arcname=name)
(backup/'files.tar.gz').chmod(0o600)
(backup/'before.json').write_text(json.dumps({'files':before,'protected':protected},indent=2))

def request(path,body=None,authorized=True):
    headers={'Content-Type':'application/json'}
    if authorized:headers['X-Admin-Token']=token
    req=urllib.request.Request('https://yesspec.com'+path,
        data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=25) as response:
            return response.status,json.load(response)
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            # Nginx returns an HTML 502 while the restarted API is binding.
            payload = {'ok': False, 'error': 'HTTP '+str(error.code)}
        return error.code,payload

stopped=False
# Refuse to overwrite concurrent edits before any production mutation.
assert digest(root/'index.html')==live_index_hash, 'Production catalog changed during preparation'
assert all(digest(root/name)==value for name,value in before.items()), 'Production changed during preparation'
assert all(digest(root/name)==value for name,value in protected.items()), 'Stored data changed during preparation'
try:
    run('systemctl','stop','yesspec-admin');stopped=True
    for name in files:replace(stage/name,root/name)
    store=root/'data/ranking_manual_offers.json'
    if not store.exists():
        with store.open('x') as handle:json.dump({'schema_version':1,'items':{}},handle)
        store.chmod(0o644)
    replace(stage/'nginx-yesspec.conf',nginx)
    run('nginx','-t')
    run('systemctl','start','yesspec-admin');stopped=False
    run('systemctl','reload','nginx')
    status,payload=0,{}
    for attempt in range(20):
        try:
            status,payload=request('/api/admin/ranking-products')
            if status==200:break
        except (urllib.error.URLError,ConnectionError):pass
        time.sleep(0.5)
    assert status==200 and payload['total']==640 and len(payload['categories'])==32
    status,legacy=request('/api/admin/products')
    assert status==200 and legacy['total']==352, 'Legacy admin API failed'
    status,_=request('/api/admin/check-ranking-price',{'platform':'shopee','url':'https://shopee.co.th/product/53892420/45260867994'},authorized=False)
    assert status==401, 'Price API must require login'
    status,invalid=request('/api/admin/check-ranking-price',{'platform':'tiktok','url':'https://example.com/'})
    assert status==400 and invalid['ok'] is False
    # Live read-only requests; never write fixture prices to the production catalog.
    checks=[]
    for platform,url in [('shopee','https://shopee.co.th/product/53892420/45260867994'),('lazada','https://www.lazada.co.th/products/pdp-i5631405294-s23976778493.html')]:
        status,result=request('/api/admin/check-ranking-price',{'platform':platform,'url':url})
        assert status==200 and result['ok'] and result['requires_confirmation']
        checks.append({'platform':platform,'status':result['status'],'candidates':len(result['candidates'])})
    assert digest(auth)==auth_before, 'Auth config changed'
    assert all(digest(root/name)==value for name,value in protected.items() if value is not None), 'Existing stored data changed'
    if protected['data/ranking_manual_offers.json'] is None:
        assert json.loads(store.read_text())['items']=={}, 'Read-only smoke test unexpectedly wrote offers'
    assert run('systemctl','is-active','yesspec-admin')=='active'
    deployed={name:digest(root/name) for name in files}
    (backup/'deployed.json').write_text(json.dumps({'release':release,'files':deployed,'smoke':checks},indent=2))
    print(json.dumps({'ok':True,'release':release,'backup':str(backup),'files':len(files),'categories':32,'items':640,'legacy_items':legacy['total'],'checks':checks,'existing_data_preserved':True,'credentials_unchanged':True},ensure_ascii=False))
except Exception:
    run('systemctl','stop','yesspec-admin')
    with tarfile.open(backup/'files.tar.gz') as archive:archive.extractall(backup/'restore',filter='data')
    for name,previous in before.items():
        if previous is not None:replace(backup/'restore'/name,root/name)
        elif (root/name).exists():(root/name).unlink()
    replace(backup/'nginx.conf',nginx)
    run('nginx','-t')
    run('systemctl','start','yesspec-admin')
    run('systemctl','reload','nginx')
    print(json.dumps({'ok':False,'rolled_back':True,'backup':str(backup)}))
    raise
