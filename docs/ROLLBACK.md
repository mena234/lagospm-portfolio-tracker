# Rollback

Application releases are immutable directories selected through `/opt/lagospm/current`.

1. Identify the last accepted release under `/opt/lagospm/releases`.
2. If the failed release changed the database schema incompatibly, restore the matching pre-deployment backup first.
3. Run `sudo deploy/scripts/rollback-release.sh RELEASE_ID`.
4. Verify loopback health, HTTPS sign-in, project counts, write access by role, CSV export, and audit logging.

Never roll back the application across a destructive schema migration without the matching database rollback. The migrations in this release are additive.
