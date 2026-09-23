#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run rollback as root." >&2
  exit 1
fi

release_id=${1:?Usage: rollback-release.sh RELEASE_ID}
release_dir="/opt/lagospm/releases/${release_id}"

if [[ ! -f "${release_dir}/src/index.mjs" ]]; then
  echo "Release ${release_id} does not exist or is incomplete." >&2
  exit 1
fi

ln -sfn "${release_dir}" /opt/lagospm/current
systemctl restart lagospm.service
curl --fail --silent --show-error http://127.0.0.1:3210/healthz >/dev/null
echo "Rolled back to LagosPM release ${release_id}."
