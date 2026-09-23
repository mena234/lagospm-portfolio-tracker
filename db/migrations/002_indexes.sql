CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_projects_portfolio ON projects(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_updates_project_created ON project_updates(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_costs_project_date ON cost_entries(project_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_risks_project_status ON risks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

