# Acceptance report

## Automated suite

| Requirement | Result | Evidence |
| --- | --- | --- |
| Health and static delivery | Pass | Health response, application shell, CSP and security headers tested |
| Login and forced first password change | Pass | Temporary credentials are denied API access until password change |
| CSRF and session security | Pass | Missing CSRF is rejected; valid session flow succeeds |
| Viewer/Editor/Admin authorization | Pass | Viewer write attempt receives HTTP 403; Editor and Admin paths exercised |
| Projects, costs, risks, activity, CSV | Pass | Full create/read/update flow and export content tested |
| Concurrent edit protection | Pass | Stale project version receives HTTP 409 |
| Login throttling | Pass | Repeated failed attempts receive HTTP 429 |
| Auditability | Pass | Project and administrative actions appear in Admin audit data |
| Long narrative preservation | Pass | Parks and Resorts development narrative is returned without truncation |

Run with `npm test`. The suite creates isolated temporary databases and does not modify production data.

## Browser review

The interface is reviewed at 1920 × 1200 and a 320-pixel phone width for navigation, dialog usability, readable cards/tables, keyboard focus, and unintended page overflow. Re-run these checks on the target VPS in current Microsoft Edge after Nginx/TLS installation.

## Open source-parity gate

The original Cloudflare Worker source, D1 export, and the stated 74 source records were not present in the supplied materials. Exact visual parity, route-by-route behavior comparison, and 74-record reconciliation cannot be truthfully marked complete until those inputs are supplied. The importer and reconciliation procedure are ready for that gate.
