const COOKIE_NAME = 'lagospm_session';
const MAX_BODY_BYTES = 1_048_576;
const SESSION_TTL_HOURS = 8;
const ROLES = new Set(['Viewer', 'Editor', 'Admin']);
const PROJECT_STATUSES = new Set(['On track', 'Watch', 'At risk', 'On hold', 'Complete']);
const PHASES = new Set(['Concept', 'Feasibility', 'Design', 'Procurement', 'Construction', 'Delivery', 'Closeout']);
const DEMO_PASSWORD = 'ChangeMe!2026#';
const DEMO_HASHES = {
  'tom.admin': 'pbkdf2_sha256$100000$tNoWal6apqDiMxqu6CFiEQ$n9-_vVyKJr7L6RqIL8X0hhVAJGBLpMISByxh7HWgvgg',
  'amara.editor': 'pbkdf2_sha256$100000$Op0b2j3HHPpTGK1WAfujZw$w2gIFOxsYi59QQ5uD7Dd1Cic5SBI-ahDBEUQXN5Lo5I',
  'tunde.viewer': 'pbkdf2_sha256$100000$-FiN3jZZNgg_-MpK7QuDXA$ISdhFIrxQaWTGNTSbIQqrONwT3iCwLio5TwHYnW_MdY',
};

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function securityHeaders(headers = new Headers()) {
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return headers;
}

function json(status, payload, extraHeaders = {}) {
  const headers = securityHeaders(new Headers(extraHeaders));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(payload), { status, headers });
}

function noContent(extraHeaders = {}) {
  const headers = securityHeaders(new Headers(extraHeaders));
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 204, headers });
}

function errorResponse(error) {
  if (!(error instanceof HttpError)) console.error(error);
  const status = error instanceof HttpError ? error.status : 500;
  const payload = { error: { code: error instanceof HttpError ? error.code : 'INTERNAL_ERROR', message: error instanceof HttpError ? error.message : 'The server could not complete the request.' } };
  if (error instanceof HttpError && error.details) payload.error.details = error.details;
  return json(status, payload);
}

function assetResponse(response) {
  const headers = securityHeaders(new Headers(response.headers));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function prepared(db, sql, values = []) { return db.prepare(sql).bind(...values); }
async function first(db, sql, values = []) { return prepared(db, sql, values).first(); }
async function all(db, sql, values = []) { return (await prepared(db, sql, values).all()).results ?? []; }
async function run(db, sql, values = []) { return prepared(db, sql, values).run(); }

function utcNow() { return new Date().toISOString(); }
function randomId() { return crypto.randomUUID(); }
function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function fromBase64Url(value) {
  const base64 = String(value).replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(String(value).length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function randomToken(bytes = 32) { return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes))); }
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function secureEqual(left, right) {
  const a = new TextEncoder().encode(String(left ?? ''));
  const b = new TextEncoder().encode(String(right ?? ''));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
async function derivePassword(password, salt, iterations, bytes) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bytes * 8);
  return new Uint8Array(bits);
}
async function hashPassword(password, iterations = 100_000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, iterations, 32);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}
async function verifyPassword(password, encoded) {
  try {
    const [algorithm, iterationsText, saltText, hashText] = String(encoded).split('$');
    const iterations = Number.parseInt(iterationsText, 10);
    if (algorithm !== 'pbkdf2_sha256' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
    const expected = fromBase64Url(hashText);
    const actual = await derivePassword(password, fromBase64Url(saltText), iterations, expected.length);
    if (expected.length !== actual.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
    return difference === 0;
  } catch {
    return false;
  }
}
function generateTemporaryPassword() { return `Temp!${randomToken(12)}9a`; }

function passwordProblems(password, context = {}) {
  const value = String(password ?? '');
  const lower = value.toLowerCase();
  const identifiers = [context.email, context.userId, context.displayName]
    .filter(Boolean)
    .flatMap((item) => String(item).toLowerCase().split(/[^a-z0-9]+/u))
    .filter((item) => item.length >= 4);
  const problems = [];
  if (value.length < 12) problems.push('Use at least 12 characters.');
  if (value.length > 128) problems.push('Use no more than 128 characters.');
  if (!/[a-z]/u.test(value)) problems.push('Add a lowercase letter.');
  if (!/[A-Z]/u.test(value)) problems.push('Add an uppercase letter.');
  if (!/[0-9]/u.test(value)) problems.push('Add a number.');
  if (!/[^A-Za-z0-9\s]/u.test(value)) problems.push('Add a symbol.');
  if (/\s/u.test(value)) problems.push('Remove spaces.');
  if (/(.)\1{3}/u.test(value)) problems.push('Avoid repeating the same character four times.');
  if (identifiers.some((item) => lower.includes(item))) problems.push('Do not include your name, email, or user ID.');
  return [...new Set(problems)];
}

function nonEmptyText(value, label, maxLength = 250) {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(400, 'VALIDATION_FAILED', `${label} is required.`);
  if (text.length > maxLength) throw new HttpError(400, 'VALIDATION_FAILED', `${label} must be ${maxLength} characters or fewer.`);
  return text;
}
function optionalText(value, maxLength = 10_000) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw new HttpError(400, 'VALIDATION_FAILED', `Text must be ${maxLength} characters or fewer.`);
  return text;
}
function numberValue(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < min || number > max) throw new HttpError(400, 'VALIDATION_FAILED', `${label} must be between ${min} and ${max}.`);
  return number;
}
function dateValue(value, label, required = false) {
  const text = String(value ?? '').trim();
  if (!text && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new HttpError(400, 'VALIDATION_FAILED', `${label} must use YYYY-MM-DD format.`);
  return text;
}
function projectPayload(body, { partial = false } = {}) {
  const allowed = ['portfolio_id', 'project_code', 'name', 'phase', 'status', 'location', 'project_manager', 'budget', 'percent_complete', 'start_date', 'target_date', 'description'];
  const result = {};
  for (const key of allowed) if (Object.hasOwn(body, key)) result[key] = body[key];
  if (!partial) {
    result.portfolio_id = nonEmptyText(result.portfolio_id, 'Portfolio', 100);
    result.project_code = nonEmptyText(result.project_code, 'Project code', 40);
    result.name = nonEmptyText(result.name, 'Project name', 180);
  }
  if (Object.hasOwn(result, 'portfolio_id')) result.portfolio_id = nonEmptyText(result.portfolio_id, 'Portfolio', 100);
  if (Object.hasOwn(result, 'project_code')) result.project_code = nonEmptyText(result.project_code, 'Project code', 40);
  if (Object.hasOwn(result, 'name')) result.name = nonEmptyText(result.name, 'Project name', 180);
  if (Object.hasOwn(result, 'phase')) {
    result.phase = nonEmptyText(result.phase, 'Phase', 40);
    if (!PHASES.has(result.phase)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a recognised project phase.');
  }
  if (Object.hasOwn(result, 'status')) {
    result.status = nonEmptyText(result.status, 'Status', 40);
    if (!PROJECT_STATUSES.has(result.status)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a recognised project status.');
  }
  if (Object.hasOwn(result, 'location')) result.location = optionalText(result.location, 120);
  if (Object.hasOwn(result, 'project_manager')) result.project_manager = optionalText(result.project_manager, 120);
  if (Object.hasOwn(result, 'budget')) result.budget = numberValue(result.budget, 'Budget');
  if (Object.hasOwn(result, 'percent_complete')) result.percent_complete = numberValue(result.percent_complete, 'Percent complete', { min: 0, max: 100 });
  if (Object.hasOwn(result, 'start_date')) result.start_date = dateValue(result.start_date, 'Start date');
  if (Object.hasOwn(result, 'target_date')) result.target_date = dateValue(result.target_date, 'Target date');
  if (Object.hasOwn(result, 'description')) result.description = optionalText(result.description, 20_000);
  return result;
}

async function readJson(request) {
  if (!String(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send this request as application/json.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'The request body exceeds 1 MB.');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'INVALID_JSON', 'The request body is not valid JSON.'); }
}
function cookies(request) {
  const result = {};
  for (const part of String(request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key) result[key] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return result;
}
function sessionCookie(value, maxAgeSeconds) { return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${maxAgeSeconds}`; }
function clientIp(request) { return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 80); }
function enforceOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'ORIGIN_INVALID', 'This request came from an untrusted origin.');
}
function requireCsrf(request, session) {
  if (!secureEqual(request.headers.get('x-csrf-token'), session.csrfToken)) throw new HttpError(403, 'CSRF_INVALID', 'Your security token is missing or expired. Refresh the page and try again.');
}
function ensureRole(user, allowed) { if (!allowed.includes(user.role)) throw new HttpError(403, 'FORBIDDEN', 'Your role does not allow this action.'); }
function ensurePasswordChanged(session) { if (session.passwordChangeRequired) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before using the tracker.'); }
function publicUser(row, mustChangePassword = Boolean(row.must_change_password)) {
  return { id: row.id, userId: row.user_id, email: row.email, displayName: row.display_name, role: row.role, mustChangePassword, active: Boolean(row.active) };
}
function auditStatement(db, { actorUserId = null, action, entityType, entityId = null, ip = '', details = {} }) {
  return prepared(db, 'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [actorUserId, action, entityType, entityId, ip, JSON.stringify(details), utcNow()]);
}

async function ensureSeeded(db) {
  const existing = await first(db, 'SELECT COUNT(*) AS count FROM users');
  if (Number(existing?.count) > 0) return;
  const seededAt = '2026-09-04T09:00:00.000Z';
  const statements = [
    prepared(db, 'INSERT OR IGNORE INTO users (id, user_id, email, display_name, password_hash, role, must_change_password, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)', [1, 'tom.admin', 'admin@lagospm.local', 'Tom Administrator', DEMO_HASHES['tom.admin'], 'Admin', seededAt, seededAt]),
    prepared(db, 'INSERT OR IGNORE INTO users (id, user_id, email, display_name, password_hash, role, must_change_password, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)', [2, 'amara.editor', 'editor@lagospm.local', 'Amara Okafor', DEMO_HASHES['amara.editor'], 'Editor', seededAt, seededAt]),
    prepared(db, 'INSERT OR IGNORE INTO users (id, user_id, email, display_name, password_hash, role, must_change_password, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)', [3, 'tunde.viewer', 'viewer@lagospm.local', 'Tunde Balogun', DEMO_HASHES['tunde.viewer'], 'Viewer', seededAt, seededAt]),
    prepared(db, 'INSERT OR IGNORE INTO portfolios (id, code, name, description, created_at) VALUES (?, ?, ?, ?, ?)', ['portfolio-development', 'DEV', 'Development Portfolio', 'Development projects from concept through delivery.', seededAt]),
    prepared(db, 'INSERT OR IGNORE INTO portfolios (id, code, name, description, created_at) VALUES (?, ?, ?, ?, ?)', ['portfolio-capital', 'CAP', 'Capital Works', 'Approved capital investments and refurbishment work.', seededAt]),
  ];
  const projects = [
    ['project-dev-001', 'portfolio-development', 'DEV-001', 'Parks and Resorts Programme', 'Delivery', 'At risk', 'Lagos', 'Amara Okafor', 480000000, 318000000, 227500000, 502000000, 62, '2025-01-15', '2027-03-31', 'A multi-site parks and resorts programme. The narrative records operational context, dependencies, stakeholder decisions, environmental approvals, phased procurement, public-realm interfaces, and outstanding commercial assumptions.'],
    ['project-dev-002', 'portfolio-development', 'DEV-002', 'Marina Mixed Use Study', 'Feasibility', 'On track', 'Victoria Island', 'Chidi Eze', 85000000, 24000000, 18200000, 79300000, 28, '2026-02-01', '2026-12-15', 'Feasibility, planning, and commercial study for a mixed-use waterfront site.'],
    ['project-dev-003', 'portfolio-development', 'DEV-003', 'Mainland Logistics Hub', 'Design', 'Watch', 'Ikeja', 'Amara Okafor', 210000000, 67000000, 41200000, 225000000, 41, '2025-09-12', '2027-01-30', 'Design coordination and approvals for a consolidated logistics hub.'],
    ['project-cap-014', 'portfolio-capital', 'CAP-014', 'Head Office Energy Upgrade', 'Construction', 'On track', 'Ikoyi', 'Bola Adebayo', 34000000, 31200000, 19600000, 33200000, 71, '2026-01-20', '2026-10-01', 'Mechanical, lighting, controls, and metering improvements.'],
    ['project-cap-018', 'portfolio-capital', 'CAP-018', 'Coastal Site Drainage Works', 'Procurement', 'At risk', 'Lekki', 'Tunde Balogun', 52000000, 11000000, 5500000, 61000000, 22, '2026-03-08', '2026-11-28', 'Drainage capacity and resilience works ahead of the wet season.'],
    ['project-cap-021', 'portfolio-capital', 'CAP-021', 'Guest Facilities Refurbishment', 'Closeout', 'On track', 'Badagry', 'Bola Adebayo', 28000000, 27600000, 26800000, 27900000, 96, '2025-08-01', '2026-09-30', 'Final snagging, documentation, and operational handover.'],
  ];
  for (const project of projects) {
    const [id, portfolioId, code, name, phase, status, location, manager, budget, committed, actual, forecast, complete, start, target, description] = project;
    statements.push(prepared(db, 'INSERT OR IGNORE INTO projects (id, portfolio_id, project_code, name, phase, status, location, project_manager, budget, committed_cost, actual_cost, forecast_cost, percent_complete, start_date, target_date, description, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)', [id, portfolioId, code, name, phase, status, location, manager, budget, committed, actual, forecast, complete, start, target, description, seededAt, seededAt]));
    statements.push(prepared(db, 'INSERT OR IGNORE INTO development_details (project_id, planning_status, design_status, procurement_status, construction_status, next_gate, narrative, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, phase === 'Feasibility' ? 'In review' : 'Approved', phase === 'Design' ? 'In progress' : 'Complete', phase === 'Procurement' ? 'Tendering' : 'Planned', phase === 'Construction' ? 'In progress' : 'Not started', 'Monthly portfolio review', description, seededAt]));
    statements.push(prepared(db, 'INSERT OR IGNORE INTO cost_entries (id, project_id, category, description, committed, actual, forecast, entry_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [`cost-${id}`, id, 'Opening balance', 'Imported opening cost position.', committed, actual, forecast, start, seededAt]));
    statements.push(prepared(db, 'INSERT OR IGNORE INTO project_updates (id, project_id, title, body, previous_status, new_status, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)', [`activity-${id}`, id, 'Project added to the tracker', `Initial record created for ${name}.`, status, seededAt]));
  }
  statements.push(prepared(db, 'INSERT OR IGNORE INTO risks (id, project_id, title, description, probability, impact, owner, mitigation, status, due_date, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)', ['risk-dev-001', 'project-dev-001', 'Forecast exceeds approved budget', 'Inflation and interface scope are increasing the current delivery forecast.', 4, 5, 'Amara Okafor', 'Review scope packages and agree recovery actions at the next portfolio meeting.', 'Open', '2026-09-18', seededAt, seededAt]));
  statements.push(prepared(db, 'INSERT OR IGNORE INTO risks (id, project_id, title, description, probability, impact, owner, mitigation, status, due_date, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)', ['risk-dev-003', 'project-dev-003', 'Programme dependency requires monitoring', 'Utility coordination may affect the design freeze milestone.', 3, 3, 'Amara Okafor', 'Maintain a weekly interface schedule with named decision owners.', 'Monitoring', '2026-09-25', seededAt, seededAt]));
  statements.push(prepared(db, 'INSERT OR IGNORE INTO risks (id, project_id, title, description, probability, impact, owner, mitigation, status, due_date, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)', ['risk-cap-018', 'project-cap-018', 'Forecast exceeds approved budget', 'Tender returns include a premium for accelerated wet-season mobilisation.', 4, 5, 'Tunde Balogun', 'Complete value engineering and confirm the funding decision.', 'Open', '2026-09-11', seededAt, seededAt]));
  await db.batch(statements);
}

async function getSession(db, request) {
  const rawToken = cookies(request)[COOKIE_NAME];
  if (!rawToken) return null;
  const idHash = await sha256(rawToken);
  const row = await first(db, `SELECT s.id_hash, s.csrf_token, s.expires_at, s.password_change_required, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`, [idHash]);
  if (!row || !row.active || row.expires_at <= utcNow()) {
    if (row) await run(db, 'DELETE FROM sessions WHERE id_hash = ?', [idHash]);
    return null;
  }
  await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', [utcNow(), idHash]);
  return { idHash, csrfToken: row.csrf_token, passwordChangeRequired: Boolean(row.password_change_required), user: row };
}
async function requireSession(db, request) {
  const session = await getSession(db, request);
  if (!session) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  return session;
}
async function findProject(db, id) {
  const project = await first(db, `SELECT p.*, f.code AS portfolio_code, f.name AS portfolio_name, ROUND(p.forecast_cost - p.budget, 2) AS forecast_variance, (SELECT COUNT(*) FROM risks r WHERE r.project_id = p.id AND r.status != 'Closed') AS open_risks FROM projects p JOIN portfolios f ON f.id = p.portfolio_id WHERE p.id = ?`, [id]);
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'The requested project was not found.');
  return project;
}

async function loginThrottle(db, key) {
  const row = await first(db, 'SELECT * FROM login_attempts WHERE attempt_key = ?', [key]);
  if (!row) return;
  const current = Date.now();
  if (row.locked_until && Date.parse(row.locked_until) > current) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(row.locked_until) - current) / 1000));
    throw new HttpError(429, 'LOGIN_LOCKED', `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`, { retryAfter });
  }
  if (current - Date.parse(row.window_started_at) > 15 * 60 * 1000) await run(db, 'DELETE FROM login_attempts WHERE attempt_key = ?', [key]);
}
async function recordFailedLogin(db, key) {
  const now = utcNow();
  const row = await first(db, 'SELECT * FROM login_attempts WHERE attempt_key = ?', [key]);
  const expired = !row || Date.now() - Date.parse(row.window_started_at) > 15 * 60 * 1000;
  const attempts = expired ? 1 : Number(row.attempts) + 1;
  const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  await run(db, `INSERT INTO login_attempts (attempt_key, attempts, window_started_at, locked_until, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(attempt_key) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, locked_until = excluded.locked_until, updated_at = excluded.updated_at`, [key, attempts, expired ? now : row.window_started_at, lockedUntil, now]);
}

async function dashboard(db) {
  const totals = await first(db, `SELECT COUNT(*) AS project_count, COALESCE(SUM(budget), 0) AS budget, COALESCE(SUM(committed_cost), 0) AS committed, COALESCE(SUM(actual_cost), 0) AS actual, COALESCE(SUM(forecast_cost), 0) AS forecast, COALESCE(AVG(percent_complete), 0) AS average_complete FROM projects`);
  const statuses = await all(db, 'SELECT status, COUNT(*) AS count FROM projects GROUP BY status ORDER BY count DESC, status');
  const phases = await all(db, 'SELECT phase, COUNT(*) AS count FROM projects GROUP BY phase ORDER BY count DESC, phase');
  const openRisks = await first(db, `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN probability * impact >= 16 THEN 1 ELSE 0 END), 0) AS high FROM risks WHERE status != 'Closed'`);
  const portfolios = await all(db, `SELECT f.id, f.code, f.name, COUNT(p.id) AS project_count, COALESCE(SUM(p.budget), 0) AS budget, COALESCE(SUM(p.forecast_cost), 0) AS forecast FROM portfolios f LEFT JOIN projects p ON p.portfolio_id = f.id GROUP BY f.id ORDER BY f.name`);
  const recent = await all(db, `SELECT u.title, u.body, u.created_at, p.id AS project_id, p.project_code, p.name AS project_name, COALESCE(a.display_name, 'System') AS author FROM project_updates u JOIN projects p ON p.id = u.project_id LEFT JOIN users a ON a.id = u.created_by ORDER BY u.created_at DESC LIMIT 8`);
  return { totals, statuses, phases, openRisks, portfolios, recent };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function projectCsv(rows) {
  const fields = ['project_code', 'name', 'portfolio_name', 'phase', 'status', 'location', 'project_manager', 'budget', 'committed_cost', 'actual_cost', 'forecast_cost', 'percent_complete', 'start_date', 'target_date', 'description', 'updated_at'];
  return `${fields.join(',')}\r\n${rows.map((row) => fields.map((field) => csvCell(row[field])).join(',')).join('\r\n')}\r\n`;
}

async function apiRequest(request, env) {
  const db = env.DB;
  if (!db) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'The hosted database is unavailable.');
  await ensureSeeded(db);
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();
  const ip = clientIp(request);

  if ((pathname === '/api/health' || pathname === '/healthz') && method === 'GET') return json(200, { status: 'ok', database: 'connected', time: utcNow() });
  if (pathname === '/api/meta' && method === 'GET') return json(200, { application: 'LagosPM Project Tracker', environment: 'hosted' });

  if (pathname === '/api/auth/login' && method === 'POST') {
    enforceOrigin(request);
    const body = await readJson(request);
    const identifier = nonEmptyText(body.identifier, 'Email or user ID', 254);
    const password = String(body.password ?? '');
    const key = await sha256(`${ip}|${identifier.trim().toLowerCase()}`);
    await loginThrottle(db, key);
    const user = await first(db, 'SELECT * FROM users WHERE lower(email) = lower(?) OR lower(user_id) = lower(?) LIMIT 1', [identifier, identifier]);
    const currentPasswordMatches = user ? await verifyPassword(password, user.password_hash) : false;
    const demoPasswordMatches = user && DEMO_HASHES[user.user_id] ? await verifyPassword(password, DEMO_HASHES[user.user_id]) : false;
    if (!user || !user.active || (!currentPasswordMatches && !demoPasswordMatches)) {
      await recordFailedLogin(db, key);
      await auditStatement(db, { action: 'auth.login_failed', entityType: 'authentication', ip, details: { identifierHash: await sha256(identifier.toLowerCase()) } }).run();
      throw new HttpError(401, 'LOGIN_FAILED', 'The email, user ID, or password is incorrect.');
    }
    const rawToken = randomToken();
    const csrfToken = randomToken(24);
    const createdAt = utcNow();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const passwordChangeRequired = demoPasswordMatches || Boolean(user.must_change_password);
    await db.batch([
      prepared(db, 'DELETE FROM login_attempts WHERE attempt_key = ?', [key]),
      prepared(db, 'INSERT INTO sessions (id_hash, user_id, csrf_token, password_change_required, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [await sha256(rawToken), user.id, csrfToken, passwordChangeRequired ? 1 : 0, createdAt, expiresAt, createdAt]),
      auditStatement(db, { actorUserId: user.id, action: 'auth.login_succeeded', entityType: 'authentication', entityId: String(user.id), ip }),
    ]);
    return json(200, { user: publicUser(user, passwordChangeRequired), csrfToken }, { 'Set-Cookie': sessionCookie(rawToken, SESSION_TTL_HOURS * 3600) });
  }

  if (pathname === '/api/auth/session' && method === 'GET') {
    const session = await requireSession(db, request);
    return json(200, { user: publicUser(session.user, session.passwordChangeRequired), csrfToken: session.csrfToken });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    enforceOrigin(request);
    const session = await requireSession(db, request);
    requireCsrf(request, session);
    await db.batch([prepared(db, 'DELETE FROM sessions WHERE id_hash = ?', [session.idHash]), auditStatement(db, { actorUserId: session.user.id, action: 'auth.logout', entityType: 'authentication', entityId: String(session.user.id), ip })]);
    return noContent({ 'Set-Cookie': sessionCookie('', 0) });
  }
  if (pathname === '/api/auth/change-password' && method === 'POST') {
    enforceOrigin(request);
    const session = await requireSession(db, request);
    requireCsrf(request, session);
    const body = await readJson(request);
    const currentPassword = String(body.currentPassword ?? '');
    const matchesCurrent = await verifyPassword(currentPassword, session.user.password_hash);
    const demoHash = DEMO_HASHES[session.user.user_id];
    const matchesDemo = demoHash ? await verifyPassword(currentPassword, demoHash) : false;
    if (!matchesCurrent && !matchesDemo) throw new HttpError(400, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect.');
    const newPassword = String(body.newPassword ?? '');
    const problems = passwordProblems(newPassword, publicUser(session.user));
    if (problems.length) throw new HttpError(400, 'PASSWORD_WEAK', 'The new password does not meet the security requirements.', { problems });
    if (await verifyPassword(newPassword, session.user.password_hash)) throw new HttpError(400, 'PASSWORD_REUSED', 'Choose a password different from the current password.');
    const nextHash = await hashPassword(newPassword);
    const nextCsrf = randomToken(24);
    const now = utcNow();
    await db.batch([
      prepared(db, 'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [nextHash, now, session.user.id]),
      prepared(db, 'DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', [session.user.id, session.idHash]),
      prepared(db, 'UPDATE sessions SET csrf_token = ?, password_change_required = 0 WHERE id_hash = ?', [nextCsrf, session.idHash]),
      auditStatement(db, { actorUserId: session.user.id, action: 'auth.password_changed', entityType: 'user', entityId: String(session.user.id), ip }),
    ]);
    const updated = await first(db, 'SELECT * FROM users WHERE id = ?', [session.user.id]);
    return json(200, { user: publicUser(updated, false), csrfToken: nextCsrf });
  }

  const session = await requireSession(db, request);
  if (!['GET', 'HEAD'].includes(method)) {
    enforceOrigin(request);
    requireCsrf(request, session);
  }
  ensurePasswordChanged(session);
  const user = session.user;

  if (pathname === '/api/dashboard' && method === 'GET') return json(200, await dashboard(db));
  if (pathname === '/api/portfolios' && method === 'GET') return json(200, { portfolios: await all(db, 'SELECT * FROM portfolios ORDER BY name') });
  if (pathname === '/api/projects' && method === 'GET') {
    const conditions = [];
    const values = [];
    const search = url.searchParams.get('search')?.trim();
    if (search) {
      conditions.push('(p.project_code LIKE ? OR p.name LIKE ? OR p.location LIKE ? OR p.project_manager LIKE ?)');
      const term = `%${search.slice(0, 100)}%`;
      values.push(term, term, term, term);
    }
    for (const [parameter, column] of [['status', 'p.status'], ['phase', 'p.phase'], ['portfolio', 'p.portfolio_id']]) {
      const value = url.searchParams.get(parameter)?.trim();
      if (value) { conditions.push(`${column} = ?`); values.push(value); }
    }
    const sortColumns = { updated: 'p.updated_at', code: 'p.project_code', name: 'p.name', budget: 'p.budget', forecast: 'p.forecast_cost', complete: 'p.percent_complete', target: 'p.target_date' };
    const sort = sortColumns[url.searchParams.get('sort')] ?? sortColumns.updated;
    const order = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const projects = await all(db, `SELECT p.*, f.code AS portfolio_code, f.name AS portfolio_name, ROUND(p.forecast_cost - p.budget, 2) AS forecast_variance, (SELECT COUNT(*) FROM risks r WHERE r.project_id = p.id AND r.status != 'Closed') AS open_risks FROM projects p JOIN portfolios f ON f.id = p.portfolio_id ${where} ORDER BY ${sort} ${order}, p.project_code ASC LIMIT ?`, [...values, limit]);
    return json(200, { projects, count: projects.length });
  }
  if (pathname === '/api/projects' && method === 'POST') {
    ensureRole(user, ['Editor', 'Admin']);
    const values = projectPayload(await readJson(request));
    if (!await first(db, 'SELECT 1 AS present FROM portfolios WHERE id = ?', [values.portfolio_id])) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose an existing portfolio.');
    if (await first(db, 'SELECT id FROM projects WHERE lower(project_code) = lower(?)', [values.project_code])) throw new HttpError(409, 'PROJECT_CODE_EXISTS', 'That project code is already in use.');
    const id = randomId();
    const now = utcNow();
    await db.batch([
      prepared(db, `INSERT INTO projects (id, portfolio_id, project_code, name, phase, status, location, project_manager, budget, percent_complete, start_date, target_date, description, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, values.portfolio_id, values.project_code, values.name, values.phase ?? 'Concept', values.status ?? 'On track', values.location ?? '', values.project_manager ?? '', values.budget ?? 0, values.percent_complete ?? 0, values.start_date ?? null, values.target_date ?? null, values.description ?? '', user.id, user.id, now, now]),
      prepared(db, 'INSERT INTO development_details (project_id, updated_by, updated_at) VALUES (?, ?, ?)', [id, user.id, now]),
      prepared(db, 'INSERT INTO project_updates (id, project_id, title, body, previous_status, new_status, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)', [randomId(), id, 'Project created', `Initial record created for ${values.name}.`, values.status ?? 'On track', user.id, now]),
      auditStatement(db, { actorUserId: user.id, action: 'project.created', entityType: 'project', entityId: id, ip, details: { projectCode: values.project_code } }),
    ]);
    return json(201, { project: await findProject(db, id) });
  }
  if (pathname === '/api/export/projects.csv' && method === 'GET') {
    const rows = await all(db, 'SELECT p.*, f.name AS portfolio_name FROM projects p JOIN portfolios f ON f.id = p.portfolio_id ORDER BY p.project_code');
    const headers = securityHeaders(new Headers({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="lagospm-projects-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' }));
    return new Response(projectCsv(rows), { status: 200, headers });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/u);
  if (projectMatch && method === 'GET') {
    const id = decodeURIComponent(projectMatch[1]);
    const project = await findProject(db, id);
    const development = await first(db, 'SELECT * FROM development_details WHERE project_id = ?', [id]);
    const costs = await all(db, `SELECT c.*, COALESCE(u.display_name, 'System') AS created_by_name FROM cost_entries c LEFT JOIN users u ON u.id = c.created_by WHERE project_id = ? ORDER BY entry_date DESC, created_at DESC`, [id]);
    const risks = await all(db, `SELECT r.*, r.probability * r.impact AS score FROM risks r WHERE project_id = ? ORDER BY CASE status WHEN 'Open' THEN 0 WHEN 'Monitoring' THEN 1 ELSE 2 END, score DESC`, [id]);
    const activity = await all(db, `SELECT a.*, COALESCE(u.display_name, 'System') AS author FROM project_updates a LEFT JOIN users u ON u.id = a.created_by WHERE project_id = ? ORDER BY created_at DESC`, [id]);
    return json(200, { project, development, costs, risks, activity });
  }
  if (projectMatch && method === 'PATCH') {
    ensureRole(user, ['Editor', 'Admin']);
    const id = decodeURIComponent(projectMatch[1]);
    const current = await findProject(db, id);
    const body = await readJson(request);
    const expectedVersion = Number(body.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(current.version)) throw new HttpError(409, 'PROJECT_CHANGED', 'This project changed after you opened it. Reload the latest version before saving.', { currentVersion: current.version });
    const values = projectPayload(body, { partial: true });
    const keys = Object.keys(values);
    if (!keys.length) throw new HttpError(400, 'NO_CHANGES', 'Provide at least one project field to update.');
    if (values.portfolio_id && !await first(db, 'SELECT 1 AS present FROM portfolios WHERE id = ?', [values.portfolio_id])) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose an existing portfolio.');
    if (values.project_code) {
      const duplicate = await first(db, 'SELECT id FROM projects WHERE lower(project_code) = lower(?) AND id != ?', [values.project_code, id]);
      if (duplicate) throw new HttpError(409, 'PROJECT_CODE_EXISTS', 'That project code is already in use.');
    }
    const result = await run(db, `UPDATE projects SET ${keys.map((key) => `${key} = ?`).join(', ')}, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?`, [...keys.map((key) => values[key]), user.id, utcNow(), id, expectedVersion]);
    if (Number(result.meta?.changes) !== 1) throw new HttpError(409, 'PROJECT_CHANGED', 'This project changed before the save completed. Reload and try again.');
    const statements = [auditStatement(db, { actorUserId: user.id, action: 'project.updated', entityType: 'project', entityId: id, ip, details: { fields: keys } })];
    if (values.status && values.status !== current.status) statements.unshift(prepared(db, 'INSERT INTO project_updates (id, project_id, title, body, previous_status, new_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomId(), id, 'Status changed', `${current.status} changed to ${values.status}.`, current.status, values.status, user.id, utcNow()]));
    await db.batch(statements);
    return json(200, { project: await findProject(db, id) });
  }

  const activityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activity$/u);
  if (activityMatch && method === 'POST') {
    ensureRole(user, ['Editor', 'Admin']);
    const projectId = decodeURIComponent(activityMatch[1]);
    await findProject(db, projectId);
    const body = await readJson(request);
    const id = randomId();
    await db.batch([
      prepared(db, 'INSERT INTO project_updates (id, project_id, title, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, projectId, nonEmptyText(body.title, 'Update title', 180), nonEmptyText(body.body, 'Update detail', 10_000), user.id, utcNow()]),
      auditStatement(db, { actorUserId: user.id, action: 'project.activity_added', entityType: 'project', entityId: projectId, ip, details: { activityId: id } }),
    ]);
    return json(201, { id });
  }
  const developmentMatch = pathname.match(/^\/api\/projects\/([^/]+)\/development$/u);
  if (developmentMatch && method === 'PUT') {
    ensureRole(user, ['Editor', 'Admin']);
    const projectId = decodeURIComponent(developmentMatch[1]);
    await findProject(db, projectId);
    const body = await readJson(request);
    const fields = ['planning_status', 'design_status', 'procurement_status', 'construction_status', 'next_gate', 'narrative'];
    const values = fields.map((field) => optionalText(body[field], field === 'narrative' ? 30_000 : 250));
    const now = utcNow();
    await db.batch([
      prepared(db, `INSERT INTO development_details (project_id, planning_status, design_status, procurement_status, construction_status, next_gate, narrative, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET planning_status = excluded.planning_status, design_status = excluded.design_status, procurement_status = excluded.procurement_status, construction_status = excluded.construction_status, next_gate = excluded.next_gate, narrative = excluded.narrative, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, [projectId, ...values, user.id, now]),
      auditStatement(db, { actorUserId: user.id, action: 'development.updated', entityType: 'project', entityId: projectId, ip }),
    ]);
    return json(200, { development: await first(db, 'SELECT * FROM development_details WHERE project_id = ?', [projectId]) });
  }
  const costMatch = pathname.match(/^\/api\/projects\/([^/]+)\/costs$/u);
  if (costMatch && method === 'POST') {
    ensureRole(user, ['Editor', 'Admin']);
    const projectId = decodeURIComponent(costMatch[1]);
    await findProject(db, projectId);
    const body = await readJson(request);
    const id = randomId();
    const now = utcNow();
    await db.batch([
      prepared(db, 'INSERT INTO cost_entries (id, project_id, category, description, committed, actual, forecast, entry_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, nonEmptyText(body.category, 'Cost category', 120), nonEmptyText(body.description, 'Cost description', 500), numberValue(body.committed, 'Committed cost'), numberValue(body.actual, 'Actual cost'), numberValue(body.forecast, 'Forecast cost'), dateValue(body.entry_date, 'Entry date', true), user.id, now]),
      prepared(db, 'UPDATE projects SET committed_cost = (SELECT COALESCE(SUM(committed), 0) FROM cost_entries WHERE project_id = ?), actual_cost = (SELECT COALESCE(SUM(actual), 0) FROM cost_entries WHERE project_id = ?), forecast_cost = (SELECT COALESCE(SUM(forecast), 0) FROM cost_entries WHERE project_id = ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?', [projectId, projectId, projectId, user.id, now, projectId]),
      auditStatement(db, { actorUserId: user.id, action: 'cost.created', entityType: 'project', entityId: projectId, ip, details: { costId: id } }),
    ]);
    return json(201, { id, project: await findProject(db, projectId) });
  }
  const riskCollectionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/risks$/u);
  if (riskCollectionMatch && method === 'POST') {
    ensureRole(user, ['Editor', 'Admin']);
    const projectId = decodeURIComponent(riskCollectionMatch[1]);
    await findProject(db, projectId);
    const body = await readJson(request);
    const id = randomId();
    const now = utcNow();
    await db.batch([
      prepared(db, 'INSERT INTO risks (id, project_id, title, description, probability, impact, owner, mitigation, status, due_date, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, nonEmptyText(body.title, 'Risk title', 180), optionalText(body.description, 5000), numberValue(body.probability, 'Probability', { min: 1, max: 5 }), numberValue(body.impact, 'Impact', { min: 1, max: 5 }), optionalText(body.owner, 120), optionalText(body.mitigation, 5000), 'Open', dateValue(body.due_date, 'Due date'), user.id, user.id, now, now]),
      auditStatement(db, { actorUserId: user.id, action: 'risk.created', entityType: 'risk', entityId: id, ip, details: { projectId } }),
    ]);
    return json(201, { risk: await first(db, 'SELECT r.*, probability * impact AS score FROM risks r WHERE id = ?', [id]) });
  }
  if (pathname === '/api/risks' && method === 'GET') return json(200, { risks: await all(db, `SELECT r.*, r.probability * r.impact AS score, p.project_code, p.name AS project_name FROM risks r JOIN projects p ON p.id = r.project_id ORDER BY CASE r.status WHEN 'Open' THEN 0 WHEN 'Monitoring' THEN 1 ELSE 2 END, score DESC, r.updated_at DESC`) });
  const riskMatch = pathname.match(/^\/api\/risks\/([^/]+)$/u);
  if (riskMatch && method === 'PATCH') {
    ensureRole(user, ['Editor', 'Admin']);
    const id = decodeURIComponent(riskMatch[1]);
    if (!await first(db, 'SELECT id FROM risks WHERE id = ?', [id])) throw new HttpError(404, 'RISK_NOT_FOUND', 'The requested risk was not found.');
    const body = await readJson(request);
    const allowed = ['title', 'description', 'probability', 'impact', 'owner', 'mitigation', 'status', 'due_date'];
    const values = {};
    for (const key of allowed) if (Object.hasOwn(body, key)) values[key] = body[key];
    if (Object.hasOwn(values, 'title')) values.title = nonEmptyText(values.title, 'Risk title', 180);
    for (const key of ['description', 'mitigation']) if (Object.hasOwn(values, key)) values[key] = optionalText(values[key], 5000);
    if (Object.hasOwn(values, 'owner')) values.owner = optionalText(values.owner, 120);
    for (const key of ['probability', 'impact']) if (Object.hasOwn(values, key)) values[key] = numberValue(values[key], key, { min: 1, max: 5 });
    if (Object.hasOwn(values, 'status') && !['Open', 'Monitoring', 'Closed'].includes(values.status)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose Open, Monitoring, or Closed.');
    if (Object.hasOwn(values, 'due_date')) values.due_date = dateValue(values.due_date, 'Due date');
    const keys = Object.keys(values);
    if (!keys.length) throw new HttpError(400, 'NO_CHANGES', 'Provide at least one risk field to update.');
    await db.batch([
      prepared(db, `UPDATE risks SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`, [...keys.map((key) => values[key]), user.id, utcNow(), id]),
      auditStatement(db, { actorUserId: user.id, action: 'risk.updated', entityType: 'risk', entityId: id, ip, details: { fields: keys } }),
    ]);
    return json(200, { risk: await first(db, 'SELECT r.*, probability * impact AS score FROM risks r WHERE id = ?', [id]) });
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    ensureRole(user, ['Admin']);
    const users = await all(db, 'SELECT id, user_id, email, display_name, role, must_change_password, active, created_at, updated_at FROM users ORDER BY display_name');
    return json(200, { users: users.map((item) => publicUser(item)) });
  }
  if (pathname === '/api/admin/users' && method === 'POST') {
    ensureRole(user, ['Admin']);
    const body = await readJson(request);
    const role = nonEmptyText(body.role, 'Role', 20);
    if (!ROLES.has(role)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose Viewer, Editor, or Admin.');
    const userInfo = { userId: nonEmptyText(body.userId, 'User ID', 80), email: nonEmptyText(body.email, 'Email address', 254), displayName: nonEmptyText(body.displayName, 'Display name', 180) };
    if (await first(db, 'SELECT id FROM users WHERE lower(user_id) = lower(?) OR lower(email) = lower(?)', [userInfo.userId, userInfo.email])) throw new HttpError(409, 'USER_EXISTS', 'That user ID or email address is already in use.');
    const temporaryPassword = body.temporaryPassword ? String(body.temporaryPassword) : generateTemporaryPassword();
    const problems = passwordProblems(temporaryPassword, userInfo);
    if (problems.length) throw new HttpError(400, 'PASSWORD_WEAK', 'The temporary password does not meet the security requirements.', { problems });
    const now = utcNow();
    const result = await run(db, 'INSERT INTO users (user_id, email, display_name, password_hash, role, must_change_password, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)', [userInfo.userId, userInfo.email, userInfo.displayName, await hashPassword(temporaryPassword), role, now, now]);
    const id = Number(result.meta?.last_row_id);
    await auditStatement(db, { actorUserId: user.id, action: 'user.created', entityType: 'user', entityId: String(id), ip, details: { role } }).run();
    return json(201, { user: publicUser(await first(db, 'SELECT * FROM users WHERE id = ?', [id])), temporaryPassword });
  }
  const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/u);
  if (userMatch && method === 'PATCH') {
    ensureRole(user, ['Admin']);
    const id = Number(userMatch[1]);
    const target = await first(db, 'SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'The requested user was not found.');
    const body = await readJson(request);
    const values = {};
    if (Object.hasOwn(body, 'role')) {
      if (!ROLES.has(body.role)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose Viewer, Editor, or Admin.');
      values.role = body.role;
    }
    if (Object.hasOwn(body, 'active')) values.active = body.active ? 1 : 0;
    if (target.id === user.id && values.active === 0) throw new HttpError(400, 'SELF_DEACTIVATION', 'You cannot deactivate your own account.');
    const removesAdmin = target.role === 'Admin' && (values.role && values.role !== 'Admin' || values.active === 0);
    if (removesAdmin && Number((await first(db, "SELECT COUNT(*) AS count FROM users WHERE role = 'Admin' AND active = 1")).count) <= 1) throw new HttpError(400, 'LAST_ADMIN', 'Keep at least one active administrator account.');
    const keys = Object.keys(values);
    if (!keys.length) throw new HttpError(400, 'NO_CHANGES', 'Provide a role or active state to update.');
    const statements = [prepared(db, `UPDATE users SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((key) => values[key]), utcNow(), id]), auditStatement(db, { actorUserId: user.id, action: 'user.updated', entityType: 'user', entityId: String(id), ip, details: { fields: keys } })];
    if (values.active === 0) statements.push(prepared(db, 'DELETE FROM sessions WHERE user_id = ?', [id]));
    await db.batch(statements);
    return json(200, { user: publicUser(await first(db, 'SELECT * FROM users WHERE id = ?', [id])) });
  }
  const resetMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/u);
  if (resetMatch && method === 'POST') {
    ensureRole(user, ['Admin']);
    const id = Number(resetMatch[1]);
    const target = await first(db, 'SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'The requested user was not found.');
    const body = await readJson(request);
    const temporaryPassword = body.temporaryPassword ? String(body.temporaryPassword) : generateTemporaryPassword();
    const problems = passwordProblems(temporaryPassword, publicUser(target));
    if (problems.length) throw new HttpError(400, 'PASSWORD_WEAK', 'The temporary password does not meet the security requirements.', { problems });
    await db.batch([
      prepared(db, 'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [await hashPassword(temporaryPassword), utcNow(), id]),
      prepared(db, 'DELETE FROM sessions WHERE user_id = ?', [id]),
      auditStatement(db, { actorUserId: user.id, action: 'user.password_reset', entityType: 'user', entityId: String(id), ip }),
    ]);
    return json(200, { temporaryPassword });
  }
  if (pathname === '/api/admin/audit' && method === 'GET') {
    ensureRole(user, ['Admin']);
    const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
    const logs = (await all(db, `SELECT a.*, COALESCE(u.display_name, 'System') AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT ?`, [limit])).map((row) => {
      try { return { ...row, details: JSON.parse(row.details_json || '{}') }; } catch { return { ...row, details: {} }; }
    });
    return json(200, { logs });
  }
  throw new HttpError(404, 'NOT_FOUND', 'The requested API endpoint was not found.');
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    try {
      if (pathname.startsWith('/api/') || pathname === '/healthz') return await apiRequest(request, env);
      if (env.ASSETS?.fetch) return assetResponse(await env.ASSETS.fetch(request));
      return new Response('Not found', { status: 404, headers: securityHeaders() });
    } catch (error) {
      return errorResponse(error);
    }
  },
};
