#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run restore as root." >&2
  exit 1
fi

source_backup=${1:?Usage: restore.sh BACKUP.sqlite.gz}
database_path=${DATABASE_PATH:-/var/lib/lagospm/lagospm.sqlite}
work_dir=$(mktemp -d)
trap 'rm -rf -- "${work_dir}"' EXIT
candidate="${work_dir}/restore.sqlite"

gzip -cd -- "${source_backup}" > "${candidate}"
integrity=$(sqlite3 "${candidate}" "PRAGMA integrity_check;")
if [[ ${integrity} != "ok" ]]; then
  echo "Restore candidate integrity check failed: ${integrity}" >&2
  exit 1
fi

systemctl stop lagospm.service
if [[ -f ${database_path} ]]; then
  cp --preserve=mode,ownership,timestamps -- "${database_path}" "${database_path}.before-restore"
fi
install -o lagospm -g lagospm -m 0640 "${candidate}" "${database_path}"
rm -f -- "${database_path}-wal" "${database_path}-shm"
systemctl start lagospm.service
curl --fail --silent --show-error http://127.0.0.1:3210/healthz >/dev/null
echo "Restore completed. The prior database is ${database_path}.before-restore."
