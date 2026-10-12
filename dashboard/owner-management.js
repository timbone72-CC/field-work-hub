// Phase 6F owner console. The server, never this UI, grants authority.
// Source-only TEST environment: production parity/owner enrollment is a later gate.
const OWNER_CONSOLE_ENVIRONMENT = 'TEST';
let ownerConsoleGeneration = 0;
let ownerConsoleData = null;
let ownerConsoleBusy = false;

const renderSignedInBeforeOwnerConsole = renderSignedIn;
renderSignedIn = function renderSignedInWithOwnerConsole(rows, users, organizationId) {
  const result = renderSignedInBeforeOwnerConsole(rows, users, organizationId);
  void loadOwnerConsole();
  return result;
};
signOutButton.addEventListener('click', () => {
  ownerConsoleGeneration++;
  ownerConsoleData = null;
  ownerConsoleBusy = false;
  document.getElementById('owner-office-console')?.remove();
});

function ownerIdentity() {
  return {
    epoch: adminSessionEpoch,
    generation: ownerConsoleGeneration,
    user: currentUser?.id,
    organization: currentUser?.app_metadata?.organization_id
  };
}
function ownerStillCurrent(check) {
  return Boolean(accessToken && check.epoch === adminSessionEpoch
    && check.generation === ownerConsoleGeneration
    && check.user === currentUser?.id
    && check.organization === currentUser?.app_metadata?.organization_id);
}
function ownerStatus(message, error = false) {
  const el = document.getElementById('owner-office-status');
  if (el) { el.textContent = message; el.classList.toggle('error', error); }
}
async function ownerRpc(name, params) {
  const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: authHeaders(true), body: JSON.stringify(params)
  });
  if (!response.ok) {
    const error = new Error(await readableError(response, 'Owner request could not be completed.'));
    error.status = response.status;
    throw error;
  }
  return response.json();
}
async function ownerPaged(name, organizationId) {
  const records = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const batch = await ownerRpc(name, {
      p_org: organizationId, p_environment: OWNER_CONSOLE_ENVIRONMENT,
      p_after: cursor, p_limit: 50
    });
    if (!Array.isArray(batch) || batch.length > 50)
      throw Error('Unexpected owner data page; no partial results displayed.');
    records.push(...batch);
    if (batch.length < 50) return records;
    const last = batch[batch.length - 1];
    const next = name === 'owner_office_team_list' ? last.team_id : last.user_id;
    if (!next || next === cursor) throw Error('Owner data cursor did not advance.');
    cursor = next;
  }
  throw Error('Owner data exceeds the supported page window; no partial results displayed.');
}
function ownerCreateConsole() {
  let section = document.getElementById('owner-office-console');
  if (section) return section;
  section = document.createElement('details');
  section.id = 'owner-office-console';
  section.className = 'admin-action';
  // The template contains only static text; all server values use textContent.
  section.innerHTML = `
    <summary>Product Owner · Office access and seats</summary>
    <p class="muted">Owner-only controls. This does not grant customer job or photo access.
       Supervisor work remains disabled until the complete access rollout is approved.</p>
    <p id="owner-office-status" class="status" role="status" aria-live="polite"></p>
    <button id="owner-office-refresh" class="secondary" type="button">Refresh office access</button>
    <div id="owner-office-capacity" class="muted"></div>
    <form id="owner-office-limit-form" class="admin-form">
      <div class="form-grid">
        <label>Admin seats <input id="owner-admin-limit" type="number" min="0" step="1" required></label>
        <label>Supervisor seats <input id="owner-supervisor-limit" type="number" min="0" step="1" required></label>
      </div>
      <label>Reason for owner change
        <input id="owner-office-reason" type="text" minlength="1" maxlength="1000" required
          placeholder="Required for the access audit">
      </label>
      <button id="owner-office-limit-save" type="submit">Save office seat limits</button>
    </form>
    <h3>Supervisors</h3>
    <p class="muted">Only existing verified Supervisor grants are listed. A tier or team change
       cannot invite a new user or activate a suspended account.</p>
    <div id="owner-supervisor-list"></div>
    <div id="owner-supervisor-team-panel" class="hidden"></div>`;
  const notifications = document.getElementById('notification-center');
  if (notifications) notifications.after(section);
  else document.getElementById('results-card').append(section);
  section.querySelector('#owner-office-refresh').addEventListener('click', () => void loadOwnerConsole(true));
  section.querySelector('#owner-office-limit-form').addEventListener('submit', event => {
    event.preventDefault();
    void ownerSaveLimits();
  });
  return section;
}
function ownerCapacityUI(value) {
  const region = document.getElementById('owner-office-capacity');
  if (!region) return;
  region.textContent = `Admin: ${value.admin_active} active + ${value.admin_reserved} reserved / ${value.admin_limit};
    ${value.admin_available} available. Supervisor: ${value.supervisor_active} active +
    ${value.supervisor_reserved} reserved / ${value.supervisor_limit};
    ${value.supervisor_available} available.`;
  document.getElementById('owner-admin-limit').value = value.admin_limit;
  document.getElementById('owner-supervisor-limit').value = value.supervisor_limit;
}
function ownerSupervisorUI(grants) {
  const list = document.getElementById('owner-supervisor-list');
  if (!list) return;
  list.replaceChildren();
  if (!grants.length) {
    const p = document.createElement('p'); p.className = 'muted';
    p.textContent = 'No existing Supervisor grants. Initial enrollment is not enabled.';
    list.append(p); return;
  }
  for (const grant of grants) {
    const row = document.createElement('div');
    row.className = 'row gap';
    const description = document.createElement('span');
    description.textContent = `${grant.account_email || grant.user_id} · Tier ${grant.tier} ·
      ${grant.grant_active && grant.work_active ? 'active' : 'inactive'} ·
      ${grant.team_count} explicit team(s)`;
    const tier = document.createElement('select');
    tier.setAttribute('aria-label', `New Supervisor tier for ${grant.account_email || grant.user_id}`);
    for (let t = 1; t <= 3; t++) {
      const option = new Option(`Tier ${t}`, String(t), false, grant.tier === t);
      tier.add(option);
    }
    const save = document.createElement('button');
    save.type = 'button'; save.textContent = 'Change tier';
    save.addEventListener('click', () => void ownerChangeTier(grant, Number(tier.value)));
    const scope = document.createElement('button');
    scope.type = 'button'; scope.className = 'secondary';
    scope.textContent = 'Manage teams';
    scope.disabled = grant.tier === 3 || !grant.grant_active;
    scope.addEventListener('click', () => void ownerTeamPanel(grant));
    row.append(description, tier, save, scope); list.append(row);
  }
}
function ownerReason() {
  const reason = document.getElementById('owner-office-reason')?.value.trim() || '';
  if (!reason || reason.length > 1000) throw Error('Enter an audit reason (up to 1,000 characters).');
  return reason;
}
function ownerInteger(id) {
  const text = document.getElementById(id)?.value ?? '';
  const number = Number(text);
  if (!text || !Number.isSafeInteger(number) || number < 0 || number > 2147483647)
    throw Error('Office limits must be whole numbers greater than or equal to zero.');
  return number;
}
async function ownerChange(action, onSuccess) {
  if (ownerConsoleBusy || !ownerConsoleData) return;
  ownerConsoleBusy = true;
  const check = ownerIdentity();
  ownerStatus('Checking owner access and saving…');
  try {
    await action(ownerConsoleData);
    if (!ownerStillCurrent(check)) return;
    await onSuccess?.();
    if (!ownerStillCurrent(check)) return;
    ownerStatus('Saved. Server permissions and revisions verified.');
  } catch (error) {
    if (!ownerStillCurrent(check)) return;
    ownerStatus(error.message || 'Owner change failed. Refresh the current access data.', true);
  } finally { ownerConsoleBusy = false; }
}
async function ownerSaveLimits() {
  try {
    const reason = ownerReason();
    const admin = ownerInteger('owner-admin-limit');
    const supervisor = ownerInteger('owner-supervisor-limit');
    await ownerChange(async data => ownerRpc('owner_set_office_allowances', {
      p_org: data.organization, p_expected_revision: data.capacity.revision,
      p_admin_limit: admin, p_supervisor_limit: supervisor,
      p_reason: reason, p_environment: OWNER_CONSOLE_ENVIRONMENT
    }), async () => loadOwnerConsole(true));
  } catch (error) { ownerStatus(error.message, true); }
}
async function ownerChangeTier(grant, tier) {
  try {
    const reason = ownerReason();
    if (tier === Number(grant.tier)) throw Error('Choose a different tier first.');
    if (grant.tier === 3 && tier < 3 && !window.confirm(
      'Downgrading removes organization-wide work access. Existing photo recovery will be preserved. Continue?')) return;
    await ownerChange(data => ownerRpc('owner_change_supervisor_tier', {
      p_org: data.organization, p_user: grant.user_id,
      p_expected_revision: grant.grant_revision, p_tier: tier,
      p_reason: reason, p_environment: OWNER_CONSOLE_ENVIRONMENT
    }), async () => loadOwnerConsole(true));
  } catch (error) { ownerStatus(error.message, true); }
}
async function ownerTeamPanel(grant) {
  const check = ownerIdentity(), panel = document.getElementById('owner-supervisor-team-panel');
  if (!panel || !ownerConsoleData || ownerConsoleBusy) return;
  panel.classList.remove('hidden');panel.replaceChildren();
  ownerStatus('Reading exact current team grants…');
  try {
    const data = ownerConsoleData;
    const assigned = await ownerRpc('owner_supervisor_team_scope_list', {
      p_org: data.organization, p_user: grant.user_id, p_environment: OWNER_CONSOLE_ENVIRONMENT
    });
    if (!ownerStillCurrent(check)) return;
    const current = new Set(assigned.map(item => item.team_id));
    const heading = document.createElement('p');
    heading.textContent = `Team scope for ${grant.account_email || grant.user_id} (Tier ${grant.tier})`;
    panel.append(heading);
    for (const team of data.teams.filter(team => team.active || current.has(team.team_id))) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary';
      button.textContent = `${current.has(team.team_id) ? 'Remove' : 'Add'}: ${team.team_name}`;
      button.disabled = !team.active && !current.has(team.team_id);
      button.addEventListener('click', () => void ownerUpdateTeam(grant, team, !current.has(team.team_id)));
      panel.append(button);
    }
    ownerStatus('Exact team grants loaded. Changes require the audit reason above.');
  } catch (error) {
    if (ownerStillCurrent(check)) {
      panel.replaceChildren();ownerStatus(error.message, true);
    }
  }
}
async function ownerUpdateTeam(grant, team, allowed) {
  try {
    const reason = ownerReason();
    if (!allowed && !window.confirm(
      'Remove this team from Supervisor work access? Earlier photos will remain recoverable.')) return;
    await ownerChange(data => ownerRpc('owner_set_supervisor_team_scope', {
      p_org: data.organization, p_user: grant.user_id, p_team: team.team_id,
      p_allowed: allowed, p_expected_revision: grant.grant_revision,
      p_reason: reason, p_environment: OWNER_CONSOLE_ENVIRONMENT
    }), async () => loadOwnerConsole(true));
  } catch (error) { ownerStatus(error.message, true); }
}
async function loadOwnerConsole(force = false) {
  const check = ownerIdentity();
  if (!check.user || !check.organization) return;
  if (force) document.getElementById('owner-supervisor-team-panel')?.classList.add('hidden');
  try {
    // Every response is server-checked; metadata alone never makes someone owner.
    const capacity = await ownerRpc('owner_office_capacity_status', {
      p_org: check.organization, p_environment: OWNER_CONSOLE_ENVIRONMENT
    });
    if (!ownerStillCurrent(check)) return;
    const [grants, teams] = await Promise.all([
      ownerPaged('owner_supervisor_grant_list', check.organization),
      ownerPaged('owner_office_team_list', check.organization)
    ]);
    if (!ownerStillCurrent(check)) return;
    ownerConsoleData = { organization: check.organization, capacity, grants, teams };
    const section = ownerCreateConsole();
    ownerCapacityUI(capacity);
    ownerSupervisorUI(grants);
    if (force) section.open = true;
    ownerStatus('Current owner entitlement verified by the server.');
  } catch (error) {
    if (!ownerStillCurrent(check)) return;
    ownerConsoleData = null;
    document.getElementById('owner-office-console')?.remove();
    // A non-owner must never see owner controls; missing draft RPCs fail closed.
  }
}
