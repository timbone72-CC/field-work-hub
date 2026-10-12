// Phase 6F owner console. The server, never this UI, grants authority.
// Source-only TEST environment: production parity/owner enrollment is a later gate.
const OWNER_CONSOLE_ENVIRONMENT = 'TEST';
let ownerConsoleGeneration = 0;
let ownerConsoleData = null;
let ownerConsoleBusy = false;
let ownerReviewGeneration = 0;
let ownerEnrollmentPending = null;

const renderSignedInBeforeOwnerConsole = renderSignedIn;
renderSignedIn = function renderSignedInWithOwnerConsole(rows, users, organizationId) {
  const result = renderSignedInBeforeOwnerConsole(rows, users, organizationId);
  void loadOwnerConsole();
  return result;
};
signOutButton.addEventListener('click', () => {
  ownerConsoleGeneration++;
  ownerReviewGeneration++;
  ownerConsoleData = null;
  ownerConsoleBusy = false;
  ownerEnrollmentPending = null;
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
    <details id="owner-enrollment" class="admin-action">
      <summary>Enroll a verified existing Supervisor</summary>
      <p class="muted">Choose an already verified inactive Supervisor account. This reserves
        and consumes an available Supervisor seat atomically; it does not create an
        account, send an invitation, or turn on work access.</p>
      <form id="owner-enrollment-form" class="admin-form">
        <label>Verified inactive Supervisor
          <select id="owner-enrollment-user" required></select>
        </label>
        <label>Supervisor tier
          <select id="owner-enrollment-tier">
            <option value="1">Tier 1 — Work Supervisor</option>
            <option value="2">Tier 2 — Team Manager</option>
            <option value="3">Tier 3 — Organization Manager</option>
          </select>
        </label>
        <fieldset id="owner-enrollment-team-field">
          <legend>Exact supervised teams (Tier 1 or 2)</legend>
          <div id="owner-enrollment-teams"></div>
        </fieldset>
        <button type="submit">Enroll existing Supervisor</button>
        <p id="owner-enrollment-status" role="status" class="status"></p>
      </form>
    </details>
    <p class="muted">Only existing verified Supervisor grants are listed. A tier or team change
       cannot invite a new user or activate a suspended account.</p>
    <div id="owner-supervisor-list"></div>
    <div id="owner-supervisor-team-panel" class="hidden"></div>
    <h3>Reviewed work access</h3>
    <p class="muted">Disabling work does not delete historical photos. Review affected teams and choose who retains responsibility before committing.</p>
    <div id="owner-office-people"></div>
    <div id="owner-access-review-panel" class="hidden"></div>`;
  const notifications = document.getElementById('notification-center');
  if (notifications) notifications.after(section);
  else document.getElementById('results-card').append(section);
  section.querySelector('#owner-office-refresh').addEventListener('click', () => void loadOwnerConsole(true));
  section.querySelector('#owner-office-limit-form').addEventListener('submit', event => {
    event.preventDefault();
    void ownerSaveLimits();
  });
  section.querySelector('#owner-enrollment-tier').addEventListener('change', () => {
    const field = document.getElementById('owner-enrollment-team-field');
    field.hidden = document.getElementById('owner-enrollment-tier').value === '3';
  });
  section.querySelector('#owner-enrollment-form').addEventListener('submit', event => {
    event.preventDefault();
    void ownerEnrollExisting();
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
    p.textContent = 'No Supervisor grants yet. Choose a verified account above to enroll.';
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
    const state = document.createElement('button');
    state.type = 'button'; state.className = 'secondary';
    state.textContent = grant.grant_active ? 'Remove grant' : 'Re-enable grant';
    state.disabled = Boolean(grant.work_active);
    if (state.disabled) state.title = 'Review and disable work access first.';
    state.addEventListener('click', () => void ownerChangeGrantState(grant, !grant.grant_active));
    row.append(description, tier, save, scope, state); list.append(row);
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
async function ownerChangeGrantState(grant, active) {
  try {
    const data = ownerConsoleData;
    const person = data?.people.find(p => p.user_id === grant.user_id);
    if (!person || person.work_role !== 'SUPERVISOR' || person.work_active
      || grant.work_active || grant.grant_active === active) {
      throw Error('Supervisor work must be disabled with reviewed continuity before changing the grant.');
    }
    const reason = ownerReason();
    if (!window.confirm(active
      ? 'Re-enable the existing Supervisor grant? Work access remains OFF until separately reviewed.'
      : 'Remove Supervisor permission? Work access must already be OFF and historical photo grants will be retained.')) return;
    const actionId = crypto.randomUUID();
    await ownerChange(current => ownerRpc('owner_set_supervisor_grant_state', {
      p_action: actionId, p_org: current.organization, p_user: grant.user_id,
      p_expected_grant_revision: grant.grant_revision,
      p_expected_access_revision: person.access_revision, p_active: active,
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

function ownerEnrollmentUI(people, grants, teams) {
  const select = document.getElementById('owner-enrollment-user');
  const box = document.getElementById('owner-enrollment-teams');
  const form = document.getElementById('owner-enrollment-form');
  const status = document.getElementById('owner-enrollment-status');
  if (!select || !box || !form) return;
  const granted = new Set(grants.map(grant => grant.user_id));
  if (ownerEnrollmentPending && granted.has(ownerEnrollmentPending.user)) ownerEnrollmentPending = null;
  const candidates = people.filter(person =>
    person.work_role === 'SUPERVISOR' && !person.work_active
    && person.identity_ready === true && !granted.has(person.user_id)
    && person.user_id !== currentUser?.id);
  select.replaceChildren(new Option('Select an already verified Supervisor', ''));
  for (const person of candidates) {
    select.add(new Option(person.account_email || person.user_id, person.user_id));
  }
  box.replaceChildren();
  for (const team of teams.filter(team => team.active)) {
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox'; check.value = team.team_id;
    check.name = 'owner-enrollment-team';
    label.append(check, document.createTextNode(' ' + team.team_name));
    box.append(label);
  }
  const available = Number(ownerConsoleData?.capacity?.supervisor_available || 0);
  form.querySelector('button[type="submit"]').disabled =
    !candidates.length || available < 1;
  if (status) status.textContent = !candidates.length
    ? 'No eligible verified, inactive Supervisor account is available. New-user invitations are not enabled.'
    : available < 1 ? 'No Supervisor seat is available. Review office seat limits.'
    : 'Enrollment does not start work access or send a setup email.';
}
async function ownerEnrollExisting() {
  try {
    const data = ownerConsoleData;
    if (!data) throw Error('Refresh and verify Product Owner access first.');
    const user = document.getElementById('owner-enrollment-user')?.value;
    const tier = Number(document.getElementById('owner-enrollment-tier')?.value);
    const person = data.people.find(p => p.user_id === user);
    if (!person || person.identity_ready !== true || person.work_role !== 'SUPERVISOR'
      || person.work_active || data.grants.some(g => g.user_id === user)
      || person.user_id === currentUser?.id) {
      throw Error('Choose an eligible existing verified Supervisor account.');
    }
    if (![1,2,3].includes(tier)) throw Error('Choose a valid Supervisor tier.');
    const teamIds = tier === 3 ? [] :
      Array.from(document.querySelectorAll('#owner-enrollment-teams input:checked'))
        .map(input => input.value);
    const permitted = new Set(data.teams.filter(t => t.active).map(t => t.team_id));
    if ((tier < 3 && !teamIds.length) || teamIds.some(id => !permitted.has(id))
      || new Set(teamIds).size !== teamIds.length) {
      throw Error('Choose at least one exact active team for Tier 1 or Tier 2.');
    }
    if (Number(data.capacity.supervisor_available) < 1) {
      throw Error('No Supervisor seat is available.');
    }
    const reason = ownerReason();
    if (!window.confirm('Enroll this existing verified account with the selected tier and teams? ' +
      'A Supervisor seat will be reserved and consumed in one server action. Work access stays OFF.')) return;
    const fingerprint = JSON.stringify({
      organization: data.organization, user, tier,
      teams: [...teamIds].sort(), reason, revision: person.access_revision
    });
    if (ownerEnrollmentPending && ownerEnrollmentPending.fingerprint !== fingerprint) {
      throw Error('An earlier enrollment outcome may be uncertain. Refresh and reconcile it before changing the request.');
    }
    const actionId = ownerEnrollmentPending?.actionId || crypto.randomUUID();
    ownerEnrollmentPending = { actionId, fingerprint, user };
    await ownerChange(current => ownerRpc('owner_enroll_supervisor_with_seat', {
      p_action: actionId, p_org: current.organization, p_user: user,
      p_expected_access_revision: person.access_revision,
      p_tier: tier, p_team_ids: teamIds, p_reason: reason,
      p_environment: OWNER_CONSOLE_ENVIRONMENT
    }), async () => {
      await loadOwnerConsole(true);
      if (!ownerConsoleData?.grants.some(grant => grant.user_id === user))
        throw Error('Enrollment response needs reconciliation. Refresh and retry the SAME request.');
      ownerEnrollmentPending = null;
    });
  } catch (error) {
    ownerStatus(error.message || 'Enrollment failed. Review the current account status.', true);
  }
}

function ownerPeopleUI(people) {
  const root = document.getElementById('owner-office-people');
  if (!root) return;
  root.replaceChildren();
  for (const person of people) {
    const row = document.createElement('div');
    row.className = 'row gap';
    const label = document.createElement('span');
    label.textContent = `${person.account_email || person.user_id} · ${person.work_role} ·
      ${person.work_active ? 'work enabled' : 'work disabled'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = person.work_active ? 'secondary' : '';
    button.textContent = person.work_active ? 'Review disable' : 'Review restore';
    // An owner signed in via the existing Admin workspace must not lock that
    // very session out before the separate owner-only login is implemented.
    if (person.user_id === currentUser?.id && person.work_active) {
      button.disabled = true;
      button.title = 'Use a separate verified owner session to change this account.';
    }
    if (!person.work_active && person.work_role === 'SUPERVISOR'
      && ownerConsoleData?.grants.some(g => g.user_id === person.user_id && !g.grant_active)) {
      button.disabled = true;
      button.title = 'Re-enable the Supervisor grant before reviewing work restoration.';
    }
    button.addEventListener('click', () => void ownerReviewAccess(person, !person.work_active));
    row.append(label, button);
    root.append(row);
  }
}
async function ownerReadAccessReview(person, requestedActive, organization) {
  const teams = [];
  let cursor = null;
  let fingerprint = null;
  let first = null;
  for (let page = 0; page < 20; page++) {
    const result = await ownerRpc('review_account_work_access', {
      p_target: person.user_id,
      p_active: requestedActive,
      p_environment: OWNER_CONSOLE_ENVIRONMENT,
      p_limit: 50,
      p_after_team: cursor,
      p_expected_fingerprint: fingerprint
    });
    if (!result || result.organization_id !== organization
        || result.target_user_id !== person.user_id
        || result.requested_active !== requestedActive
        || !/^[a-f0-9]{64}$/.test(result.review_fingerprint)
        || !Array.isArray(result.teams) || result.teams.length > 50
        || (fingerprint && fingerprint !== result.review_fingerprint)) {
      throw Error('Account review changed or included unexpected scope; reload.');
    }
    if (!first) {
      first = result;
      fingerprint = result.review_fingerprint;
    }
    teams.push(...result.teams);
    cursor = result.next_team;
    if (!cursor) {
      if (teams.length !== Number(result.total_teams))
        throw Error('Incomplete account-team review; no change authorized.');
      return { ...first, teams };
    }
  }
  throw Error('Too many teams to review safely in this page.');
}
async function ownerReviewAccess(person, requestedActive) {
  if (!ownerConsoleData || ownerConsoleBusy) return;
  const check = ownerIdentity();
  const reviewGeneration = ++ownerReviewGeneration;
  const region = document.getElementById('owner-access-review-panel');
  if (!region) return;
  region.classList.remove('hidden'); region.replaceChildren();
  ownerStatus('Reviewing current account, teams, and affected work…');
  try {
    const data = ownerConsoleData;
    const review = await ownerReadAccessReview(person, requestedActive, data.organization);
    if (!ownerStillCurrent(check) || reviewGeneration !== ownerReviewGeneration) return;
    const heading = document.createElement('p');
    heading.textContent = `${requestedActive ? 'Restore' : 'Disable'} work for
      ${person.account_email || person.user_id}: ${review.affected_jobs} current jobs,
      ${review.in_progress_jobs} in progress, ${review.field_complete_jobs} field-complete.`;
    region.append(heading);
    const decisions = [];
    if (review.continuity_required) {
      for (const team of review.teams) {
        const label = document.createElement('label');
        label.textContent = `${team.name} · ${team.affected_jobs} affected jobs · `;
        const available = Array.isArray(team.manager_user_ids) ? team.manager_user_ids : [];
        if (Number(team.manager_count) > 0 && !available.length)
          throw Error('A team manager exists but cannot be selected; stop and reload.');
        if (available.length) {
          const select = document.createElement('select');
          select.add(new Option('Choose the responsible manager', ''));
          for (const userId of available) {
            const manager = data.people.find(p => p.user_id === userId);
            if (!manager) throw Error('Manager identity not verified in current organization.');
            select.add(new Option(manager.account_email || userId, userId));
          }
          label.append(select);
          decisions.push(() => {
            if (!select.value) throw Error(`Choose a responsible manager for ${team.name}.`);
            return { team_id: team.team_id, decision: 'KEEP_MANAGER',
              manager_user_id: select.value };
          });
        } else {
          const ack = document.createElement('input');
          ack.type = 'checkbox';
          label.append('No eligible manager. Explicitly mark this team as needing one.', ack);
          decisions.push(() => {
            if (!ack.checked) throw Error(`Acknowledge the missing manager for ${team.name}.`);
            return { team_id: team.team_id, decision: 'NEEDS_MANAGER' };
          });
        }
        region.append(label);
      }
    }
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = requestedActive ? 'Confirm reviewed restore' : 'Confirm reviewed disable';
    confirm.addEventListener('click', () => {
      try {
        const continuity = decisions.map(getDecision => getDecision());
        const reason = ownerReason();
        if (!window.confirm(requestedActive
          ? 'Restore this account’s current work permissions? Historical recovery remains separate.'
          : 'Disable new work access? Existing protected photos remain recoverable; active jobs and offline work must still be handled.')) return;
        void ownerChange(data => ownerRpc('set_reviewed_account_work_access', {
          p_action: crypto.randomUUID(),
          p_target: person.user_id,
          p_expected_revision: review.access_revision,
          p_active: requestedActive, p_reason: reason,
          p_environment: OWNER_CONSOLE_ENVIRONMENT,
          p_review_fingerprint: review.review_fingerprint,
          p_continuity: continuity
        }), async () => loadOwnerConsole(true));
      } catch (error) { ownerStatus(error.message, true); }
    });
    region.append(confirm);
    ownerStatus('Review the listed team continuity before confirming. Nothing has been changed.');
  } catch (error) {
    if (ownerStillCurrent(check) && reviewGeneration === ownerReviewGeneration) {
      region.replaceChildren();
      ownerStatus(error.message || 'Unable to review this account.', true);
    }
  }
}

async function loadOwnerConsole(force = false) {
  const check = ownerIdentity();
  if (!check.user || !check.organization) return;
  if (force) {
    ownerReviewGeneration++;
    document.getElementById('owner-supervisor-team-panel')?.classList.add('hidden');
  }
  try {
    // Every response is server-checked; metadata alone never makes someone owner.
    const capacity = await ownerRpc('owner_office_capacity_status', {
      p_org: check.organization, p_environment: OWNER_CONSOLE_ENVIRONMENT
    });
    if (!ownerStillCurrent(check)) return;
    const [grants, teams, people] = await Promise.all([
      ownerPaged('owner_supervisor_grant_list', check.organization),
      ownerPaged('owner_office_team_list', check.organization),
      ownerPaged('owner_office_people_list', check.organization)
    ]);
    if (!ownerStillCurrent(check)) return;
    ownerConsoleData = { organization: check.organization, capacity, grants, teams, people };
    const section = ownerCreateConsole();
    ownerCapacityUI(capacity);
    ownerSupervisorUI(grants);
    ownerEnrollmentUI(people, grants, teams);
    ownerPeopleUI(people);
    if (force) {
      section.open = true;
      document.getElementById('owner-access-review-panel')?.classList.add('hidden');
    }
    ownerStatus('Current owner entitlement verified by the server.');
  } catch (error) {
    if (!ownerStillCurrent(check)) return;
    ownerConsoleData = null;
    document.getElementById('owner-office-console')?.remove();
    // A non-owner must never see owner controls; missing draft RPCs fail closed.
  }
}
