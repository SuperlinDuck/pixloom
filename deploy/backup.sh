#!/bin/sh
set -eu
# Cold backup: all three services write SQLite (including Cloud sessions in Gateway).
# Run as root via the supplied timer. Copy the resulting secret-bearing archive off-site.
if [ "$(id -u)" != 0 ]; then echo '需要 root 执行备份服务' >&2; exit 1; fi
umask 077
mkdir -p /srv/pixloom/backups
backup_file="/srv/pixloom/backups/pixloom-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
backup_tmp="${backup_file}.partial"
# Always restart all services if stopping or archiving fails.
trap 'systemctl start pixloom-web pixloom-worker pixloom-gateway' EXIT
systemctl stop pixloom-web pixloom-worker pixloom-gateway
if [ -e "$backup_file" ] || [ -e "$backup_tmp" ]; then echo '备份文件已存在' >&2; exit 1; fi
tar -czf "$backup_tmp" -C / srv/pixloom/data srv/pixloom/published etc/pixloom/pixloom.env
mv "$backup_tmp" "$backup_file"
echo "$backup_file"
