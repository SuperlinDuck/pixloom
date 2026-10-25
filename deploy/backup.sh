#!/bin/sh
set -eu
# Cold backup: all three services write SQLite (including Cloud sessions in Gateway).
if [ "$(id -u)" != 0 ]; then echo '需要 root 执行备份服务' >&2; exit 1; fi
umask 077
exec 9>/run/lock/pixloom-maintenance.lock
if ! flock -n 9; then echo 'Pixloom 部署进行中，本次定时备份跳过'; exit 0; fi
maintenance=/var/lib/pixloom/maintenance
if [ -e "$maintenance" ]; then echo 'Pixloom 已在维护中，保留现场，本次备份跳过'; exit 0; fi
mkdir -p /srv/pixloom/backups /var/lib/pixloom
chmod 755 /var/lib/pixloom
backup_file="/srv/pixloom/backups/pixloom-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
backup_tmp="${backup_file}.partial"
if [ -e "$backup_file" ] || [ -e "$backup_tmp" ]; then echo '备份文件已存在' >&2; exit 1; fi
restore_services() {
  if systemctl start pixloom-web pixloom-worker pixloom-gateway &&
    curl --fail --silent --show-error --retry 30 --retry-all-errors --retry-delay 1 --max-time 3 http://127.0.0.1:3000/api/health >/dev/null &&
    curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 3 http://127.0.0.1:4180/_pixloom/health >/dev/null; then
    rm -f "$maintenance"
  else
    echo '备份后服务未恢复，维护状态保留，请检查日志' >&2
    exit 1
  fi
}
printf '%s\n' 'Pixloom backup in progress' > "$maintenance"
chmod 644 "$maintenance"
trap restore_services EXIT
systemctl stop pixloom-web pixloom-worker pixloom-gateway
tar -czf "$backup_tmp" -C / srv/pixloom/data srv/pixloom/published etc/pixloom/pixloom.env
mv "$backup_tmp" "$backup_file"
echo "$backup_file"
