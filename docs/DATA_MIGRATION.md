# Cloudflare D1 and SQLite migration

The importer accepts either a D1 SQL export or an SQLite database. Imports are transactional, create a pre-import target backup, reject foreign-key/integrity failures, and print source-to-target counts.

## Export D1

```bash
npx wrangler d1 export YOUR_DATABASE --remote --output source-d1.sql
```

## Dry run

```bash
npm run import:d1 -- --source ./source-d1.sql --target ./data/import-test.sqlite --mapping ./docs/d1-mapping.example.json --dry-run
```

## Import

```bash
npm run import:d1 -- --source ./source-d1.sql --target ./data/lagospm.sqlite --mapping ./docs/d1-mapping.example.json
```

Edit the mapping file only when source table or column names differ. Run the importer first against a disposable target, review every count, then open projects with long narratives (especially Parks and Resorts) to confirm text was not truncated. Existing password hashes are imported only if compatible with this application's `pbkdf2_sha256` format; otherwise reset those accounts through Admin.

The original source database was not included with the brief, so the expected 74-record parity check remains a deployment gate. Do not replace production until the importer reports 74 projects on both sides and `PRAGMA integrity_check` returns `ok`.
