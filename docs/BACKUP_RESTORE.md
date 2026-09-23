# Backup and restore

## Scheduled backup

Run `deploy/scripts/backup.sh` as the `lagospm` user or a restricted backup account. It uses SQLite's online backup operation, validates the copy, compresses it, and prints the final path.

Example root cron entry:

```cron
15 2 * * * DATABASE_PATH=/var/lib/lagospm/lagospm.sqlite BACKUP_DIR=/var/backups/lagospm /opt/lagospm/current/deploy/scripts/backup.sh
```

Copy encrypted backups off-host and enforce an agreed retention policy. A reasonable starting point is 14 daily, 8 weekly, and 12 monthly copies.

## Restore rehearsal

1. Choose a verified `.sqlite.gz` backup.
2. Announce maintenance and stop writes.
3. Run `sudo deploy/scripts/restore.sh /var/backups/lagospm/<backup>.sqlite.gz`.
4. Confirm the health endpoint, sign-in, counts, recent activity, and representative long narratives.
5. Retain `.before-restore` until the business owner approves the restored data.

The restore script verifies the candidate before stopping the service and keeps a recoverable copy of the replaced database.
