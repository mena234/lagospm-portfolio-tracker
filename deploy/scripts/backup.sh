#!/usr/bin/env bash
set -Eeuo pipefail

database_path=${DATABASE_PATH:-/var/lib/lagospm/lagospm.sqlite}
backup_dir=${BACKUP_DIR:-/var/backups/lagospm}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="${backup_dir}/lagospm-${stamp}.sqlite"

install -d -m 0750 "${backup_dir}"
sqlite3 "${database_path}" ".timeout 5000" ".backup '${backup_path}'"
integrity=$(sqlite3 "${backup_path}" "PRAGMA integrity_check;")
if [[ ${integrity} != "ok" ]]; then
  echo "Backup integrity check failed: ${integrity}" >&2
  exit 1
fi

chmod 0640 "${backup_path}"
gzip -9 "${backup_path}"
echo "${backup_path}.gz"
