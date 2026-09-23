# Ubuntu deployment

## Target layout

- Application releases: `/opt/lagospm/releases/<UTC timestamp>`
- Active release symlink: `/opt/lagospm/current`
- Database: `/var/lib/lagospm/lagospm.sqlite`
- Secrets/configuration: `/etc/lagospm/lagospm.env`
- Service account: `lagospm` with no login shell
- Public traffic: Nginx HTTPS to `127.0.0.1:3210`

## Prerequisites

Use a supported Ubuntu LTS host with Node.js 24 LTS, npm, SQLite 3, Nginx, curl, and a valid TLS certificate for the deployment hostname. Permit inbound TCP 80/443 only; do not expose port 3210.

## First deployment

1. Copy this repository to a temporary location on the VPS.
2. Run `sudo deploy/scripts/install-release.sh /path/to/source`. The first run creates `/etc/lagospm/lagospm.env` and stops before service activation.
3. Edit that file as root. Set a unique 16+ character initial Admin password, the production origin, database path, and `SEED_DEMO_DATA=false`. Keep mode `0640`, owner `root`, and group `lagospm`.
4. Run the installer again. It runs the complete automated suite before switching the `current` symlink and verifies the loopback health endpoint.
5. Install `deploy/nginx/lagospm.conf` as `/etc/nginx/sites-available/lagospm`, create the `sites-enabled` symlink, run `sudo nginx -t`, and reload Nginx.
6. Visit the HTTPS URL, sign in as the initial Admin, and complete the forced password change. Then remove the bootstrap password value from `/etc/lagospm/lagospm.env` only after confirming the existing database is retained; the current build validates this variable at every production start, so replace it with a new vaulted random value rather than leaving it blank.

## Verification

```bash
sudo systemctl status lagospm.service --no-pager
sudo journalctl -u lagospm.service -n 100 --no-pager
curl --fail http://127.0.0.1:3210/healthz
curl --fail https://dnc.lagospm.com/api/meta
```

The detailed health route is loopback-only in production. `/api/meta` is intentionally public and discloses only the application name, version, and available roles.

## Updating

Copy the new release to the server and run the installer with a new release ID. Back up the database before any version that introduces migrations. Keep at least two previous release directories until the acceptance checks pass.
