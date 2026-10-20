#!/usr/bin/env bash
# Called under flock by /etc/cron.d/yesspec-sync. Never checks out over live data.
set -euo pipefail
site_root=/var/www/yesspec
state_root=/var/lib/yesspec-deploy
mkdir -p "$state_root" /root/yesspec-releases
chmod 700 "$state_root"
git -C "$site_root" fetch origin main
revision=$(git -C "$site_root" rev-parse refs/remotes/origin/main)
if [[ -f "$state_root/current-commit" ]] && [[ $(cat "$state_root/current-commit") == "$revision" ]]; then
  echo "Already deployed $revision"
  exit 0
fi
stage_dir=$(mktemp -d /root/yesspec-releases/sync-XXXXXXXX)
git -C "$site_root" archive "$revision" | tar -xf - -C "$stage_dir"
python3 - "$stage_dir" "$revision" "$state_root" <<'PY'
import datetime, hashlib, json, os, subprocess, sys
from pathlib import Path
stage, revision, state = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
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
