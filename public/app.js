const STATUS_OPTIONS = ['On track', 'Watch', 'At risk', 'On hold', 'Complete'];
const PHASE_OPTIONS = ['Concept', 'Feasibility', 'Design', 'Procurement', 'Construction', 'Delivery', 'Closeout'];
const VIEW_LABELS = {
  overview: 'Portfolio',
  projects: 'Projects',
  pipeline: 'Pipeline',
  costs: 'Costs',
  risks: 'Risks',
  admin: 'Admin',
  help: 'Help',
};

const state = {
  csrfToken: '',
  user: null,
  portfolios: [],
  projects: [],
  filteredProjects: [],
  dashboard: null,
  risks: [],
  users: [],
  audit: [],
  currentView: 'overview',
  currentDetail: null,
  currentDetailTab: 'overview',
  commandItems: [],
  commandIndex: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat('en-NG', { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(includeTime || String(value).includes('T') ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('en-GB', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function announce(message) {
  $('#status-region').textContent = message;
}

function errorMessage(error) {
  if (error?.details?.problems?.length) return `${error.message} ${error.details.problems.join(' ')}`;
  return error?.message || 'The request could not be completed. Try again.';
}

async function api(path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD'].includes(method) && state.csrfToken) headers.set('X-CSRF-Token', state.csrfToken);
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = payload.error?.code;
    error.details = payload.error?.details;
    if (response.status === 401 && state.user) showSignedOut();
    throw error;
  }
  return payload;
}

async function runButton(button, task) {
  button.dataset.state = 'loading';
  button.disabled = true;
  try {
    return await task();
  } finally {
    delete button.dataset.state;
    button.disabled = false;
  }
}

function showFormError(element, error) {
  element.textContent = errorMessage(error);
  element.hidden = false;
}

function clearFormError(element) {
  element.textContent = '';
  element.hidden = true;
}

function showErrorToast(error, retry) {
  const stack = $('#toast-stack');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.tabIndex = 0;
  const text = document.createElement('span');
  text.textContent = errorMessage(error);
  toast.append(text);
  if (retry) {
    const button = document.createElement('button');
    button.className = 'button button--quiet';
    button.type = 'button';
    button.textContent = 'Try again';
    button.addEventListener('click', async () => {
      toast.remove();
      try { await retry(); } catch (nextError) { showErrorToast(nextError, retry); }
    });
    toast.append(button);
  }
  stack.append(toast);
  toast.focus();
  setTimeout(() => toast.remove(), 8000);
}

function showTemporaryPassword(label, password) {
  const stack = $('#toast-stack');
  const toast = document.createElement('div');
  toast.className = 'toast toast--credential';
  toast.tabIndex = 0;
  const text = document.createElement('span');
  text.innerHTML = `<strong>${escapeHtml(label)}</strong><br><code>${escapeHtml(password)}</code><br><small>Copy it now. It will not be shown again.</small>`;
  const button = document.createElement('button');
  button.className = 'button button--quiet';
  button.type = 'button';
  button.textContent = 'Copy password';
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(password);
    button.textContent = 'Copied';
    button.dataset.state = 'success';
    setTimeout(() => { button.textContent = 'Copy password'; delete button.dataset.state; }, 2500);
  });
  toast.append(text, button);
  stack.append(toast);
  toast.focus();
}

function options(values, selected = '') {
  return values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

function statusBadge(status) {
  return `<span class="status-badge" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function riskScore(score) {
  const level = score >= 16 ? 'high' : score >= 8 ? 'medium' : 'low';
  return `<span class="score" data-level="${level}">Score ${formatNumber(score)}</span>`;
}

function emptyState(title, detail, action = '') {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p>${action}</div>`;
}

function setRoleVisibility() {
  const admin = state.user?.role === 'Admin';
  const editor = admin || state.user?.role === 'Editor';
  $$('.admin-only').forEach((element) => { element.hidden = !admin; });
  $$('.editor-only').forEach((element) => { element.hidden = !editor; });
}

function showSignedOut() {
  state.user = null;
  state.csrfToken = '';
  $('#application').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-form').reset();
  announce('Your session ended. Sign in again.');
}

async function boot() {
  try {
    const session = await api('/api/auth/session');
    state.user = session.user;
    state.csrfToken = session.csrfToken;
    if (state.user.mustChangePassword) return openPasswordDialog();
    await enterApplication();
  } catch (error) {
    if (error.status !== 401) showErrorToast(error);
  }
}

async function enterApplication() {
  $('#login-screen').hidden = true;
  $('#application').hidden = false;
  $('#account-name').textContent = state.user.displayName;
  $('#account-role').textContent = state.user.role;
  setRoleVisibility();
  await loadCoreData();
  const view = location.hash.slice(1);
  showView(VIEW_LABELS[view] && (view !== 'admin' || state.user.role === 'Admin') ? view : 'overview');
}

async function loadCoreData() {
  const [dashboardPayload, portfolioPayload, projectPayload, riskPayload] = await Promise.all([
    api('/api/dashboard'),
    api('/api/portfolios'),
    api('/api/projects?limit=200&sort=updated'),
    api('/api/risks'),
  ]);
  state.dashboard = dashboardPayload;
  state.portfolios = portfolioPayload.portfolios;
  state.projects = projectPayload.projects;
  state.filteredProjects = projectPayload.projects;
  state.risks = riskPayload.risks;
  fillFilters();
  fillProjectFormOptions();
  renderAll();
}

window.__LAGOSPM_REFRESH__ = async () => {
  if (!state.user) return;
  const detailId = state.currentDetail?.project?.id;
  const detailTab = state.currentDetailTab;
  await loadCoreData();
  if (detailId && $('#detail-dialog').open) await openProjectDetail(detailId, detailTab);
};

function renderAll() {
  renderOverview();
  renderProjects();
  renderPipeline();
  renderCosts();
  renderRisks();
}

function renderOverview() {
  const { totals, statuses, openRisks, portfolios, recent } = state.dashboard;
  const variance = Number(totals.forecast) - Number(totals.budget);
  const maxStatus = Math.max(1, ...statuses.map((item) => Number(item.count)));
  const statusRows = statuses.map((item) => `<li class="bar-row"><span>${escapeHtml(item.status)}</span><span class="bar-track" aria-hidden="true"><span style="--bar-value:${Math.round(Number(item.count) / maxStatus * 100)}"></span></span><strong>${formatNumber(item.count)}</strong></li>`).join('');
  const activity = recent.length
    ? recent.map((item) => `<li class="activity-item"><button class="table-link" type="button" data-project-id="${escapeHtml(item.project_id)}">${escapeHtml(item.title)}</button><span class="table-meta">${escapeHtml(item.project_code)} · ${escapeHtml(item.project_name)}</span><p>${escapeHtml(item.body)}</p><p class="activity-item__meta">${escapeHtml(item.author)} · ${formatDate(item.created_at, true)}</p></li>`).join('')
    : emptyState('No activity yet', 'Project updates will appear here after an editor records the first decision.');
  const portfolioRows = portfolios.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td><td class="tnum">${formatNumber(item.project_count)}</td><td class="tnum">${formatNumber(item.budget)}</td><td class="tnum">${formatNumber(item.forecast)}</td><td class="tnum">${formatNumber(Number(item.forecast) - Number(item.budget))}</td></tr>`).join('');

  $('#overview-content').className = '';
  $('#overview-content').removeAttribute('aria-busy');
  $('#overview-content').innerHTML = `
    <div class="metrics">
      <article class="metric"><span class="metric__label">Projects</span><strong class="metric__value">${formatNumber(totals.project_count)}</strong></article>
      <article class="metric"><span class="metric__label">Approved budget</span><strong class="metric__value">${formatNumber(totals.budget)}</strong></article>
      <article class="metric"><span class="metric__label">Forecast variance</span><strong class="metric__value">${variance > 0 ? '+' : ''}${formatNumber(variance)}</strong></article>
      <article class="metric"><span class="metric__label">Open risks · high</span><strong class="metric__value">${formatNumber(openRisks.count)} · ${formatNumber(openRisks.high)}</strong></article>
    </div>
    <div class="overview-grid">
      <section class="panel" aria-labelledby="status-heading"><header class="section-heading"><h2 id="status-heading">Delivery status</h2><span class="table-meta">${formatNumber(totals.average_complete, 1)}% mean completion</span></header><ul class="bar-list">${statusRows || '<li>No projects</li>'}</ul></section>
      <section class="panel" aria-labelledby="activity-heading"><header class="section-heading"><h2 id="activity-heading">Recent activity</h2></header><ul class="activity-list">${activity}</ul></section>
    </div>
    <section class="panel" aria-labelledby="portfolio-summary-heading"><header class="section-heading"><h2 id="portfolio-summary-heading">Portfolio summary</h2></header>
      <div class="table-wrap"><table class="responsive-table"><thead><tr><th>Code</th><th>Portfolio</th><th>Projects</th><th>Budget</th><th>Forecast</th><th>Variance</th></tr></thead><tbody>${portfolioRows}</tbody></table></div>
    </section>`;
  $('#overview-updated').textContent = `Loaded ${formatDate(new Date().toISOString(), true)}`;
}

function projectRows(projects) {
  return projects.map((project) => `
    <tr>
      <td data-label="Project"><button class="table-link" type="button" data-project-id="${escapeHtml(project.id)}">${escapeHtml(project.name)}</button><span class="table-meta">${escapeHtml(project.project_code)}</span></td>
      <td data-label="Portfolio">${escapeHtml(project.portfolio_code)}</td>
      <td data-label="Phase">${escapeHtml(project.phase)}</td>
      <td data-label="Status">${statusBadge(project.status)}</td>
      <td data-label="Manager">${escapeHtml(project.project_manager || '—')}</td>
      <td data-label="Complete" class="tnum">${formatNumber(project.percent_complete)}%</td>
      <td data-label="Budget" class="tnum">${formatNumber(project.budget)}</td>
      <td data-label="Forecast" class="tnum">${formatNumber(project.forecast_cost)}</td>
      <td data-label="Target">${formatDate(project.target_date)}</td>
    </tr>`).join('');
}

function renderProjects() {
  const container = $('#project-register');
  if (!state.filteredProjects.length) {
    container.innerHTML = emptyState('No matching projects', 'Change the filters or add a project to this portfolio.', state.user.role !== 'Viewer' ? '<button class="button button--primary" type="button" data-action="add-project">Add project</button>' : '');
    return;
  }
  container.innerHTML = `<p class="table-meta">${formatNumber(state.filteredProjects.length)} project record${state.filteredProjects.length === 1 ? '' : 's'}</p><div class="table-wrap"><table class="responsive-table"><thead><tr><th>Project</th><th>Portfolio</th><th>Phase</th><th>Status</th><th>Manager</th><th>Complete</th><th>Budget</th><th>Forecast</th><th>Target</th></tr></thead><tbody>${projectRows(state.filteredProjects)}</tbody></table></div>`;
}

function renderPipeline() {
  const phases = PHASE_OPTIONS.map((phase) => ({ phase, projects: state.projects.filter((project) => project.phase === phase) })).filter((group) => group.projects.length);
  $('#pipeline-content').innerHTML = phases.length ? `<div class="pipeline-board">${phases.map((group) => `<section class="pipeline-column"><header><h2>${escapeHtml(group.phase)}</h2><span class="badge">${group.projects.length}</span></header>${group.projects.map((project) => `<article class="pipeline-card"><button type="button" data-project-id="${escapeHtml(project.id)}">${escapeHtml(project.project_code)} · ${escapeHtml(project.name)}</button><div class="risk-card__meta">${statusBadge(project.status)}<span>${escapeHtml(project.project_manager || 'Unassigned')}</span></div><div class="progress" aria-label="${formatNumber(project.percent_complete)} percent complete"><span style="--progress:${Number(project.percent_complete)}"></span></div></article>`).join('')}</section>`).join('')}</div>` : emptyState('No pipeline records', 'Projects will group here after phases are assigned.');
}

function renderCosts() {
  const ordered = [...state.projects].sort((a, b) => Number(b.forecast_variance) - Number(a.forecast_variance));
  $('#cost-content').innerHTML = ordered.length ? `<div class="cost-grid">${ordered.map((project) => `<article class="cost-summary"><div><button class="table-link" type="button" data-project-id="${escapeHtml(project.id)}">${escapeHtml(project.name)}</button><p class="table-meta">${escapeHtml(project.project_code)} · ${escapeHtml(project.portfolio_code)}</p><p>${statusBadge(project.status)}</p></div><dl class="cost-summary__numbers tnum"><div><dt class="muted">Budget</dt><dd>${formatNumber(project.budget)}</dd></div><div><dt class="muted">Forecast</dt><dd>${formatNumber(project.forecast_cost)}</dd></div><div><dt class="muted">Variance</dt><dd>${Number(project.forecast_variance) > 0 ? '+' : ''}${formatNumber(project.forecast_variance)}</dd></div></dl></article>`).join('')}</div>` : emptyState('No cost records', 'Add projects before recording commitments, actuals, and forecasts.');
}

function renderRisks() {
  const canEdit = state.user.role !== 'Viewer';
  $('#risk-content').innerHTML = state.risks.length ? `<div class="risk-list">${state.risks.map((risk) => `<article class="risk-card"><header class="risk-card__head"><div><h2>${escapeHtml(risk.title)}</h2><button class="table-link" type="button" data-project-id="${escapeHtml(risk.project_id)}">${escapeHtml(risk.project_code)} · ${escapeHtml(risk.project_name)}</button></div>${riskScore(risk.score)}</header><p>${escapeHtml(risk.description || 'No description recorded.')}</p><div class="risk-card__meta"><span>Owner: ${escapeHtml(risk.owner || 'Unassigned')}</span><span>Due: ${formatDate(risk.due_date)}</span><span>Probability ${risk.probability} · Impact ${risk.impact}</span></div><label class="field field--compact"><span class="field__label">Risk status</span><select class="risk-status" data-risk-id="${escapeHtml(risk.id)}" ${canEdit ? '' : 'disabled'}>${options(['Open', 'Monitoring', 'Closed'], risk.status)}</select></label></article>`).join('')}</div>` : emptyState('No risks recorded', 'Open a project and add its first risk from the Risks tab.');
}

function fillFilters() {
  const form = $('#project-filters');
  form.elements.status.innerHTML = `<option value="">All statuses</option>${options(STATUS_OPTIONS)}`;
  form.elements.phase.innerHTML = `<option value="">All phases</option>${options(PHASE_OPTIONS)}`;
}

function fillProjectFormOptions() {
  const form = $('#project-form');
  form.elements.portfolio_id.innerHTML = state.portfolios.map((portfolio) => `<option value="${escapeHtml(portfolio.id)}">${escapeHtml(portfolio.code)} · ${escapeHtml(portfolio.name)}</option>`).join('');
  form.elements.phase.innerHTML = options(PHASE_OPTIONS, 'Concept');
  form.elements.status.innerHTML = options(STATUS_OPTIONS, 'On track');
}

function showView(view) {
  if (view === 'admin' && state.user.role !== 'Admin') view = 'overview';
  state.currentView = view;
  $$('.view').forEach((element) => { element.hidden = element.id !== `view-${view}`; });
  $$('.nav-item').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${view}`);
  $('#workspace').focus({ preventScroll: true });
  if (view === 'admin') loadAdmin().catch(showErrorToast);
}

function openProjectForm(project = null) {
  const form = $('#project-form');
  form.reset();
  fillProjectFormOptions();
  clearFormError($('#project-error'));
  $('#project-dialog-title').textContent = project ? 'Edit project' : 'Add project';
  if (project) {
    for (const [key, value] of Object.entries(project)) {
      if (form.elements[key]) form.elements[key].value = value ?? '';
    }
  } else {
    form.elements.id.value = '';
    form.elements.version.value = '';
    form.elements.phase.value = 'Concept';
    form.elements.status.value = 'On track';
  }
  $('#project-dialog').showModal();
  form.elements.project_code.focus();
}

async function openProjectDetail(projectId, tab = 'overview') {
  state.currentDetail = await api(`/api/projects/${encodeURIComponent(projectId)}`);
  state.currentDetailTab = tab;
  const { project } = state.currentDetail;
  $('#detail-code').textContent = `${project.project_code} · ${project.portfolio_name}`;
  $('#detail-title').textContent = project.name;
  $('#detail-summary').innerHTML = `${statusBadge(project.status)} <span class="muted">${escapeHtml(project.phase)} · ${escapeHtml(project.location || 'Location not recorded')}</span>`;
  renderDetailTabs();
  renderDetail();
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

function renderDetailTabs() {
  const tabs = [
    ['overview', 'Overview'],
    ['development', 'Development'],
    ['costs', 'Costs'],
    ['risks', 'Risks'],
    ['history', 'History'],
  ];
  $('#detail-tabs').innerHTML = tabs.map(([id, label]) => `<button class="tab" type="button" role="tab" data-detail-tab="${id}" aria-selected="${state.currentDetailTab === id}">${label}</button>`).join('');
}

function renderDetail() {
  const detail = state.currentDetail;
  const canEdit = state.user.role !== 'Viewer';
  const container = $('#detail-content');
  renderDetailTabs();
  if (state.currentDetailTab === 'overview') {
    container.innerHTML = `<section class="detail-section"><div class="detail-overview"><div><h3>Project description</h3><p>${escapeHtml(detail.project.description || 'No description recorded.')}</p></div><dl class="definition-grid"><div><dt>Manager</dt><dd>${escapeHtml(detail.project.project_manager || 'Unassigned')}</dd></div><div><dt>Complete</dt><dd>${formatNumber(detail.project.percent_complete)}%</dd></div><div><dt>Start</dt><dd>${formatDate(detail.project.start_date)}</dd></div><div><dt>Target</dt><dd>${formatDate(detail.project.target_date)}</dd></div><div><dt>Budget</dt><dd class="tnum">${formatNumber(detail.project.budget)}</dd></div><div><dt>Forecast</dt><dd class="tnum">${formatNumber(detail.project.forecast_cost)}</dd></div><div><dt>Variance</dt><dd class="tnum">${Number(detail.project.forecast_variance) > 0 ? '+' : ''}${formatNumber(detail.project.forecast_variance)}</dd></div><div><dt>Version</dt><dd>${detail.project.version}</dd></div></dl></div>${canEdit ? '<button class="button button--primary" type="button" data-action="edit-project">Edit project</button>' : ''}</section>`;
  } else if (state.currentDetailTab === 'development') {
    const development = detail.development ?? {};
    container.innerHTML = `<section class="detail-section"><form id="development-form" class="inline-form"><div class="form-grid">${['planning_status', 'design_status', 'procurement_status', 'construction_status'].map((field) => `<label class="field"><span class="field__label">${field.replace('_', ' ').replace(/^./, (value) => value.toUpperCase())}</span><input name="${field}" value="${escapeHtml(development[field] || '')}" ${canEdit ? '' : 'disabled'}></label>`).join('')}<label class="field field--span"><span class="field__label">Next gate</span><input name="next_gate" value="${escapeHtml(development.next_gate || '')}" ${canEdit ? '' : 'disabled'}></label><label class="field field--span"><span class="field__label">Development narrative</span><textarea name="narrative" rows="8" ${canEdit ? '' : 'disabled'}>${escapeHtml(development.narrative || '')}</textarea></label></div>${canEdit ? '<button class="button button--primary" type="submit">Save development details</button>' : ''}</form></section>`;
  } else if (state.currentDetailTab === 'costs') {
    const rows = detail.costs.map((cost) => `<tr><td data-label="Date">${formatDate(cost.entry_date)}</td><td data-label="Category">${escapeHtml(cost.category)}</td><td data-label="Description">${escapeHtml(cost.description)}</td><td data-label="Committed" class="tnum">${formatNumber(cost.committed)}</td><td data-label="Actual" class="tnum">${formatNumber(cost.actual)}</td><td data-label="Forecast" class="tnum">${formatNumber(cost.forecast)}</td></tr>`).join('');
    container.innerHTML = `<section class="detail-section">${rows ? `<div class="table-wrap"><table class="responsive-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Committed</th><th>Actual</th><th>Forecast</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('No cost entries', 'Add a cost entry to calculate committed, actual, and forecast totals.')} ${canEdit ? `<form id="cost-form" class="inline-form"><h3>Add cost entry</h3><div class="form-grid"><label class="field"><span class="field__label">Category</span><input name="category" required maxlength="120"></label><label class="field"><span class="field__label">Entry date</span><input name="entry_date" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label><label class="field field--span"><span class="field__label">Description</span><input name="description" required maxlength="500"></label><label class="field"><span class="field__label">Committed</span><input name="committed" type="number" min="0" step="0.01" value="0"></label><label class="field"><span class="field__label">Actual</span><input name="actual" type="number" min="0" step="0.01" value="0"></label><label class="field"><span class="field__label">Forecast</span><input name="forecast" type="number" min="0" step="0.01" value="0"></label></div><button class="button button--primary" type="submit">Add cost entry</button></form>` : ''}</section>`;
  } else if (state.currentDetailTab === 'risks') {
    const riskCards = detail.risks.map((risk) => `<article class="risk-card"><header class="risk-card__head"><h3>${escapeHtml(risk.title)}</h3>${riskScore(risk.score)}</header><p>${escapeHtml(risk.description || 'No description recorded.')}</p><p><strong>Mitigation:</strong> ${escapeHtml(risk.mitigation || 'Not recorded.')}</p><div class="risk-card__meta"><span>Owner: ${escapeHtml(risk.owner || 'Unassigned')}</span><span>Due: ${formatDate(risk.due_date)}</span></div><label class="field"><span class="field__label">Status</span><select class="risk-status" data-risk-id="${escapeHtml(risk.id)}" ${canEdit ? '' : 'disabled'}>${options(['Open', 'Monitoring', 'Closed'], risk.status)}</select></label></article>`).join('');
    container.innerHTML = `<section class="detail-section"><div class="risk-list">${riskCards || emptyState('No risks recorded', 'Add a risk with a probability, impact, owner, and mitigation.')}</div>${canEdit ? `<form id="risk-form" class="inline-form"><h3>Add risk</h3><div class="form-grid"><label class="field field--span"><span class="field__label">Risk title</span><input name="title" required maxlength="180"></label><label class="field field--span"><span class="field__label">Description</span><textarea name="description" rows="3"></textarea></label><label class="field"><span class="field__label">Probability</span><select name="probability">${options(['1', '2', '3', '4', '5'], '3')}</select></label><label class="field"><span class="field__label">Impact</span><select name="impact">${options(['1', '2', '3', '4', '5'], '3')}</select></label><label class="field"><span class="field__label">Owner</span><input name="owner" maxlength="120"></label><label class="field"><span class="field__label">Due date</span><input name="due_date" type="date"></label><label class="field field--span"><span class="field__label">Mitigation</span><textarea name="mitigation" rows="3"></textarea></label></div><button class="button button--primary" type="submit">Add risk</button></form>` : ''}</section>`;
  } else {
    const activity = detail.activity.map((item) => `<li class="activity-item"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><p class="activity-item__meta">${escapeHtml(item.author)} · ${formatDate(item.created_at, true)}</p></li>`).join('');
    container.innerHTML = `<section class="detail-section"><ul class="activity-list">${activity || emptyState('No history recorded', 'Add a dated update after a decision or delivery change.')}</ul>${canEdit ? '<form id="activity-form" class="inline-form"><h3>Add dated update</h3><label class="field"><span class="field__label">Update title</span><input name="title" required maxlength="180"></label><label class="field"><span class="field__label">Update detail</span><textarea name="body" required rows="4"></textarea></label><button class="button button--primary" type="submit">Add update</button></form>' : ''}</section>`;
  }
}

async function refreshAfterChange(projectId, tab) {
  await loadCoreData();
  if (projectId) await openProjectDetail(projectId, tab);
}

async function handleDetailSubmit(form) {
  const button = $('button[type="submit"]', form);
  const projectId = state.currentDetail.project.id;
  await runButton(button, async () => {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'development-form') await api(`/api/projects/${encodeURIComponent(projectId)}/development`, { method: 'PUT', body: data });
    if (form.id === 'cost-form') await api(`/api/projects/${encodeURIComponent(projectId)}/costs`, { method: 'POST', body: data });
    if (form.id === 'risk-form') await api(`/api/projects/${encodeURIComponent(projectId)}/risks`, { method: 'POST', body: data });
    if (form.id === 'activity-form') await api(`/api/projects/${encodeURIComponent(projectId)}/activity`, { method: 'POST', body: data });
    await refreshAfterChange(projectId, state.currentDetailTab);
    announce('Project record updated.');
  });
}

async function updateRisk(select) {
  const previous = state.risks.find((risk) => risk.id === select.dataset.riskId)?.status;
  try {
    await api(`/api/risks/${encodeURIComponent(select.dataset.riskId)}`, { method: 'PATCH', body: { status: select.value } });
    const projectId = state.currentDetail?.risks.some((risk) => risk.id === select.dataset.riskId) ? state.currentDetail.project.id : null;
    await refreshAfterChange(projectId, state.currentDetailTab);
  } catch (error) {
    if (previous) select.value = previous;
    showErrorToast(error, () => updateRisk(select));
  }
}

async function loadAdmin() {
  const [usersPayload, auditPayload] = await Promise.all([api('/api/admin/users'), api('/api/admin/audit?limit=80')]);
  state.users = usersPayload.users;
  state.audit = auditPayload.logs;
  renderAdmin();
}

function renderAdmin() {
  $('#user-directory').innerHTML = `<div class="user-list">${state.users.map((user) => `<article class="user-card"><header class="user-card__head"><div><h3>${escapeHtml(user.displayName)}</h3><p class="muted">${escapeHtml(user.userId)} · ${escapeHtml(user.email)}</p></div><span class="badge">${escapeHtml(user.role)}</span></header><p>${user.active ? 'Active' : 'Inactive'}${user.mustChangePassword ? ' · Password change required' : ''}</p><div class="user-actions"><button class="button button--quiet" type="button" data-user-reset="${user.id}" data-user-label="${escapeHtml(user.userId)}">Reset password</button><button class="button button--quiet" type="button" data-user-toggle="${user.id}" data-user-active="${user.active}">${user.active ? 'Deactivate' : 'Activate'}</button></div></article>`).join('')}</div>`;
  $('#audit-log').innerHTML = `<div class="audit-list">${state.audit.map((entry) => `<article class="audit-item"><strong>${escapeHtml(entry.action)}</strong><span>${escapeHtml(entry.actor_name)} · ${escapeHtml(entry.entity_type)}${entry.entity_id ? ` · ${escapeHtml(entry.entity_id)}` : ''}</span><span class="audit-item__meta">${formatDate(entry.created_at, true)} · ${escapeHtml(entry.ip_address || 'local')}</span></article>`).join('')}</div>`;
}

function openPasswordDialog() {
  const dialog = $('#password-dialog');
  if (!dialog.open) dialog.showModal();
  $('#password-form').elements.currentPassword.focus();
}

function passwordGuidance(value) {
  const checks = [value.length >= 12, /[a-z]/.test(value), /[A-Z]/.test(value), /[0-9]/.test(value), /[^A-Za-z0-9\s]/.test(value), !/\s/.test(value)];
  return checks.every(Boolean) ? 'Password meets the local strength rules.' : 'Use 12+ characters with upper and lowercase letters, a number, a symbol, and no spaces.';
}

function commandItems() {
  const views = Object.entries(VIEW_LABELS)
    .filter(([id]) => id !== 'admin' || state.user.role === 'Admin')
    .map(([id, label]) => ({ type: 'view', id, title: label, meta: 'Open view' }));
  const projects = state.projects.map((project) => ({ type: 'project', id: project.id, title: project.name, meta: `${project.project_code} · ${project.phase} · ${project.status}` }));
  return [...views, ...projects];
}

function renderCommands(query = '') {
  const search = query.trim().toLowerCase();
  state.commandItems = commandItems().filter((item) => !search || `${item.title} ${item.meta}`.toLowerCase().includes(search)).slice(0, 30);
  state.commandIndex = Math.min(state.commandIndex, Math.max(0, state.commandItems.length - 1));
  const groups = { view: 'Views', project: 'Projects' };
  let lastType = '';
  $('#command-results').innerHTML = state.commandItems.length ? state.commandItems.map((item, index) => {
    const heading = item.type !== lastType ? `<p class="command-group">${groups[item.type]}</p>` : '';
    lastType = item.type;
    return `${heading}<button class="command-item${index === state.commandIndex ? ' is-active' : ''}" type="button" role="option" aria-selected="${index === state.commandIndex}" data-command-index="${index}"><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.meta)}</small></button>`;
  }).join('') : emptyState('No matches', 'Try a project code, project name, or view.');
}

function openCommandDialog() {
  state.commandIndex = 0;
  renderCommands('');
  $('#command-dialog').showModal();
  $('#command-input').value = '';
  $('#command-input').focus();
}

async function executeCommand(index) {
  const item = state.commandItems[index];
  if (!item) return;
  $('#command-dialog').close();
  if (item.type === 'view') showView(item.id);
  else await openProjectDetail(item.id);
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = $('#login-error');
  clearFormError(errorElement);
  if (!form.reportValidity()) return;
  const button = $('button[type="submit"]', form);
  try {
    const payload = await runButton(button, () => api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) }));
    state.user = payload.user;
    state.csrfToken = payload.csrfToken;
    if (state.user.mustChangePassword) openPasswordDialog(); else await enterApplication();
  } catch (error) {
    showFormError(errorElement, error);
  }
});

$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = $('#password-error');
  clearFormError(errorElement);
  if (!form.reportValidity()) return;
  if (form.elements.newPassword.value !== form.elements.confirmPassword.value) return showFormError(errorElement, new Error('The confirmation does not match the new password.'));
  const button = $('button[type="submit"]', form);
  try {
    const payload = await runButton(button, () => api('/api/auth/change-password', { method: 'POST', body: { currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value } }));
    state.user = payload.user;
    state.csrfToken = payload.csrfToken;
    $('#password-dialog').close();
    form.reset();
    await enterApplication();
  } catch (error) {
    showFormError(errorElement, error);
  }
});

$('#new-password').addEventListener('input', (event) => {
  const guidance = $('#password-guidance');
  guidance.textContent = passwordGuidance(event.currentTarget.value);
  event.currentTarget.closest('.field').classList.toggle('is-success', guidance.textContent.startsWith('Password meets'));
});

$('#sign-out').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (error) { if (error.status !== 401) showErrorToast(error); }
  showSignedOut();
});

$('#primary-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) showView(button.dataset.view);
});

document.addEventListener('click', async (event) => {
  const navLink = event.target.closest('[data-nav-view]');
  if (navLink) { event.preventDefault(); showView(navLink.dataset.navView); }
  const projectButton = event.target.closest('[data-project-id]');
  if (projectButton) {
    try { await openProjectDetail(projectButton.dataset.projectId); } catch (error) { showErrorToast(error, () => openProjectDetail(projectButton.dataset.projectId)); }
  }
  const addProject = event.target.closest('[data-action="add-project"]');
  if (addProject) openProjectForm();
  const closeButton = event.target.closest('[data-close-dialog]');
  if (closeButton) closeButton.closest('dialog').close();
});

$('#create-project').addEventListener('click', () => openProjectForm());

$('#project-filters').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (String(value).trim()) params.set(key, String(value));
  try {
    const payload = await api(`/api/projects?limit=200&${params}`);
    state.filteredProjects = payload.projects;
    renderProjects();
  } catch (error) {
    showErrorToast(error);
  }
});

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = $('#project-error');
  clearFormError(errorElement);
  if (!form.reportValidity()) return;
  const body = Object.fromEntries(new FormData(form));
  for (const key of ['budget', 'percent_complete', 'version']) if (body[key] !== '') body[key] = Number(body[key]); else delete body[key];
  const id = body.id;
  delete body.id;
  const button = $('button[type="submit"]', form);
  try {
    await runButton(button, () => api(id ? `/api/projects/${encodeURIComponent(id)}` : '/api/projects', { method: id ? 'PATCH' : 'POST', body }));
    $('#project-dialog').close();
    await refreshAfterChange(id || null, 'overview');
    announce(id ? 'Project saved.' : 'Project created.');
  } catch (error) {
    showFormError(errorElement, error);
  }
});

$('#detail-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-detail-tab]');
  if (!button) return;
  state.currentDetailTab = button.dataset.detailTab;
  renderDetail();
});

$('#detail-content').addEventListener('click', (event) => {
  if (event.target.closest('[data-action="edit-project"]')) openProjectForm(state.currentDetail.project);
});

$('#detail-content').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await handleDetailSubmit(event.target); } catch (error) { showErrorToast(error, () => handleDetailSubmit(event.target)); }
});

document.addEventListener('change', (event) => {
  const select = event.target.closest('[data-risk-id]');
  if (select) updateRisk(select);
});

$('#create-user').addEventListener('click', () => {
  $('#user-form').reset();
  clearFormError($('#user-error'));
  $('#user-dialog').showModal();
  $('#user-form').elements.displayName.focus();
});

$('#user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = $('#user-error');
  clearFormError(errorElement);
  if (!form.reportValidity()) return;
  const button = $('button[type="submit"]', form);
  try {
    const payload = await runButton(button, () => api('/api/admin/users', { method: 'POST', body: Object.fromEntries(new FormData(form)) }));
    $('#user-dialog').close();
    showTemporaryPassword(`Temporary password for ${payload.user.userId}`, payload.temporaryPassword);
    await loadAdmin();
  } catch (error) {
    showFormError(errorElement, error);
  }
});

$('#user-directory').addEventListener('click', async (event) => {
  const reset = event.target.closest('[data-user-reset]');
  const toggle = event.target.closest('[data-user-toggle]');
  try {
    if (reset) {
      const answer = window.prompt(`Type ${reset.dataset.userLabel} to issue a new temporary password.`);
      if (answer !== reset.dataset.userLabel) return;
      const payload = await api(`/api/admin/users/${reset.dataset.userReset}/reset-password`, { method: 'POST', body: {} });
      showTemporaryPassword(`Temporary password for ${reset.dataset.userLabel}`, payload.temporaryPassword);
      await loadAdmin();
    }
    if (toggle) {
      await api(`/api/admin/users/${toggle.dataset.userToggle}`, { method: 'PATCH', body: { active: toggle.dataset.userActive !== 'true' } });
      await loadAdmin();
    }
  } catch (error) {
    showErrorToast(error);
  }
});

$('#command-trigger').addEventListener('click', openCommandDialog);
$('#command-input').addEventListener('input', (event) => { state.commandIndex = 0; renderCommands(event.currentTarget.value); });
$('#command-input').addEventListener('keydown', async (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); state.commandIndex = Math.min(state.commandItems.length - 1, state.commandIndex + 1); renderCommands(event.currentTarget.value); }
  if (event.key === 'ArrowUp') { event.preventDefault(); state.commandIndex = Math.max(0, state.commandIndex - 1); renderCommands(event.currentTarget.value); }
  if (event.key === 'Enter') { event.preventDefault(); await executeCommand(state.commandIndex); }
  $('.command-item.is-active')?.scrollIntoView({ block: 'nearest' });
});
$('#command-results').addEventListener('click', (event) => {
  const button = event.target.closest('[data-command-index]');
  if (button) executeCommand(Number(button.dataset.commandIndex)).catch(showErrorToast);
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (state.user && !state.user.mustChangePassword) openCommandDialog();
  }
});

$$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog && !dialog.matches('#password-dialog')) dialog.close();
}));

window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (state.user && VIEW_LABELS[view]) showView(view);
});

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const register = (tool) => Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
  register({
    name: 'read_portfolio_summary',
    title: 'Read portfolio summary',
    description: 'Read the signed-in user’s current LagosPM portfolio totals and open-risk counts without changing data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() {
      if (!state.user || !state.dashboard) throw new Error('Sign in and finish any required password change first.');
      return { userRole: state.user.role, projects: state.dashboard.totals.project_count, budget: state.dashboard.totals.budget, forecast: state.dashboard.totals.forecast, openRisks: state.dashboard.openRisks.count, highRisks: state.dashboard.openRisks.high };
    },
  });
  register({
    name: 'update_risk_status',
    title: 'Update risk status',
    description: 'Change an existing risk to Open, Monitoring, or Closed for the signed-in Editor or Admin and show the updated Risks view.',
    inputSchema: { type: 'object', properties: { riskId: { type: 'string', minLength: 1 }, status: { type: 'string', enum: ['Open', 'Monitoring', 'Closed'] } }, required: ['riskId', 'status'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      if (!state.user || state.user.mustChangePassword) throw new Error('Sign in and finish the required password change first.');
      if (state.user.role === 'Viewer') throw new Error('Viewer accounts cannot update risks.');
      const payload = await api(`/api/risks/${encodeURIComponent(input.riskId)}`, { method: 'PATCH', body: { status: input.status } });
      await loadCoreData();
      showView('risks');
      return { id: payload.risk.id, title: payload.risk.title, status: payload.risk.status };
    },
  });
}

registerWebMcpTools();
boot();
