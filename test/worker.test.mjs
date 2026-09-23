import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import worker from '../worker/index.mjs';

const ORIGIN = 'https://lagospm.test';
const DEMO_PASSWORD = 'ChangeMe!2026#';

class D1Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.database, this.sql, params);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.params) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function createEnvironment() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const migration = await readFile(new URL('../drizzle/0000_overconfident_pet_avengers.sql', import.meta.url), 'utf8');
  database.exec(migration.replaceAll('--> statement-breakpoint', ''));
  return {
    database,
    env: {
      DB: new D1Database(database),
      ASSETS: {
        fetch: async () => new Response('<!doctype html><title>LagosPM</title>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      },
    },
  };
}

async function api(env, path, { method = 'GET', body, cookie, csrf } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD'].includes(method)) headers.set('origin', ORIGIN);
  if (cookie) headers.set('cookie', cookie);
  if (csrf) headers.set('x-csrf-token', csrf);
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, data };
}

async function signIn(env, identifier, changedPassword) {
  const login = await api(env, '/api/auth/login', {
    method: 'POST',
    body: { identifier, password: DEMO_PASSWORD },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.mustChangePassword, true);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];

  const blocked = await api(env, '/api/dashboard', { cookie });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.data.error.code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await api(env, '/api/auth/change-password', {
    method: 'POST',
    cookie,
    csrf: login.data.csrfToken,
    body: { currentPassword: DEMO_PASSWORD, newPassword: changedPassword },
  });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.user.mustChangePassword, false);
  return { cookie, csrf: changed.data.csrfToken, user: changed.data.user };
}

test('hosted worker enforces authentication, password change, and Viewer permissions', async (context) => {
  const { database, env } = await createEnvironment();
  context.after(() => database.close());

  const anonymous = await api(env, '/api/auth/session');
  assert.equal(anonymous.response.status, 401);

  const viewer = await signIn(env, 'viewer@lagospm.local', 'ClearRead!2040#');
  assert.equal(viewer.user.role, 'Viewer');

  const dashboard = await api(env, '/api/dashboard', { cookie: viewer.cookie });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.totals.project_count, 6);

  const forbidden = await api(env, '/api/projects', {
    method: 'POST',
    cookie: viewer.cookie,
    csrf: viewer.csrf,
    body: { portfolio_id: 'portfolio-capital', project_code: 'CAP-099', name: 'Viewer cannot create' },
  });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.data.error.code, 'FORBIDDEN');
});

test('Editor can create records while Admin can manage users and export', async (context) => {
  const { database, env } = await createEnvironment();
  context.after(() => database.close());

  const editor = await signIn(env, 'editor@lagospm.local', 'StrongWrite!2040#');
  assert.equal(editor.user.role, 'Editor');
  const created = await api(env, '/api/projects', {
    method: 'POST',
    cookie: editor.cookie,
    csrf: editor.csrf,
    body: {
      portfolio_id: 'portfolio-capital',
      project_code: 'CAP-099',
      name: 'Role permission verification',
      status: 'On track',
      phase: 'Concept',
      budget: 125000,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.project.project_code, 'CAP-099');

  const editorUsers = await api(env, '/api/admin/users', { cookie: editor.cookie });
  assert.equal(editorUsers.response.status, 403);

  const admin = await signIn(env, 'admin@lagospm.local', 'SecureLead!2040#');
  assert.equal(admin.user.role, 'Admin');
  const users = await api(env, '/api/admin/users', { cookie: admin.cookie });
  assert.equal(users.response.status, 200);
  assert.deepEqual(users.data.users.map((user) => user.role).sort(), ['Admin', 'Editor', 'Viewer']);

  const csv = await api(env, '/api/export/projects.csv', { cookie: admin.cookie });
  assert.equal(csv.response.status, 200);
  assert.match(csv.response.headers.get('content-type'), /text\/csv/u);
  assert.match(csv.data, /CAP-099/u);

  const risks = await api(env, '/api/risks', { cookie: admin.cookie });
  const risk = risks.data.risks[0];
  const updated = await api(env, `/api/risks/${risk.id}`, {
    method: 'PATCH',
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: { status: 'Closed' },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.risk.status, 'Closed');
});

test('demo bootstrap password always opens the change-password flow', async (context) => {
  const { database, env } = await createEnvironment();
  context.after(() => database.close());

  await signIn(env, 'admin@lagospm.local', 'SecureLead!2040#');
  const repeat = await api(env, '/api/auth/login', {
    method: 'POST',
    body: { identifier: 'admin@lagospm.local', password: DEMO_PASSWORD },
  });
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.data.user.role, 'Admin');
  assert.equal(repeat.data.user.mustChangePassword, true);
});

test('non-API requests are served by the static asset binding with security headers', async (context) => {
  const { database, env } = await createEnvironment();
  context.after(() => database.close());

  const response = await worker.fetch(new Request(`${ORIGIN}/projects`), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /LagosPM/u);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy').includes("default-src 'self'"), true);
});

test('the sign-in page does not publish demonstration account credentials', async (context) => {
  const { database, env } = await createEnvironment();
  context.after(() => database.close());

  const meta = await api(env, '/api/meta');
  assert.equal(meta.response.status, 200);
  assert.equal(Object.hasOwn(meta.data, 'demoAccounts'), false);

  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /demo-credentials|Demonstration accounts/u);
  assert.doesNotMatch(client, /demoAccounts|Demonstration accounts/u);
});
