#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this release installation step as root." >&2
  exit 1
fi

source_dir=${1:?Usage: install-release.sh SOURCE_DIRECTORY [RELEASE_ID]}
release_id=${2:-$(date -u +%Y%m%d%H%M%S)}
release_dir="/opt/lagospm/releases/${release_id}"

if [[ ! -f "${source_dir}/package-lock.json" || ! -f "${source_dir}/src/index.mjs" ]]; then
  echo "The source directory does not contain the LagosPM application." >&2
  exit 1
fi

node_major=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
if [[ ${node_major} -ne 24 ]]; then
  echo "Node.js 24 LTS is required; found $(node --version)." >&2
  exit 1
fi

getent group lagospm >/dev/null || groupadd --system lagospm
id lagospm >/dev/null 2>&1 || useradd --system --gid lagospm --home-dir /var/lib/lagospm --shell /usr/sbin/nologin lagospm

install -d -o root -g lagospm -m 0750 /opt/lagospm /opt/lagospm/releases
install -d -o lagospm -g lagospm -m 0750 /var/lib/lagospm
install -d -o root -g lagospm -m 0750 /etc/lagospm
install -d -o root -g lagospm -m 0750 "${release_dir}"

tar --exclude=.git --exclude=.env --exclude=data --exclude=node_modules -C "${source_dir}" -cf - . | tar -C "${release_dir}" -xf -
cd "${release_dir}"
npm ci --omit=dev --ignore-scripts
npm test
chown -R root:lagospm "${release_dir}"
chmod -R u=rwX,g=rX,o= "${release_dir}"

if [[ ! -f /etc/lagospm/lagospm.env ]]; then
  install -o root -g lagospm -m 0640 "${release_dir}/.env.example" /etc/lagospm/lagospm.env
  echo "Created /etc/lagospm/lagospm.env. Replace every placeholder before starting the service." >&2
  exit 2
fi

if grep -Eq '^INITIAL_ADMIN_PASSWORD=(replace-with-a-unique-strong-password)?$' /etc/lagospm/lagospm.env; then
  echo "Set a unique INITIAL_ADMIN_PASSWORD in /etc/lagospm/lagospm.env before starting the service." >&2
  exit 2
fi

ln -sfn "${release_dir}" /opt/lagospm/current
install -o root -g root -m 0644 "${release_dir}/deploy/systemd/lagospm.service" /etc/systemd/system/lagospm.service
systemctl daemon-reload
systemctl enable --now lagospm.service
curl --fail --silent --show-error http://127.0.0.1:3210/healthz >/dev/null

echo "Installed LagosPM release ${release_id}."
