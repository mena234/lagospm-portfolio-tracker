import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, extname, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateTemporaryPassword, hashPassword, passwordProblems, randomToken, secureEqual, tokenHash, verifyPassword } from './security.mjs';
import { refreshProjectCostTotals, utcNow } from './db.mjs';

const COOKIE_NAME = 'lagospm_session';
const MAX_BODY_BYTES = 1_048_576;
const ROLES = new Set(['Viewer', 'Editor', 'Admin']);
const PROJECT_STATUSES = new Set(['On track', 'Watch', 'At risk', 'On hold', 'Complete']);
const PHASES = new Set(['Concept', 'Feasibility', 'Design', 'Procurement', 'Construction', 'Delivery', 'Closeout']);

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function securityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const data = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(data);
}

function sendNoContent(response, extraHeaders = {}) {
  response.writeHead(204, { 'Cache-Control': 'no-store', ...extraHeaders });
  response.end();
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : 'The server could not complete the request.';
  const payload = { error: { code, message } };
  if (error instanceof HttpError && error.details) payload.error.details = error.details;
  if (!(error instanceof HttpError)) console.error(error);
  sendJson(response, status, payload);
}

async function readJson(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Send this request as application/json.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'The request body exceeds 1 MB.');
    chunks.push(chunk);
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
}

function cookies(request) {
  const result = {};
  for (const part of String(request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function sessionCookie(value, config, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.production) parts.push('Secure');
  return parts.join('; ');
}

function clientIp(request, config) {
  if (config.trustProxy) {
    const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded.slice(0, 80);
  }
  return String(request.socket.remoteAddress ?? '').slice(0, 80);
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function publicUser(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
    active: Boolean(row.active),
  };
}

function getSession(db, request) {
  const rawToken = cookies(request)[COOKIE_NAME];
  if (!rawToken) return null;
  const idHash = tokenHash(rawToken);
  const row = db.prepare(`
    SELECT s.id_hash, s.csrf_token, s.expires_at, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ?
  `).get(idHash);
  if (!row || !row.active || row.expires_at <= utcNow()) {
    if (row) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
    return null;
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(utcNow(), idHash);
  return { idHash, csrfToken: row.csrf_token, user: row };
}

function requireSession(db, request) {
  const session = getSession(db, request);
  if (!session) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  return session;
}

function requireCsrf(request, session) {
  const supplied = request.headers['x-csrf-token'];
  if (!supplied || !secureEqual(supplied, session.csrfToken)) {
    throw new HttpError(403, 'CSRF_INVALID', 'Your security token is missing or expired. Refresh the page and try again.');
  }
}

function enforceOrigin(request, config) {
  const origin = request.headers.origin;
  if (origin && config.publicOrigin && origin !== config.publicOrigin) {
    throw new HttpError(403, 'ORIGIN_INVALID', 'This request came from an untrusted origin.');
  }
}

function ensureRole(user, allowed) {
  if (!allowed.includes(user.role)) throw new HttpError(403, 'FORBIDDEN', 'Your role does not allow this action.');
}

function ensurePasswordChanged(user) {
  if (user.must_change_password) {
    throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before using the tracker.');
  }
}

function audit(db, { actorUserId = null, action, entityType, entityId = null, ip = '', details = {} }) {
  db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actorUserId, action, entityType, entityId, ip, JSON.stringify(details), utcNow());
}

function attemptKey(ip, identifier) {
  return tokenHash(`${ip}|${String(identifier).trim().toLowerCase()}`);
}

function loginThrottle(db, key) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE attempt_key = ?').get(key);
  if (!row) return;
  const now = Date.now();
  if (row.locked_until && Date.parse(row.locked_until) > now) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(row.locked_until) - now) / 1000));
    throw new HttpError(429, 'LOGIN_LOCKED', `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`, { retryAfter });
  }
  if (now - Date.parse(row.window_started_at) > 15 * 60 * 1000) {
    db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
  }
}

function recordFailedLogin(db, key) {
  const now = utcNow();
  const row = db.prepare('SELECT * FROM login_attempts WHERE attempt_key = ?').get(key);
  const expired = !row || Date.now() - Date.parse(row.window_started_at) > 15 * 60 * 1000;
  const attempts = expired ? 1 : row.attempts + 1;
  const windowStartedAt = expired ? now : row.window_started_at;
  const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  db.prepare(`
    INSERT INTO login_attempts (attempt_key, attempts, window_started_at, locked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(attempt_key) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at,
      locked_until = excluded.locked_until, updated_at = excluded.updated_at
  `).run(key, attempts, windowStartedAt, lockedUntil, now);
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
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, 'VALIDATION_FAILED', `${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function dateValue(value, label, required = false) {
  const text = String(value ?? '').trim();
  if (!text && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new HttpError(400, 'VALIDATION_FAILED', `${label} must use YYYY-MM-DD format.`);
  }
  return text;
}

function findProject(db, id) {
  const project = db.prepare(`
    SELECT p.*, f.code AS portfolio_code, f.name AS portfolio_name,
      ROUND(p.forecast_cost - p.budget, 2) AS forecast_variance
    FROM projects p JOIN portfolios f ON f.id = p.portfolio_id WHERE p.id = ?
  `).get(id);
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'The requested project was not found.');
  return project;
}

function projectPayload(body, { partial = false } = {}) {
  const result = {};
  const fields = ['portfolio_id', 'project_code', 'name', 'phase', 'status', 'location', 'project_manager', 'budget', 'percent_complete', 'start_date', 'target_date', 'description'];
  for (const field of fields) {
    if (!partial || Object.hasOwn(body, field)) result[field] = body[field];
  }
  if (!partial) {
    result.portfolio_id = nonEmptyText(result.portfolio_id, 'Portfolio', 80);
    result.project_code = nonEmptyText(result.project_code, 'Project code', 40);
    result.name = nonEmptyText(result.name, 'Project name', 180);
  } else {
    if (Object.hasOwn(result, 'portfolio_id')) result.portfolio_id = nonEmptyText(result.portfolio_id, 'Portfolio', 80);
    if (Object.hasOwn(result, 'project_code')) result.project_code = nonEmptyText(result.project_code, 'Project code', 40);
    if (Object.hasOwn(result, 'name')) result.name = nonEmptyText(result.name, 'Project name', 180);
  }
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

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function projectCsv(rows) {
  const fields = ['project_code', 'name', 'portfolio_name', 'phase', 'status', 'location', 'project_manager', 'budget', 'committed_cost', 'actual_cost', 'forecast_cost', 'percent_complete', 'start_date', 'target_date', 'description', 'updated_at'];
  return `${fields.join(',')}\r\n${rows.map((row) => fields.map((field) => csvCell(row[field])).join(',')).join('\r\n')}\r\n`;
}

function mimeType(path) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.ico': 'image/x-icon',
  }[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function serveStatic(response, pathname, publicDir) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', 'The requested path is invalid.');
  }
  const servesProjectTokens = decoded === '/theme-tokens.css';
  let path = servesProjectTokens ? resolve(publicDir, '..', 'tokens.css') : resolve(publicDir, `.${decoded}`);
  const pathRelative = relative(publicDir, path);
  if (!servesProjectTokens && (pathRelative.startsWith('..') || pathRelative.includes(`..${process.platform === 'win32' ? '\\' : '/'}`))) {
    throw new HttpError(404, 'NOT_FOUND', 'The requested file was not found.');
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    if (extname(decoded)) throw new HttpError(404, 'NOT_FOUND', 'The requested file was not found.');
    path = resolve(publicDir, 'index.html');
  }
  const stat = statSync(path);
  const extension = extname(path).toLowerCase();
  const cacheControl = ['.html', '.css', '.js'].includes(extension)
    ? 'no-cache'
    : 'public, max-age=3600';
  response.writeHead(200, {
    'Content-Type': mimeType(path),
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
  });
  createReadStream(path).pipe(response);
}

function dashboard(db) {
  const totals = db.prepare(`
    SELECT COUNT(*) AS project_count,
      COALESCE(SUM(budget), 0) AS budget,
      COALESCE(SUM(committed_cost), 0) AS committed,
      COALESCE(SUM(actual_cost), 0) AS actual,
      COALESCE(SUM(forecast_cost), 0) AS forecast,
      COALESCE(AVG(percent_complete), 0) AS average_complete
    FROM projects
  `).get();
  const statuses = db.prepare('SELECT status, COUNT(*) AS count FROM projects GROUP BY status ORDER BY count DESC, status').all();
  const phases = db.prepare('SELECT phase, COUNT(*) AS count FROM projects GROUP BY phase ORDER BY count DESC, phase').all();
  const openRisks = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN probability * impact >= 16 THEN 1 ELSE 0 END), 0) AS high
    FROM risks WHERE status != 'Closed'
  `).get();
  const portfolios = db.prepare(`
    SELECT f.id, f.code, f.name, COUNT(p.id) AS project_count,
      COALESCE(SUM(p.budget), 0) AS budget, COALESCE(SUM(p.forecast_cost), 0) AS forecast
    FROM portfolios f LEFT JOIN projects p ON p.portfolio_id = f.id
    GROUP BY f.id ORDER BY f.name
  `).all();
  const recent = db.prepare(`
    SELECT u.title, u.body, u.created_at, p.id AS project_id, p.project_code, p.name AS project_name,
      COALESCE(a.display_name, 'System') AS author
    FROM project_updates u JOIN projects p ON p.id = u.project_id
    LEFT JOIN users a ON a.id = u.created_by ORDER BY u.created_at DESC LIMIT 8
  `).all();
  return { totals, statuses, phases, openRisks, portfolios, recent };
}

export function createApplication({ db, config }) {
  return createServer(async (request, response) => {
    securityHeaders(response);
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;
    const method = request.method ?? 'GET';
    const ip = clientIp(request, config);

    try {
      if (pathname === '/api/health' || pathname === '/healthz') {
        if (config.healthLocalOnly && !isLoopback(request.socket.remoteAddress)) {
          throw new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.');
        }
        const integrity = db.prepare('PRAGMA quick_check').get().quick_check;
        return sendJson(response, integrity === 'ok' ? 200 : 503, { status: integrity === 'ok' ? 'ok' : 'degraded', database: integrity, time: utcNow() });
      }

      if (pathname === '/api/meta' && method === 'GET') {
        const payload = { application: 'LagosPM Project Tracker', environment: config.environment };
        if (config.allowDemoCredentials && config.seedDemoData) {
          payload.demoAccounts = [
            { role: 'Admin', identifier: config.initialAdmin.email, password: config.initialAdmin.password },
            { role: 'Editor', identifier: 'editor@lagospm.local', password: config.demoPassword },
            { role: 'Viewer', identifier: 'viewer@lagospm.local', password: config.demoPassword },
          ];
        }
        return sendJson(response, 200, payload);
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        enforceOrigin(request, config);
        const body = await readJson(request);
        const identifier = nonEmptyText(body.identifier, 'Email or user ID', 254);
        const password = String(body.password ?? '');
        const key = attemptKey(ip, identifier);
        loginThrottle(db, key);
        const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) OR lower(user_id) = lower(?) LIMIT 1').get(identifier, identifier);
        if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
          recordFailedLogin(db, key);
          audit(db, { action: 'auth.login_failed', entityType: 'authentication', ip, details: { identifierHash: tokenHash(identifier.toLowerCase()) } });
          throw new HttpError(401, 'LOGIN_FAILED', 'The email, user ID, or password is incorrect.');
        }
        db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
        const rawToken = randomToken();
        const csrfToken = randomToken(24);
        const createdAt = utcNow();
        const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000).toISOString();
        db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(tokenHash(rawToken), user.id, csrfToken, createdAt, expiresAt, createdAt);
        audit(db, { actorUserId: user.id, action: 'auth.login_succeeded', entityType: 'authentication', entityId: String(user.id), ip });
        return sendJson(response, 200, { user: publicUser(user), csrfToken }, { 'Set-Cookie': sessionCookie(rawToken, config, config.sessionTtlHours * 3600) });
      }

      if (pathname === '/api/auth/session' && method === 'GET') {
        const session = requireSession(db, request);
        return sendJson(response, 200, { user: publicUser(session.user), csrfToken: session.csrfToken });
      }

      if (pathname === '/api/auth/logout' && method === 'POST') {
        enforceOrigin(request, config);
        const session = requireSession(db, request);
        requireCsrf(request, session);
        db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(session.idHash);
        audit(db, { actorUserId: session.user.id, action: 'auth.logout', entityType: 'authentication', entityId: String(session.user.id), ip });
        return sendNoContent(response, { 'Set-Cookie': sessionCookie('', config, 0) });
      }

      if (pathname === '/api/auth/change-password' && method === 'POST') {
        enforceOrigin(request, config);
        const session = requireSession(db, request);
        requireCsrf(request, session);
        const body = await readJson(request);
        if (!verifyPassword(String(body.currentPassword ?? ''), session.user.password_hash)) {
          throw new HttpError(400, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect.');
        }
        const newPassword = String(body.newPassword ?? '');
        const problems = passwordProblems(newPassword, publicUser(session.user));
        if (problems.length) throw new HttpError(400, 'PASSWORD_WEAK', 'The new password does not meet the security requirements.', { problems });
        if (verifyPassword(newPassword, session.user.password_hash)) {
          throw new HttpError(400, 'PASSWORD_REUSED', 'Choose a password different from the current password.');
        }
        const now = utcNow();
        const nextCsrf = randomToken(24);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(hashPassword(newPassword), now, session.user.id);
          db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(session.user.id, session.idHash);
          db.prepare('UPDATE sessions SET csrf_token = ? WHERE id_hash = ?').run(nextCsrf, session.idHash);
          audit(db, { actorUserId: session.user.id, action: 'auth.password_changed', entityType: 'user', entityId: String(session.user.id), ip });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id);
        return sendJson(response, 200, { user: publicUser(updated), csrfToken: nextCsrf });
      }

      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This resource only supports GET.');
        return serveStatic(response, pathname, config.publicDir);
      }

      const session = requireSession(db, request);
      const user = session.user;
      if (!['GET', 'HEAD'].includes(method)) {
        enforceOrigin(request, config);
        requireCsrf(request, session);
      }
      ensurePasswordChanged(user);

      if (pathname === '/api/dashboard' && method === 'GET') return sendJson(response, 200, dashboard(db));

      if (pathname === '/api/portfolios' && method === 'GET') {
        return sendJson(response, 200, { portfolios: db.prepare('SELECT * FROM portfolios ORDER BY name').all() });
      }

      if (pathname === '/api/projects' && method === 'GET') {
        const conditions = [];
        const parameters = [];
        const search = url.searchParams.get('search')?.trim();
        if (search) {
          conditions.push('(p.project_code LIKE ? OR p.name LIKE ? OR p.location LIKE ? OR p.project_manager LIKE ?)');
          const term = `%${search.slice(0, 100)}%`;
          parameters.push(term, term, term, term);
        }
        for (const [parameter, column] of [['status', 'p.status'], ['phase', 'p.phase'], ['portfolio', 'p.portfolio_id']]) {
          const value = url.searchParams.get(parameter)?.trim();
          if (value) { conditions.push(`${column} = ?`); parameters.push(value); }
        }
        const sortColumns = { updated: 'p.updated_at', code: 'p.project_code', name: 'p.name', budget: 'p.budget', forecast: 'p.forecast_cost', complete: 'p.percent_complete', target: 'p.target_date' };
        const sort = sortColumns[url.searchParams.get('sort')] ?? sortColumns.updated;
        const order = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
        const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const projects = db.prepare(`
          SELECT p.*, f.code AS portfolio_code, f.name AS portfolio_name,
            ROUND(p.forecast_cost - p.budget, 2) AS forecast_variance,
            (SELECT COUNT(*) FROM risks r WHERE r.project_id = p.id AND r.status != 'Closed') AS open_risks
          FROM projects p JOIN portfolios f ON f.id = p.portfolio_id
          ${where} ORDER BY ${sort} ${order}, p.project_code ASC LIMIT ?
        `).all(...parameters, limit);
        return sendJson(response, 200, { projects, count: projects.length });
      }

      if (pathname === '/api/projects' && method === 'POST') {
        ensureRole(user, ['Editor', 'Admin']);
        const values = projectPayload(await readJson(request));
        if (!db.prepare('SELECT 1 FROM portfolios WHERE id = ?').get(values.portfolio_id)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose an existing portfolio.');
        const id = randomUUID();
        const now = utcNow();
        try {
          db.exec('BEGIN IMMEDIATE');
          db.prepare(`
            INSERT INTO projects (id, portfolio_id, project_code, name, phase, status, location, project_manager, budget,
              percent_complete, start_date, target_date, description, created_by, updated_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, values.portfolio_id, values.project_code, values.name, values.phase ?? 'Concept', values.status ?? 'On track', values.location ?? '', values.project_manager ?? '', values.budget ?? 0, values.percent_complete ?? 0, values.start_date ?? null, values.target_date ?? null, values.description ?? '', user.id, user.id, now, now);
          db.prepare(`INSERT INTO development_details (project_id, updated_by, updated_at) VALUES (?, ?, ?)`).run(id, user.id, now);
          db.prepare(`INSERT INTO project_updates (id, project_id, title, body, previous_status, new_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(randomUUID(), id, 'Project created', `Initial record created for ${values.name}.`, null, values.status ?? 'On track', user.id, now);
          audit(db, { actorUserId: user.id, action: 'project.created', entityType: 'project', entityId: id, ip, details: { projectCode: values.project_code } });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'PROJECT_CODE_EXISTS', 'That project code is already in use.');
          throw error;
        }
        return sendJson(response, 201, { project: findProject(db, id) });
      }

      if (pathname === '/api/export/projects.csv' && method === 'GET') {
        const rows = db.prepare(`SELECT p.*, f.name AS portfolio_name FROM projects p JOIN portfolios f ON f.id = p.portfolio_id ORDER BY p.project_code`).all();
        const data = Buffer.from(projectCsv(rows), 'utf8');
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Length': data.length,
          'Content-Disposition': `attachment; filename="lagospm-projects-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        });
        return response.end(data);
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch && method === 'GET') {
        const id = decodeURIComponent(projectMatch[1]);
        const project = findProject(db, id);
        const development = db.prepare('SELECT * FROM development_details WHERE project_id = ?').get(id);
        const costs = db.prepare('SELECT c.*, COALESCE(u.display_name, \'System\') AS created_by_name FROM cost_entries c LEFT JOIN users u ON u.id = c.created_by WHERE project_id = ? ORDER BY entry_date DESC, created_at DESC').all(id);
        const risks = db.prepare('SELECT r.*, r.probability * r.impact AS score FROM risks r WHERE project_id = ? ORDER BY CASE status WHEN \'Open\' THEN 0 WHEN \'Monitoring\' THEN 1 ELSE 2 END, score DESC').all(id);
        const activity = db.prepare('SELECT a.*, COALESCE(u.display_name, \'System\') AS author FROM project_updates a LEFT JOIN users u ON u.id = a.created_by WHERE project_id = ? ORDER BY created_at DESC').all(id);
        return sendJson(response, 200, { project, development, costs, risks, activity });
      }

      if (projectMatch && method === 'PATCH') {
        ensureRole(user, ['Editor', 'Admin']);
        const id = decodeURIComponent(projectMatch[1]);
        const current = findProject(db, id);
        const body = await readJson(request);
        const expectedVersion = Number(body.version);
        if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
          throw new HttpError(409, 'PROJECT_CHANGED', 'This project changed after you opened it. Reload the latest version before saving.', { currentVersion: current.version });
        }
        const values = projectPayload(body, { partial: true });
        const keys = Object.keys(values);
        if (!keys.length) throw new HttpError(400, 'NO_CHANGES', 'Provide at least one project field to update.');
        if (values.portfolio_id && !db.prepare('SELECT 1 FROM portfolios WHERE id = ?').get(values.portfolio_id)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose an existing portfolio.');
        const set = keys.map((key) => `${key} = ?`);
        const now = utcNow();
        try {
          db.exec('BEGIN IMMEDIATE');
          const result = db.prepare(`UPDATE projects SET ${set.join(', ')}, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?`)
            .run(...keys.map((key) => values[key]), user.id, now, id, expectedVersion);
          if (result.changes !== 1) throw new HttpError(409, 'PROJECT_CHANGED', 'This project changed before the save completed. Reload and try again.');
          if (values.status && values.status !== current.status) {
            db.prepare(`INSERT INTO project_updates (id, project_id, title, body, previous_status, new_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(randomUUID(), id, 'Status changed', `${current.status} changed to ${values.status}.`, current.status, values.status, user.id, now);
          }
          audit(db, { actorUserId: user.id, action: 'project.updated', entityType: 'project', entityId: id, ip, details: { fields: keys } });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'PROJECT_CODE_EXISTS', 'That project code is already in use.');
          throw error;
        }
        return sendJson(response, 200, { project: findProject(db, id) });
      }

      const activityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activity$/);
      if (activityMatch && method === 'POST') {
        ensureRole(user, ['Editor', 'Admin']);
        const projectId = decodeURIComponent(activityMatch[1]);
        findProject(db, projectId);
        const body = await readJson(request);
        const id = randomUUID();
        const title = nonEmptyText(body.title, 'Update title', 180);
        const detail = nonEmptyText(body.body, 'Update detail', 10_000);
        db.prepare(`INSERT INTO project_updates (id, project_id, title, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(id, projectId, title, detail, user.id, utcNow());
        audit(db, { actorUserId: user.id, action: 'project.activity_added', entityType: 'project', entityId: projectId, ip, details: { activityId: id } });
        return sendJson(response, 201, { id });
      }

      const developmentMatch = pathname.match(/^\/api\/projects\/([^/]+)\/development$/);
      if (developmentMatch && method === 'PUT') {
        ensureRole(user, ['Editor', 'Admin']);
        const projectId = decodeURIComponent(developmentMatch[1]);
        findProject(db, projectId);
        const body = await readJson(request);
        const fields = ['planning_status', 'design_status', 'procurement_status', 'construction_status', 'next_gate', 'narrative'];
        const values = fields.map((field) => optionalText(body[field], field === 'narrative' ? 30_000 : 250));
        const now = utcNow();
        db.prepare(`
          INSERT INTO development_details (project_id, planning_status, design_status, procurement_status, construction_status, next_gate, narrative, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET planning_status = excluded.planning_status, design_status = excluded.design_status,
            procurement_status = excluded.procurement_status, construction_status = excluded.construction_status,
            next_gate = excluded.next_gate, narrative = excluded.narrative, updated_by = excluded.updated_by, updated_at = excluded.updated_at
        `).run(projectId, ...values, user.id, now);
        audit(db, { actorUserId: user.id, action: 'development.updated', entityType: 'project', entityId: projectId, ip });
        return sendJson(response, 200, { development: db.prepare('SELECT * FROM development_details WHERE project_id = ?').get(projectId) });
      }

      const costMatch = pathname.match(/^\/api\/projects\/([^/]+)\/costs$/);
      if (costMatch && method === 'POST') {
        ensureRole(user, ['Editor', 'Admin']);
        const projectId = decodeURIComponent(costMatch[1]);
        findProject(db, projectId);
        const body = await readJson(request);
        const id = randomUUID();
        const now = utcNow();
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`INSERT INTO cost_entries (id, project_id, category, description, committed, actual, forecast, entry_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, projectId, nonEmptyText(body.category, 'Cost category', 120), nonEmptyText(body.description, 'Cost description', 500), numberValue(body.committed, 'Committed cost'), numberValue(body.actual, 'Actual cost'), numberValue(body.forecast, 'Forecast cost'), dateValue(body.entry_date, 'Entry date', true), user.id, now);
          refreshProjectCostTotals(db, projectId, user.id);
          audit(db, { actorUserId: user.id, action: 'cost.created', entityType: 'project', entityId: projectId, ip, details: { costId: id } });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return sendJson(response, 201, { id, project: findProject(db, projectId) });
      }

      const riskCollectionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/risks$/);
      if (riskCollectionMatch && method === 'POST') {
        ensureRole(user, ['Editor', 'Admin']);
        const projectId = decodeURIComponent(riskCollectionMatch[1]);
        findProject(db, projectId);
        const body = await readJson(request);
        const id = randomUUID();
        const now = utcNow();
        db.prepare(`
          INSERT INTO risks (id, project_id, title, description, probability, impact, owner, mitigation, status, due_date, created_by, updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, projectId, nonEmptyText(body.title, 'Risk title', 180), optionalText(body.description, 5000), numberValue(body.probability, 'Probability', { min: 1, max: 5 }), numberValue(body.impact, 'Impact', { min: 1, max: 5 }), optionalText(body.owner, 120), optionalText(body.mitigation, 5000), 'Open', dateValue(body.due_date, 'Due date'), user.id, user.id, now, now);
        audit(db, { actorUserId: user.id, action: 'risk.created', entityType: 'risk', entityId: id, ip, details: { projectId } });
        return sendJson(response, 201, { risk: db.prepare('SELECT r.*, probability * impact AS score FROM risks r WHERE id = ?').get(id) });
      }

      if (pathname === '/api/risks' && method === 'GET') {
        const risks = db.prepare(`
          SELECT r.*, r.probability * r.impact AS score, p.project_code, p.name AS project_name
          FROM risks r JOIN projects p ON p.id = r.project_id
          ORDER BY CASE r.status WHEN 'Open' THEN 0 WHEN 'Monitoring' THEN 1 ELSE 2 END, score DESC, r.updated_at DESC
        `).all();
        return sendJson(response, 200, { risks });
      }

      const riskMatch = pathname.match(/^\/api\/risks\/([^/]+)$/);
      if (riskMatch && method === 'PATCH') {
        ensureRole(user, ['Editor', 'Admin']);
        const id = decodeURIComponent(riskMatch[1]);
        const current = db.prepare('SELECT * FROM risks WHERE id = ?').get(id);
        if (!current) throw new HttpError(404, 'RISK_NOT_FOUND', 'The requested risk was not found.');
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
        db.prepare(`UPDATE risks SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).run(...keys.map((key) => values[key]), user.id, utcNow(), id);
        audit(db, { actorUserId: user.id, action: 'risk.updated', entityType: 'risk', entityId: id, ip, details: { fields: keys } });
        return sendJson(response, 200, { risk: db.prepare('SELECT r.*, probability * impact AS score FROM risks r WHERE id = ?').get(id) });
      }

      if (pathname === '/api/admin/users' && method === 'GET') {
        ensureRole(user, ['Admin']);
        const users = db.prepare('SELECT id, user_id, email, display_name, role, must_change_password, active, created_at, updated_at FROM users ORDER BY display_name').all();
        return sendJson(response, 200, { users: users.map(publicUser) });
      }

      if (pathname === '/api/admin/users' && method === 'POST') {
        ensureRole(user, ['Admin']);
        const body = await readJson(request);
        const role = nonEmptyText(body.role, 'Role', 20);
        if (!ROLES.has(role)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose Viewer, Editor, or Admin.');
        const temporaryPassword = body.temporaryPassword ? String(body.temporaryPassword) : generateTemporaryPassword();
        const userInfo = {
          userId: nonEmptyText(body.userId, 'User ID', 80),
          email: nonEmptyText(body.email, 'Email address', 254),
          displayName: nonEmptyText(body.displayName, 'Display name', 180),
        };
        const problems = passwordProblems(temporaryPassword, userInfo);
        if (problems.length) throw new HttpError(400, 'PASSWORD_WEAK', 'The temporary password does not meet the security requirements.', { problems });
        const now = utcNow();
        let result;
        try {
          result = db.prepare(`INSERT INTO users (user_id, email, display_name, password_hash, role, must_change_password, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`)
            .run(userInfo.userId, userInfo.email, userInfo.displayName, hashPassword(temporaryPassword), role, now, now);
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'USER_EXISTS', 'That user ID or email address is already in use.');
          throw error;
        }
        audit(db, { actorUserId: user.id, action: 'user.created', entityType: 'user', entityId: String(result.lastInsertRowid), ip, details: { role } });
        const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        return sendJson(response, 201, { user: publicUser(created), temporaryPassword });
      }

      const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
      if (userMatch && method === 'PATCH') {
        ensureRole(user, ['Admin']);
        const id = Number(userMatch[1]);
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
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
        if (removesAdmin && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin' AND active = 1").get().count <= 1) {
          throw new HttpError(400, 'LAST_ADMIN', 'Keep at least one active administrator account.');
        }
        const keys = Object.keys(values);
        if (!keys.length) throw new HttpError(400, 'NO_CHANGES', 'Provide a role or active state to update.');
        db.prepare(`UPDATE users SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((key) => values[key]), utcNow(), id);
        if (values.active === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        audit(db, { actorUserId: user.id, action: 'user.updated', entityType: 'user', entityId: String(id), ip, details: { fields: keys } });
        return sendJson(response, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
      }

      const resetMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
      if (resetMatch && method === 'POST') {
        ensureRole(user, ['Admin']);
        const id = Number(resetMatch[1]);
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'The requested user was not found.');
        const body = await readJson(request);
        const temporaryPassword = body.temporaryPassword ? String(body.temporaryPassword) : generateTemporaryPassword();
        const problems = passwordProblems(temporaryPassword, publicUser(target));
        if (problems.length) throw new HttpError(400, 'PASSWORD_WEAK', 'The temporary password does not meet the security requirements.', { problems });
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(hashPassword(temporaryPassword), utcNow(), id);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
          audit(db, { actorUserId: user.id, action: 'user.password_reset', entityType: 'user', entityId: String(id), ip });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return sendJson(response, 200, { temporaryPassword });
      }

      if (pathname === '/api/admin/audit' && method === 'GET') {
        ensureRole(user, ['Admin']);
        const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
        const logs = db.prepare(`
          SELECT a.*, COALESCE(u.display_name, 'System') AS actor_name
          FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT ?
        `).all(limit).map((row) => ({ ...row, details: JSON.parse(row.details_json || '{}') }));
        return sendJson(response, 200, { logs });
      }

      throw new HttpError(404, 'NOT_FOUND', 'The requested API endpoint was not found.');
    } catch (error) {
      sendError(response, error);
    }
  });
}
