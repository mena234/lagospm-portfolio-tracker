import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRuntime } from '../src/index.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'lagospm-test-'));
const runtime = buildRuntime({
  environment: 'test',
  databasePath: resolve(temporaryDirectory, 'test.sqlite'),
  migrationsDir: resolve(root, 'db', 'migrations'),
  publicDir: resolve(root, 'public'),
  host: '127.0.0.1',
  port: 0,
  seedDemoData: true,
  allowDemoCredentials: false,
  healthLocalOnly: true,
  trustProxy: false,
  initialAdminPassword: 'TestAdmin!2026#',
  demoPassword: 'TestDemo!2026#',
});

await new Promise((resolveListen) => runtime.server.listen(0, '127.0.0.1', resolveListen));
const baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;

test.after(async () => {
  await new Promise((resolveClose) => runtime.server.close(resolveClose));
  const resolvedTemp = resolve(temporaryDirectory);
  assert.ok(resolvedTemp.startsWith(resolve(tmpdir())), 'temporary test directory must remain under the system temp directory');
  rmSync(resolvedTemp, { recursive: true, force: true });
});

async function request(path, { method = 'GET', body, cookie, csrf } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = response.headers.get('content-type') ?? '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function loginAndChangePassword(identifier, initialPassword, nextPassword) {
  const login = await request('/api/auth/login', { method: 'POST', body: { identifier, password: initialPassword } });
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.user.mustChangePassword, true);
  const changed = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: login.cookie,
    csrf: login.payload.csrfToken,
    body: { currentPassword: initialPassword, newPassword: nextPassword },
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.payload.user.mustChangePassword, false);
  return { cookie: login.cookie, csrf: changed.payload.csrfToken, user: changed.payload.user };
}

test('health endpoint reports SQLite integrity', async () => {
  const { response, payload } = await request('/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual({ status: payload.status, database: payload.database }, { status: 'ok', database: 'ok' });
});

test('static application includes strict security headers', async () => {
  const { response, payload } = await request('/');
  assert.equal(response.status, 200);
  assert.match(payload, /LagosPM Project Tracker/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  const help = await request('/help/LagosPM-Help.pdf');
  assert.equal(help.response.status, 200);
  assert.equal(help.response.headers.get('content-type'), 'application/pdf');
  assert.ok(help.payload.length > 1_000);
});

test('authentication, forced password change, CSRF, project writes, and CSV export work', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: { identifier: 'admin@lagospm.local', password: 'TestAdmin!2026#' } });
  assert.equal(login.response.status, 200);

  const blocked = await request('/api/dashboard', { cookie: login.cookie });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.payload.error.code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: login.cookie,
    csrf: login.payload.csrfToken,
    body: { currentPassword: 'TestAdmin!2026#', newPassword: 'Harbor!Slate2026#' },
  });
  assert.equal(changed.response.status, 200);
  const admin = { cookie: login.cookie, csrf: changed.payload.csrfToken };

  const portfolios = await request('/api/portfolios', { cookie: admin.cookie });
  assert.equal(portfolios.response.status, 200);
  const portfolioId = portfolios.payload.portfolios[0].id;

  const withoutCsrf = await request('/api/projects', {
    method: 'POST',
    cookie: admin.cookie,
    body: { portfolio_id: portfolioId, project_code: 'TEST-001', name: 'CSRF rejection check' },
  });
  assert.equal(withoutCsrf.response.status, 403);
  assert.equal(withoutCsrf.payload.error.code, 'CSRF_INVALID');

  const created = await request('/api/projects', {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: {
      portfolio_id: portfolioId,
      project_code: 'TEST-001',
      name: 'Integration Test Project',
      phase: 'Design',
      status: 'Watch',
      budget: 120000,
      percent_complete: 35,
      description: 'A test record used to verify the complete write and audit path.',
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.project.version, 1);

  const conflict = await request(`/api/projects/${created.payload.project.id}`, {
    method: 'PATCH',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { version: 0, status: 'On track' },
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.error.code, 'PROJECT_CHANGED');

  const updated = await request(`/api/projects/${created.payload.project.id}`, {
    method: 'PATCH',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { version: 1, status: 'On track', percent_complete: 40 },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.project.version, 2);

  const activity = await request(`/api/projects/${created.payload.project.id}/activity`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { title: 'Gate review completed', body: 'The design gate was reviewed and accepted for the integration test.' },
  });
  assert.equal(activity.response.status, 201);

  const cost = await request(`/api/projects/${created.payload.project.id}/costs`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { category: 'Consultants', description: 'Design review', committed: 10000, actual: 8000, forecast: 10500, entry_date: '2026-09-04' },
  });
  assert.equal(cost.response.status, 201);
  assert.equal(cost.payload.project.forecast_cost, 10500);

  const risk = await request(`/api/projects/${created.payload.project.id}/risks`, {
    method: 'POST',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { title: 'Approval timing', description: 'Approval may arrive after the planned gate.', probability: 4, impact: 4, owner: 'Test Owner', mitigation: 'Hold a pre-review.', due_date: '2026-10-01' },
  });
  assert.equal(risk.response.status, 201);
  assert.equal(risk.payload.risk.score, 16);

  const detail = await request(`/api/projects/${created.payload.project.id}`, { cookie: admin.cookie });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.activity.length, 3);
  assert.equal(detail.payload.costs.length, 1);
  assert.equal(detail.payload.risks.length, 1);

  const csv = await request('/api/export/projects.csv', { cookie: admin.cookie });
  assert.equal(csv.response.status, 200);
  assert.match(csv.response.headers.get('content-type'), /text\/csv/);
  assert.match(csv.payload, /Integration Test Project/);

  const audit = await request('/api/admin/audit', { cookie: admin.cookie });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.payload.logs.some((entry) => entry.action === 'project.updated'));
});

test('Viewer role is enforced by the server', async () => {
  const viewer = await loginAndChangePassword('viewer@lagospm.local', 'TestDemo!2026#', 'Compass!Stone2026#');
  assert.equal(viewer.user.role, 'Viewer');
  const portfolios = await request('/api/portfolios', { cookie: viewer.cookie });
  assert.equal(portfolios.response.status, 200);
  const denied = await request('/api/projects', {
    method: 'POST',
    cookie: viewer.cookie,
    csrf: viewer.csrf,
    body: { portfolio_id: portfolios.payload.portfolios[0].id, project_code: 'NOPE-001', name: 'Denied write' },
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.payload.error.code, 'FORBIDDEN');
});

test('login throttling locks repeated invalid credentials', async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await request('/api/auth/login', { method: 'POST', body: { identifier: 'missing@example.com', password: 'WrongPassword!2026' } });
    assert.equal(result.response.status, 401);
  }
  const locked = await request('/api/auth/login', { method: 'POST', body: { identifier: 'missing@example.com', password: 'WrongPassword!2026' } });
  assert.equal(locked.response.status, 429);
  assert.equal(locked.payload.error.code, 'LOGIN_LOCKED');
});

test('long project narratives are preserved without truncation', () => {
  const row = runtime.db.prepare("SELECT description FROM projects WHERE project_code = 'DEV-001'").get();
  assert.ok(row.description.length > 300);
  assert.match(row.description, /without truncation/);

  const baseline = runtime.db.prepare(`
    SELECT p.committed_cost, p.actual_cost, p.forecast_cost,
      c.committed, c.actual, c.forecast
    FROM projects p JOIN cost_entries c ON c.project_id = p.id
    WHERE p.project_code = 'DEV-001'
  `).get();
  assert.deepEqual(
    [baseline.committed_cost, baseline.actual_cost, baseline.forecast_cost],
    [baseline.committed, baseline.actual, baseline.forecast],
  );
});
