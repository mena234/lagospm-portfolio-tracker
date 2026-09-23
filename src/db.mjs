import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './security.mjs';

export function utcNow() {
  return new Date().toISOString();
}

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  return db;
}

export function applyMigrations(db, migrationsDir) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
  const files = readdirSync(migrationsDir).filter((name) => extname(name) === '.sql').sort();
  const statement = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      statement.run(file, utcNow());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }
}

function insertUser(db, user, password, mustChangePassword = true) {
  const now = utcNow();
  return db.prepare(`
    INSERT INTO users (user_id, email, display_name, password_hash, role, must_change_password, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(user.userId, user.email, user.displayName, hashPassword(password), user.role, mustChangePassword ? 1 : 0, now, now);
}

export function seedDatabase(db, config) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    insertUser(db, { ...config.initialAdmin, role: 'Admin' }, config.initialAdmin.password, true);
    if (config.seedDemoData) {
      insertUser(db, { userId: 'amara.editor', email: 'editor@lagospm.local', displayName: 'Amara Okafor', role: 'Editor' }, config.demoPassword, true);
      insertUser(db, { userId: 'tunde.viewer', email: 'viewer@lagospm.local', displayName: 'Tunde Balogun', role: 'Viewer' }, config.demoPassword, true);
    }
  }

  if (!config.seedDemoData) return;
  const portfolioCount = db.prepare('SELECT COUNT(*) AS count FROM portfolios').get().count;
  if (portfolioCount > 0) return;

  const now = utcNow();
  const portfolios = [
    ['portfolio-development', 'DEV', 'Development Portfolio', 'Development projects from concept through delivery.'],
    ['portfolio-capital', 'CAP', 'Capital Works', 'Approved capital investments and refurbishment work.'],
  ];
  const portfolioInsert = db.prepare('INSERT INTO portfolios (id, code, name, description, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const portfolio of portfolios) portfolioInsert.run(...portfolio, now);

  const adminId = db.prepare("SELECT id FROM users WHERE role = 'Admin' ORDER BY id LIMIT 1").get().id;
  const projects = [
    ['DEV-001', 'Parks and Resorts Programme', 'Delivery', 'At risk', 'Lagos', 'Amara Okafor', 480000000, 318000000, 227500000, 502000000, 62, '2025-01-15', '2027-03-31', 'A multi-site parks and resorts programme. The narrative is deliberately long so import and display checks can verify that operational context, dependencies, stakeholder decisions, environmental approvals, phased procurement, public-realm interfaces, and outstanding commercial assumptions remain intact without truncation.', 'portfolio-development'],
    ['DEV-002', 'Marina Mixed Use Study', 'Feasibility', 'On track', 'Victoria Island', 'Chidi Eze', 85000000, 24000000, 18200000, 79300000, 28, '2026-02-01', '2026-12-15', 'Feasibility, planning, and commercial study for a mixed-use waterfront site.', 'portfolio-development'],
    ['DEV-003', 'Mainland Logistics Hub', 'Design', 'Watch', 'Ikeja', 'Amara Okafor', 210000000, 67000000, 41200000, 225000000, 41, '2025-09-12', '2027-01-30', 'Design coordination and approvals for a consolidated logistics hub.', 'portfolio-development'],
    ['CAP-014', 'Head Office Energy Upgrade', 'Construction', 'On track', 'Ikoyi', 'Bola Adebayo', 34000000, 31200000, 19600000, 33200000, 71, '2026-01-20', '2026-10-01', 'Mechanical, lighting, controls, and metering improvements.', 'portfolio-capital'],
    ['CAP-018', 'Coastal Site Drainage Works', 'Procurement', 'At risk', 'Lekki', 'Tunde Balogun', 52000000, 11000000, 5500000, 61000000, 22, '2026-03-08', '2026-11-28', 'Drainage capacity and resilience works ahead of the wet season.', 'portfolio-capital'],
    ['CAP-021', 'Guest Facilities Refurbishment', 'Closeout', 'On track', 'Badagry', 'Bola Adebayo', 28000000, 27600000, 26800000, 27900000, 96, '2025-08-01', '2026-09-30', 'Final snagging, documentation, and operational handover.', 'portfolio-capital'],
  ];
  const projectInsert = db.prepare(`
    INSERT INTO projects (
      id, portfolio_id, project_code, name, phase, status, location, project_manager,
      budget, committed_cost, actual_cost, forecast_cost, percent_complete,
      start_date, target_date, description, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const detailInsert = db.prepare(`
    INSERT INTO development_details (project_id, planning_status, design_status, procurement_status, construction_status, next_gate, narrative, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const riskInsert = db.prepare(`
    INSERT INTO risks (id, project_id, title, description, probability, impact, owner, mitigation, status, due_date, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateInsert = db.prepare(`
    INSERT INTO project_updates (id, project_id, title, body, previous_status, new_status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const costInsert = db.prepare(`
    INSERT INTO cost_entries (id, project_id, category, description, committed, actual, forecast, entry_date, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const project of projects) {
    const [code, name, phase, status, location, manager, budget, committed, actual, forecast, complete, start, target, description, portfolioId] = project;
    const id = randomUUID();
    projectInsert.run(id, portfolioId, code, name, phase, status, location, manager, budget, committed, actual, forecast, complete, start, target, description, adminId, adminId, now, now);
    detailInsert.run(id, phase === 'Feasibility' ? 'In review' : 'Approved', phase === 'Design' ? 'In progress' : 'Complete', phase === 'Procurement' ? 'Tendering' : 'Planned', phase === 'Construction' ? 'In progress' : 'Not started', 'Monthly portfolio review', description, adminId, now);
    costInsert.run(randomUUID(), id, 'Opening balance', 'Imported opening cost position.', committed, actual, forecast, start, adminId, now);
    updateInsert.run(randomUUID(), id, 'Project added to the tracker', `Initial record created for ${name}.`, null, status, adminId, now);
    if (status !== 'On track') {
      riskInsert.run(randomUUID(), id, status === 'At risk' ? 'Forecast exceeds approved budget' : 'Programme dependency requires monitoring', description, status === 'At risk' ? 4 : 3, status === 'At risk' ? 5 : 3, manager, 'Review mitigation and decision owners at the next portfolio meeting.', 'Open', target, adminId, adminId, now, now);
    }
  }
}

export function refreshProjectCostTotals(db, projectId, actorUserId) {
  const totals = db.prepare(`
    SELECT COALESCE(SUM(committed), 0) AS committed, COALESCE(SUM(actual), 0) AS actual, COALESCE(SUM(forecast), 0) AS forecast
    FROM cost_entries WHERE project_id = ?
  `).get(projectId);
  if (totals.committed === 0 && totals.actual === 0 && totals.forecast === 0) return totals;
  db.prepare(`UPDATE projects SET committed_cost = ?, actual_cost = ?, forecast_cost = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
    .run(totals.committed, totals.actual, totals.forecast, actorUserId, utcNow(), projectId);
  return totals;
}
