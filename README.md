# LagosPM Portfolio Tracker

Live demo: [https://project-tracker.ramzy.tech/](https://project-tracker.ramzy.tech/)


A dependency-light Node.js and SQLite portfolio tracker designed to run behind Nginx on a self-managed Ubuntu VPS.

## Included

- Portfolio dashboard, project register, development pipeline, cost control, risk register, activity history, CSV export, and in-app help.
- Viewer, Editor, and Admin roles with server-side authorization.
- Password strength enforcement, forced first-login change, CSRF protection, login throttling, expiring sessions, audit logs, and security headers.
- Versioned SQLite migrations and a transactional Cloudflare D1/SQLite import utility.
- Nginx, systemd, release, backup, restore, and rollback assets.

## Local start

Node.js 24 LTS is required.

```bash
npm ci
npm test
npm run db:migrate
npm run db:seed
npm start
```

The development seed creates `admin@lagospm.local`, `editor@lagospm.local`, and `viewer@lagospm.local`. Their temporary password is `ChangeMe!2026#`; every seeded account must change it at first sign-in. Never enable demo data in production.

Open `http://127.0.0.1:3210`. Configuration is documented in [.env.example](.env.example).

## Public Sites demonstration

`npm run build:site` creates the hosted Sites bundle in `dist/`. It contains the production interface, a Cloudflare Worker API, versioned D1 migrations, persistent shared sample data, real sessions, forced password changes, and server-enforced Viewer, Editor, and Admin permissions. Project, cost, risk, activity, user, audit, search, filter, and CSV-export journeys use the same request contract as the Node.js development application.

To run the hosted architecture locally, use `npm run dev:site` and open `http://127.0.0.1:8787`. The command builds the bundle, applies local D1 migrations, and starts the Worker preview. The demonstration accounts use the same identifiers and temporary password listed above; signing in with that shared password always opens the change-password form so the client can repeat the onboarding demonstration.

The public Site is a demonstration environment: its records are shared by visitors and must not contain real or confidential project information. The self-managed Node.js and SQLite deployment described below remains the production-target installation for private client data.

## Production and data migration

- [Ubuntu deployment](docs/DEPLOYMENT.md)
- [D1/SQLite migration](docs/DATA_MIGRATION.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Rollback](docs/ROLLBACK.md)
- [Security notes](docs/SECURITY.md)
- [API summary](docs/API.md)
- [Acceptance report](docs/ACCEPTANCE_TEST.md)

The supplied brief did not include the original Cloudflare source bundle or its D1 export. The application therefore includes representative development data and a deterministic import path; exact 74-record reconciliation must be run when those source assets are supplied.
