import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['Viewer', 'Editor', 'Admin'] }).notNull(),
  mustChangePassword: integer('must_change_password').notNull().default(1),
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('users_user_id_unique').on(table.userId),
  uniqueIndex('users_email_unique').on(table.email),
]);

export const sessions = sqliteTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  passwordChangeRequired: integer('password_change_required').notNull().default(0),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, (table) => [index('idx_sessions_expires').on(table.expiresAt)]);

export const loginAttempts = sqliteTable('login_attempts', {
  attemptKey: text('attempt_key').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  windowStartedAt: text('window_started_at').notNull(),
  lockedUntil: text('locked_until'),
  updatedAt: text('updated_at').notNull(),
});

export const portfolios = sqliteTable('portfolios', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('portfolios_code_unique').on(table.code)]);

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  portfolioId: text('portfolio_id').notNull().references(() => portfolios.id),
  projectCode: text('project_code').notNull(),
  name: text('name').notNull(),
  phase: text('phase').notNull().default('Concept'),
  status: text('status').notNull().default('On track'),
  location: text('location').notNull().default(''),
  projectManager: text('project_manager').notNull().default(''),
  budget: real('budget').notNull().default(0),
  committedCost: real('committed_cost').notNull().default(0),
  actualCost: real('actual_cost').notNull().default(0),
  forecastCost: real('forecast_cost').notNull().default(0),
  percentComplete: real('percent_complete').notNull().default(0),
  startDate: text('start_date'),
  targetDate: text('target_date'),
  description: text('description').notNull().default(''),
  version: integer('version').notNull().default(1),
  createdBy: integer('created_by').references(() => users.id),
  updatedBy: integer('updated_by').references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('projects_project_code_unique').on(table.projectCode),
  index('idx_projects_portfolio').on(table.portfolioId),
  index('idx_projects_status').on(table.status),
  index('idx_projects_updated').on(table.updatedAt),
]);

export const developmentDetails = sqliteTable('development_details', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  planningStatus: text('planning_status').notNull().default('Not started'),
  designStatus: text('design_status').notNull().default('Not started'),
  procurementStatus: text('procurement_status').notNull().default('Not started'),
  constructionStatus: text('construction_status').notNull().default('Not started'),
  nextGate: text('next_gate').notNull().default(''),
  narrative: text('narrative').notNull().default(''),
  updatedBy: integer('updated_by').references(() => users.id),
  updatedAt: text('updated_at').notNull(),
});

export const projectUpdates = sqliteTable('project_updates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  previousStatus: text('previous_status'),
  newStatus: text('new_status'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_updates_project_created').on(table.projectId, table.createdAt)]);

export const costEntries = sqliteTable('cost_entries', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  description: text('description').notNull(),
  committed: real('committed').notNull().default(0),
  actual: real('actual').notNull().default(0),
  forecast: real('forecast').notNull().default(0),
  entryDate: text('entry_date').notNull(),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_costs_project_date').on(table.projectId, table.entryDate)]);

export const risks = sqliteTable('risks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  probability: integer('probability').notNull(),
  impact: integer('impact').notNull(),
  owner: text('owner').notNull().default(''),
  mitigation: text('mitigation').notNull().default(''),
  status: text('status', { enum: ['Open', 'Monitoring', 'Closed'] }).notNull().default('Open'),
  dueDate: text('due_date'),
  createdBy: integer('created_by').references(() => users.id),
  updatedBy: integer('updated_by').references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_risks_project_status').on(table.projectId, table.status)]);

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actorUserId: integer('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  ipAddress: text('ip_address').notNull().default(''),
  detailsJson: text('details_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_audit_created').on(table.createdAt),
  index('idx_audit_entity').on(table.entityType, table.entityId),
]);
