import { loadConfig } from '../src/config.mjs';
import { applyMigrations, openDatabase } from '../src/db.mjs';

const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsDir);
  const versions = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
  console.log(JSON.stringify({ database: config.databasePath, migrations: versions }, null, 2));
} finally {
  db.close();
}

