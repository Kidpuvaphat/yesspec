#!/usr/bin/env bash
# Manual deployment only: pass the full SHA of an explicitly reviewed commit.
set -euo pipefail
if [[ $# != 1 ]] || [[ ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: bash deploy/sync.sh <reviewed-40-character-commit-sha>" >&2
  exit 64
fi
site_root=/var/www/yesspec
state_root=/var/lib/yesspec-deploy
ops_root=/var/lib/yesspec-ops
mkdir -p "$state_root" "$ops_root" /root/yesspec-releases
chmod 700 "$state_root" "$ops_root"
exec 9>"$ops_root/.yesspec-data.lock"
/usr/bin/flock -w 300 9
git -C "$site_root" fetch origin main
revision=$1
git -C "$site_root" cat-file -e "$revision^{commit}"
git -C "$site_root" merge-base --is-ancestor "$revision" refs/remotes/origin/main
if [[ -f "$state_root/current-commit" ]] && [[ $(cat "$state_root/current-commit") == "$revision" ]]; then
  echo "Already deployed $revision"
  exit 0
fi
stage_dir=$(mktemp -d /root/yesspec-releases/sync-XXXXXXXX)
git -C "$site_root" archive "$revision" | tar -xf - -C "$stage_dir"
python3 - "$stage_dir" "$revision" "$state_root" <<'PY'
import datetime, hashlib, json, os, subprocess, sys
from pathlib import Path
import shutil
stage, revision, state = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
live = Path('/var/www/yesspec')
# Monthly content belongs to the server. Keep its history across code releases.
if (live/'dist/articles').exists():
    shutil.copytree(live/'dist/articles', stage/'dist/articles', dirs_exist_ok=True)
for name in ('data/monthly_seo_articles.json', 'data/monthly_status.json'):
    if (live/name).is_file():
        shutil.copy2(live/name, stage/name)
# Generate spec pages and a sitemap with the reviewed generator and retained articles.
subprocess.run([sys.executable,str(stage/'generator.py')],cwd=stage,check=True,
               capture_output=True,text=True,timeout=60,env={**os.environ,'TZ':'Asia/Bangkok'})
files = json.loads((stage/'deploy/release-files.json').read_text())
# Include generated articles and their indexes on future scheduled releases.
# Keep runtime data outside these public-output directories.
public_outputs = [
    path.relative_to(stage).as_posix()
    for directory in ('dist', 'assets')
    for path in (stage/directory).rglob('*')
    if path.is_file() and path.suffix.lower() in {
        '.html', '.json', '.xml', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2'
    }
]
for name in ('sitemap.xml', 'robots.txt', 'data/monthly_seo_articles.json', 'data/monthly_status.json'):
    if (stage/name).is_file():
        public_outputs.append(name)
files = sorted(set(files + public_outputs))
release = 'yesspec-price-check-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
manifest = {'release':release,'revision':revision,'files':{
    name:hashlib.sha256((stage/name).read_bytes()).hexdigest() for name in files}}
(stage/'manifest.json').write_text(json.dumps(manifest,indent=2))
subprocess.run([sys.executable,str(stage/'deploy/apply_release.py'),str(stage)],check=True)
temp=state/'current-commit.tmp'
temp.write_text(revision+'\n')
os.replace(temp,state/'current-commit')
print(json.dumps({'deployed_revision':revision,'release':release}))
PY
