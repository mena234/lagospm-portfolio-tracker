import { resolve } from 'node:path';

function booleanValue(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function integerValue(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function loadConfig(overrides = {}) {
  const environment = overrides.environment ?? process.env.NODE_ENV ?? 'development';
  const production = environment === 'production';
  const databasePath = overrides.databasePath ?? process.env.DATABASE_PATH ?? resolve('data', 'lagospm.sqlite');
  const initialAdminPassword = overrides.initialAdminPassword ?? process.env.INITIAL_ADMIN_PASSWORD ?? (production ? '' : 'ChangeMe!2026#');

  if (production && !initialAdminPassword) {
    throw new Error('INITIAL_ADMIN_PASSWORD is required on the first production start.');
  }

  return Object.freeze({
    environment,
    production,
    host: overrides.host ?? process.env.HOST ?? '127.0.0.1',
    port: overrides.port ?? integerValue(process.env.PORT, 3210, 1, 65535),
    databasePath,
    publicDir: overrides.publicDir ?? resolve('public'),
    migrationsDir: overrides.migrationsDir ?? resolve('db', 'migrations'),
    publicOrigin: overrides.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? '',
    trustProxy: overrides.trustProxy ?? booleanValue(process.env.TRUST_PROXY, production),
    healthLocalOnly: overrides.healthLocalOnly ?? booleanValue(process.env.HEALTH_LOCAL_ONLY, production),
    seedDemoData: overrides.seedDemoData ?? booleanValue(process.env.SEED_DEMO_DATA, !production),
    allowDemoCredentials: overrides.allowDemoCredentials ?? booleanValue(process.env.ALLOW_DEMO_CREDENTIALS, !production),
    sessionTtlHours: overrides.sessionTtlHours ?? integerValue(process.env.SESSION_TTL_HOURS, 8, 1, 72),
    initialAdmin: {
      userId: overrides.initialAdminUserId ?? process.env.INITIAL_ADMIN_USER_ID ?? 'tom.admin',
      email: overrides.initialAdminEmail ?? process.env.INITIAL_ADMIN_EMAIL ?? 'admin@lagospm.local',
      displayName: overrides.initialAdminName ?? process.env.INITIAL_ADMIN_NAME ?? 'Tom Administrator',
      password: initialAdminPassword,
    },
    demoPassword: overrides.demoPassword ?? process.env.DEMO_PASSWORD ?? 'ChangeMe!2026#',
  });
}

