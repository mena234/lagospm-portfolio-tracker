import { loadConfig } from '../src/config.mjs';
import { applyMigrations, openDatabase, seedDatabase } from '../src/db.mjs';

const config = loadConfig({ seedDemoData: true });
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsDir);
  seedDatabase(db, config);
  console.log(JSON.stringify({
    database: config.databasePath,
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    portfolios: db.prepare('SELECT COUNT(*) AS count FROM portfolios').get().count,
    projects: db.prepare('SELECT COUNT(*) AS count FROM projects').get().count,
  }, null, 2));
} finally {
  db.close();
}

