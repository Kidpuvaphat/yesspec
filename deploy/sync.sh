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
publisher="$stage_dir/deploy/publish.py"
# Older reviewed commits predate the preparation module. Use the current
# controller to apply their files without executing their old deploy script.
if [[ ! -f "$publisher" ]]; then
  publisher="$site_root/deploy/publish.py"
fi
python3 -B "$publisher" "$stage_dir" "$revision"
