# API summary

JSON endpoints return `{ "error": { "code", "message", "details" } }` on errors. Authenticated write requests require `X-CSRF-Token`.

| Area | Endpoints |
| --- | --- |
| Health | `GET /healthz`, `GET /api/health`, `GET /api/meta` |
| Authentication | `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`, `POST /api/auth/change-password` |
| Portfolio | `GET /api/dashboard`, `GET /api/portfolios` |
| Projects | `GET/POST /api/projects`, `GET/PATCH /api/projects/:id`, `POST /api/projects/:id/activity` |
| Development | `PUT /api/projects/:id/development` |
| Costs | `POST /api/projects/:id/costs` |
| Risks | `GET /api/risks`, `POST /api/projects/:id/risks`, `PATCH /api/risks/:id` |
| Export | `GET /api/export/projects.csv` |
| Administration | `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`, `GET /api/admin/audit` |

Project updates require the current numeric `version`; stale edits receive HTTP 409 so one user's work cannot silently overwrite another's.
