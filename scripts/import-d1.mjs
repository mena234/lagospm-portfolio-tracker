import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, openDatabase, utcNow } from '../src/db.mjs';

const TABLE_ORDER = ['portfolios', 'users', 'projects', 'development_details', 'project_updates', 'cost_entries', 'risks', 'audit_logs'];

function parseArguments(argv) {
  const options = { dryRun: false, replace: false, mapping: null };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--source') options.source = argv[++index];
    else if (item === '--target') options.target = argv[++index];
    else if (item === '--migrations') options.migrations = argv[++index];
    else if (item === '--mapping') options.mapping = argv[++index];
    else if (item === '--dry-run') options.dryRun = true;
    else if (item === '--replace') options.replace = true;
    else if (item === '--help') options.help = true;
    else throw new Error(`Unknown option: ${item}`);
  }
  return options;
}

function usage() {
  console.log(`Usage:
  node scripts/import-d1.mjs --source d1-export.sql --target /var/lib/lagospm/lagospm.sqlite [options]

Options:
  --mapping mapping.json  Map source tables and columns to the LagosPM schema
  --dry-run               Validate and reconcile, then roll back
  --replace               Replace rows with matching primary keys
  --migrations PATH       Override db/migrations

Create the SQL source with: wrangler d1 export DATABASE --remote --output d1-export.sql`);
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name));
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((row) => row.name);
}

function loadSqlSource(path) {
  const source = new DatabaseSync(':memory:');
  source.exec('PRAGMA foreign_keys = OFF');
  const sql = readFileSync(path, 'utf8')
    .replace(/^\s*BEGIN\s+TRANSACTION\s*;?/gim, '')
    .replace(/^\s*COMMIT\s*;?/gim, '');
  source.exec(sql);
  return source;
}

function defaultMapping(sourceTables) {
  const tables = {};
  for (const table of TABLE_ORDER) {
    if (sourceTables.has(table)) tables[table] = { target: table, columns: {} };
  }
  return { tables };
}

function loadMapping(path, sourceTables) {
  if (!path) return defaultMapping(sourceTables);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed.tables || typeof parsed.tables !== 'object') throw new Error('The mapping file must contain a tables object.');
  return parsed;
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count;
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}
if (!options.source || !options.target) {
  usage();
  process.exit(2);
}

const sourcePath = resolve(options.source);
const targetPath = resolve(options.target);
const migrationsDir = resolve(options.migrations ?? 'db/migrations');
if (!existsSync(sourcePath)) throw new Error(`Source not found: ${sourcePath}`);
if (sourcePath === targetPath) throw new Error('Source and target must be different files.');
mkdirSync(dirname(targetPath), { recursive: true });

const extension = extname(sourcePath).toLowerCase();
const source = extension === '.sql' ? loadSqlSource(sourcePath) : new DatabaseSync(sourcePath, { readOnly: true });
const targetExisted = existsSync(targetPath);
const target = openDatabase(targetPath);
let backupPath = null;

try {
  applyMigrations(target, migrationsDir);
  target.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  if (targetExisted && !options.dryRun) {
    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
    backupPath = `${targetPath}.pre-import-${stamp}.bak`;
    copyFileSync(targetPath, backupPath);
  }

  const sourceTables = tableNames(source);
  const targetTables = tableNames(target);
  const mapping = loadMapping(options.mapping ? resolve(options.mapping) : null, sourceTables);
  const report = { source: basename(sourcePath), target: targetPath, dryRun: options.dryRun, replace: options.replace, backup: backupPath, tables: {}, warnings: [] };
  target.exec('BEGIN IMMEDIATE');
  try {
    for (const sourceTable of TABLE_ORDER.flatMap((targetName) => Object.entries(mapping.tables).filter(([, spec]) => spec.target === targetName).map(([name]) => name))) {
      const spec = mapping.tables[sourceTable];
      const targetTable = spec.target;
      if (!sourceTables.has(sourceTable)) throw new Error(`Mapped source table not found: ${sourceTable}`);
      if (!targetTables.has(targetTable) || !TABLE_ORDER.includes(targetTable)) throw new Error(`Mapped target table is not importable: ${targetTable}`);
      const sourceColumns = columns(source, sourceTable);
      const targetColumns = new Set(columns(target, targetTable));
      const columnPairs = sourceColumns
        .map((sourceColumn) => [sourceColumn, spec.columns?.[sourceColumn] ?? sourceColumn])
        .filter(([, targetColumn]) => targetColumns.has(targetColumn));
      if (!columnPairs.length) throw new Error(`No compatible columns were found for ${sourceTable} -> ${targetTable}.`);
      const rows = source.prepare(`SELECT * FROM ${quoteIdentifier(sourceTable)}`).all();
      const before = countRows(target, targetTable);
      const verb = options.replace ? 'INSERT OR REPLACE' : 'INSERT';
      const sql = `${verb} INTO ${quoteIdentifier(targetTable)} (${columnPairs.map(([, column]) => quoteIdentifier(column)).join(', ')}) VALUES (${columnPairs.map(() => '?').join(', ')})`;
      const insert = target.prepare(sql);
      let imported = 0;
      for (const row of rows) {
        insert.run(...columnPairs.map(([sourceColumn]) => row[sourceColumn]));
        imported += 1;
      }
      const after = countRows(target, targetTable);
      report.tables[targetTable] = { sourceTable, sourceCount: rows.length, targetBefore: before, targetAfter: after, imported };
    }

    if (!Object.keys(report.tables).length) throw new Error('No supported source tables were found. Supply a mapping file for differently named tables.');
    const foreignKeys = target.prepare('PRAGMA foreign_key_check').all();
    const integrity = target.prepare('PRAGMA integrity_check').get().integrity_check;
    if (foreignKeys.length) throw new Error(`Foreign-key validation found ${foreignKeys.length} violation(s).`);
    if (integrity !== 'ok') throw new Error(`SQLite integrity check returned: ${integrity}`);
    const incompatiblePasswords = targetTables.has('users') ? target.prepare("SELECT COUNT(*) AS count FROM users WHERE password_hash NOT LIKE 'pbkdf2_sha256$%'").get().count : 0;
    if (incompatiblePasswords) report.warnings.push(`${incompatiblePasswords} user password hash(es) need an administrator-issued temporary password.`);
    target.prepare(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, details_json, created_at) VALUES (NULL, ?, 'database', NULL, 'local-import', ?, ?)`)
      .run(options.dryRun ? 'migration.dry_run' : 'migration.completed', JSON.stringify({ source: basename(sourcePath), tables: report.tables }), utcNow());
    if (options.dryRun) target.exec('ROLLBACK'); else target.exec('COMMIT');
    report.integrity = integrity;
    report.foreignKeyViolations = 0;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    target.exec('ROLLBACK');
    throw error;
  }
} catch (error) {
  if (backupPath && existsSync(backupPath) && !targetExisted) unlinkSync(backupPath);
  throw error;
} finally {
  source.close();
  target.close();
}

