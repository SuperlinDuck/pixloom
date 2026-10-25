#!/bin/sh
set -eu
# Install root-owned at /usr/local/sbin/pixloom-deploy, not inside a release.
export PATH=/usr/local/bin:/usr/bin:/bin
[ "$(id -u)" = 0 ] || { echo '需要 root 或指定 sudo 部署权限' >&2; exit 1; }
[ -z "${DOCKER_HOST:-}" ] && [ "${DOCKER_CONTEXT:-default}" = default ] || { echo '自动部署要求本机 Docker 默认 context' >&2; exit 1; }
exec flock -w 600 -E 75 /run/lock/pixloom-maintenance.lock node /usr/local/libexec/pixloom/deploy.mjs "$@"
