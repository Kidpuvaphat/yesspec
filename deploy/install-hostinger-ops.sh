#!/usr/bin/env bash
# Run after deploying a reviewed source release on Hostinger.
set -euo pipefail
site_root=/var/www/yesspec
install -d -m 0700 /var/lib/yesspec-ops /root/yesspec-data-backups
install -m 0644 "$site_root/deploy/yesspec-maintenance.service" /etc/systemd/system/yesspec-maintenance.service
install -m 0644 "$site_root/deploy/yesspec-maintenance.timer" /etc/systemd/system/yesspec-maintenance.timer
printf '%s\n' '# Automatic GitHub polling disabled. Deploy an explicitly reviewed commit manually.' > /etc/cron.d/yesspec-sync
chmod 0644 /etc/cron.d/yesspec-sync
systemd-analyze verify /etc/systemd/system/yesspec-maintenance.service /etc/systemd/system/yesspec-maintenance.timer
systemctl daemon-reload
systemctl start yesspec-maintenance.service
systemctl enable --now yesspec-maintenance.timer
systemctl list-timers yesspec-maintenance.timer --no-pager
