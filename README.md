# LagosPM Portfolio Tracker

A project portfolio dashboard for tracking development pipelines, budgets, risks, and team activity. LagosPM brings portfolio-wide reporting and individual project records into one workspace.

**[Open the live demo](https://project-tracker.ramzy.tech/)** · [Developer guide](DEVELOPMENT.md)

## What you can explore

- Portfolio dashboard, project register, development pipeline, and cost control.
- Risk tracking, activity history, search, filters, and CSV exports.
- Viewer, Editor, and Admin roles with server-enforced permissions.
- A local Node.js/SQLite application and a Cloudflare Worker/D1 demo implementation.

## Try the demo

1. Open the live demo and sign in with a sample account listed below.
2. Complete the required password-change step, then explore the dashboard and project register.
3. Inspect project costs and risks or try a CSV export. The public demo uses shared sample records.

## Technology

JavaScript, Node.js, SQLite, HTML/CSS, and Cloudflare Workers/D1. Deployment resources for Nginx and systemd are included.

## Run locally

Use Node.js 24 and npm. The following starts the local development database and sample accounts:

```sh
git clone https://github.com/mena234/lagospm-portfolio-tracker.git
cd lagospm-portfolio-tracker
npm ci
npm run db:migrate
npm run db:seed
npm start
```

Open **http://127.0.0.1:3210/**. Sample accounts are `admin@lagospm.local`, `editor@lagospm.local`, and `viewer@lagospm.local`; their initial demo password is `ChangeMe!2026#`. Sign-in requires changing it. These credentials are for sample environments only.

For the Worker/D1 version, run `npm run dev:site` and open **http://127.0.0.1:8787/**. Production settings are documented in [.env.example](.env.example); production requires a separately supplied administrator password.

## Checks

```sh
npm test
npm run build:site
```

## Scope and limitations

The public demo shares records between visitors and is unsuitable for confidential project information. The included data is representative sample data. Migration tooling is provided, but importing and reconciling a real project portfolio requires its source export.

## More detail

See the [developer guide](DEVELOPMENT.md), [Ubuntu deployment guide](docs/DEPLOYMENT.md), [migration guide](docs/DATA_MIGRATION.md), and [API reference](docs/API.md).
