#!/usr/bin/env bash
set -euo pipefail
# Runs on the Actions runner. No server model/Google/Cloud credentials leave the VPS.
[[ ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 1; }
[[ ${RELEASE_RUN:-} =~ ^[0-9]+-[0-9]+$ ]] || { echo 'Invalid release run' >&2; exit 1; }
[[ ${VPS_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Invalid VPS user' >&2; exit 1; }
[[ ${VPS_HOST:-} =~ ^[a-zA-Z0-9_.:-]+$ ]] || { echo 'Invalid VPS host' >&2; exit 1; }
VPS_SSH_PORT=${VPS_SSH_PORT:-22}
[[ $VPS_SSH_PORT =~ ^[0-9]+$ ]] && (( VPS_SSH_PORT > 0 && VPS_SSH_PORT < 65536 )) || { echo 'Invalid SSH port' >&2; exit 1; }
[[ $(git rev-parse HEAD) == "$RELEASE_SHA" ]] || { echo 'Checkout does not match checked SHA' >&2; exit 1; }
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
umask 077
git archive --format=tar "$RELEASE_SHA" > "$archive"
digest=$(sha256sum "$archive")
digest=${digest%% *}
upload_name="${RELEASE_SHA}-${RELEASE_RUN}.tar"
ssh_options=(-T -i "$HOME/.ssh/pixloom_actions" -p "${VPS_SSH_PORT:-22}" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
target="${VPS_USER}@${VPS_HOST}"
ssh "${ssh_options[@]}" "$target" "umask 077; cat > /srv/pixloom/incoming/${upload_name}" < "$archive"
remote_command=/usr/local/sbin/pixloom-deploy
if [[ $VPS_USER != root ]]; then remote_command="sudo -n $remote_command"; fi
# All interpolated arguments have been restricted to hex/digits above.
ssh "${ssh_options[@]}" "$target" "$remote_command $RELEASE_SHA $upload_name $digest"
