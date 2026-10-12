// Phase 6F source-only Supervisor staffing entry point. Work/photos are not
// exposed here: current server authority and exact team/seat RPCs own decisions.
const STAFFING_ENVIRONMENT = 'TEST';
let staffingSnapshot = null;
let staffingPending = null;
let staffingBusy = false;
let staffingNeedsRefresh = false;
let staffingGeneration = 0;
let staffingRoster = null;
let staffingRosterPending = null;
let staffingRosterBusy = false;
let staffingRosterNeedsRefresh = false;
let staffingWork = null;
let staffingWorkBusy = false;
let staffingHandoffPreview = null;
let staffingHandoffPending = null;
let staffingHandoffBusy = false;
let staffingHandoffNeedsRefresh = false;

function staffingIdentity() {
  return { epoch: adminSessionEpoch, generation: staffingGeneration,
    user: currentUser?.id, org: currentUser?.app_metadata?.organization_id };
}
function staffingStillCurrent(check) {
  return Boolean(accessToken && currentUser?.app_metadata?.role === 'SUPERVISOR'
    && adminSessionEpoch === check.epoch && staffingGeneration === check.generation
    && currentUser.id === check.user
    && currentUser.app_metadata.organization_id === check.org);
}
function staffingMessage(message, error = false) {
  const node = document.getElementById('staffing-status');
  if (node) { node.textContent = message; node.classList.toggle('error', error); }
}
function staffingCard() {
  let card = document.getElementById('staffing-card');
  if (card) return card;
  card = document.createElement('section');
  card.id = 'staffing-card';
  card.className = 'card hidden';
  card.innerHTML = `
    <div class="row between gap"><div>
      <p class="eyebrow">Field Work Hub · Supervisor</p>
      <h2>Supervisor work and staffing</h2><p id="staffing-account" class="muted"></p>
    </div><button type="button" id="staffing-sign-out" class="secondary">Sign Out</button></div>
    <p class="muted">Work orders below are limited to current server-authorized teams.
      This source checkpoint is read-only: editing, photos and Send remain unavailable.</p>
    <p id="staffing-capacity" class="muted"></p>
    <button type="button" class="secondary" id="staffing-refresh">Refresh staffing</button>
    <p id="staffing-status" class="status" role="status" aria-live="polite"></p>
    <form id="staffing-invite-form" class="admin-form" autocomplete="off">
      <label>Staffing action<select id="staffing-operation">
        <option value="invite_admin_new_team">Create team and invite its Admin</option>
        <option value="invite_admin">Invite Admin into authorized team</option>
      </select></label>
      <label id="staffing-team-choice" class="hidden">Existing supervised team
        <select id="staffing-team"></select></label>
      <label id="staffing-team-new">New team name
        <input id="staffing-team-name" maxlength="100" required></label>
      <label>Admin name<input id="staffing-name" maxlength="200" required></label>
      <label>Admin email<input id="staffing-email" type="email" maxlength="320" required></label>
      <label>Reason for staffing change<input id="staffing-reason" maxlength="1000" required></label>
      <button id="staffing-submit" type="submit">Request one-time setup link</button>
    </form>
    <section id="staffing-roster-area" class="subsection">
      <h3>Contractor placement</h3>
      <p class="muted">Tier 2 may place an available unassigned Contractor into a supervised team.
        Tier 3 may also move an idle Contractor between teams. Active work requires a separate reviewed handoff.</p>
      <p id="staffing-roster-status" role="status" aria-live="polite"></p>
      <form id="staffing-roster-form" autocomplete="off">
        <label>Eligible Contractor<select id="staffing-roster-person" required></select></label>
        <label>Destination team<select id="staffing-roster-team" required></select></label>
        <label>Reason<input id="staffing-roster-reason" maxlength="1000" required></label>
        <button id="staffing-roster-submit" type="submit">Confirm Contractor placement</button>
      </form>
    </section>
    <section id="staffing-work-area" class="subsection" aria-label="Authorized work orders">
      <h3>Authorized team work</h3>
      <p id="staffing-work-status" class="muted" role="status" aria-live="polite"></p>
      <div class="table-scroll"><table>
        <thead><tr><th>Team</th><th>Address</th><th>WO</th><th>Status</th><th>Due</th></tr></thead>
        <tbody id="staffing-work-rows"></tbody>
      </table></div>
      <button id="staffing-work-more" type="button" class="secondary hidden">More authorized work</button>
    </section>
    <section id="staffing-handoff-area" class="subsection hidden">
      <h3>Reviewed team handoff</h3>
      <p class="muted">Tier 3 may move only completely undispatched jobs with no assigned person,
        field action or photo history. Other work needs a separate consent and recovery process.</p>
      <form id="staffing-handoff-form" autocomplete="off">
        <label>Authorized work order<select id="staffing-handoff-wo" required></select></label>
        <label>Destination team<select id="staffing-handoff-team" required></select></label>
        <label>Handoff reason<input id="staffing-handoff-reason" maxlength="1000" required></label>
        <button id="staffing-handoff-preview" type="button">Review current eligibility</button>
        <div id="staffing-handoff-review" class="hidden">
          <p id="staffing-handoff-review-text" role="status"></p>
          <button type="button" id="staffing-handoff-confirm">Confirm reviewed handoff</button>
        </div>
      </form>
      <p id="staffing-handoff-status" class="status" aria-live="polite" role="status"></p>
    </section>
    <div id="staffing-link-result" class="hidden">
      <label>Verified one-time Admin setup link<input id="staffing-link" readonly></label>
      <button type="button" id="staffing-copy" class="secondary">Copy Setup Link</button>
    </div>`;
  document.querySelector('main.shell').append(card);
  card.querySelector('#staffing-sign-out').addEventListener('click', () => signOutButton.click());
  card.querySelector('#staffing-refresh').addEventListener('click', () => {
    staffingNeedsRefresh = false;
    void staffingRefresh().catch(error => staffingMessage(error.message, true));
  });
  card.querySelector('#staffing-operation').addEventListener('change', staffingRenderOperation);
  card.querySelector('#staffing-work-more').addEventListener('click', () => {
    void staffingLoadMore();
  });
  for (const id of ['staffing-handoff-wo','staffing-handoff-team','staffing-handoff-reason']) {
    card.querySelector('#'+id).addEventListener('input', () => {
      if (!staffingHandoffPending) {
        staffingHandoffPreview = null;
        card.querySelector('#staffing-handoff-review').classList.add('hidden');
      } else {
        // Changed-input retry cannot create another transaction; restoring
        // the exact reviewed fields reveals the original-action retry.
        card.querySelector('#staffing-handoff-review').classList.toggle('hidden',
          JSON.stringify(staffingHandoffInputs()) !==
            JSON.stringify(staffingHandoffPreview?.request));
      }
    });
  }
  card.querySelector('#staffing-handoff-preview').addEventListener('click', () => void staffingPreviewHandoff());
  card.querySelector('#staffing-handoff-confirm').addEventListener('click', () => void staffingConfirmHandoff());
  card.querySelector('#staffing-invite-form').addEventListener('submit', event => {
    event.preventDefault(); void staffingInvite();
  });
  card.querySelector('#staffing-roster-form').addEventListener('submit', event => {
    event.preventDefault(); void staffingPlaceContractor();
  });
  card.querySelector('#staffing-roster-person').addEventListener('change', staffingRenderRoster);
  card.querySelector('#staffing-roster-team').addEventListener('change', staffingRenderRoster);
  card.querySelector('#staffing-copy').addEventListener('click', async () => {
    const link = card.querySelector('#staffing-link').value;
    if (!link || !staffingSnapshot) return;
    try { await navigator.clipboard.writeText(link); staffingMessage('Setup link copied.'); }
    catch { staffingMessage('Copy is unavailable; select and copy the verified link.', true); }
  });
  return card;
}
function staffingRenderOperation() {
  const card = staffingCard();
  const newTeam = card.querySelector('#staffing-operation').value === 'invite_admin_new_team';
  card.querySelector('#staffing-team-choice').classList.toggle('hidden', newTeam);
  card.querySelector('#staffing-team-new').classList.toggle('hidden', !newTeam);
  card.querySelector('#staffing-team-name').required = newTeam;
  card.querySelector('#staffing-team').required = !newTeam;
}
async function staffingReadSnapshot(org) {
  let after = null;
  let first = null;
  const teams = [];
  for (let page = 0; page < 20; page++) {
    const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/office_staffing_scope_snapshot`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ p_org: org, p_environment: STAFFING_ENVIRONMENT,
        p_after: after, p_limit: 50 })
    });
    if (!response.ok) throw new Error(await readableError(response, 'Current staffing access denied.'));
    const value = await response.json();
    if (!value || value.organization_id !== org || !Array.isArray(value.teams)
      || value.teams.length > 50 || !value.allowance_revision
      || (first && value.allowance_revision !== first.allowance_revision)
      || (after && value.teams.some(team => team.team_id <= after))) {
      throw new Error('Staffing scope changed during refresh. No partial team list was accepted.');
    }
    first ||= value;
    teams.push(...value.teams);
    if (!value.next_after) return { ...first, teams };
    if (value.next_after === after || !value.teams.length) break;
    after = value.next_after;
  }
  throw new Error('Staffing scope exceeds the supported page window.');
}
// A Supervisor's work page has its own current-session/team read predicate.
// No legacy Admin work mutation or photo endpoint is called from this screen.
async function staffingReadWorkPage(org, after = null) {
  const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/office_supervisor_work_page`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({ p_org: org, p_after: after, p_limit: 25 })
  });
  if (!response.ok) throw new Error(await readableError(response,
    'Current Supervisor work access denied.'));
  const value = await response.json();
  if (value?.organization_id !== org || ![1,2,3].includes(Number(value.caller_tier))
    || !Array.isArray(value.work_orders) || value.work_orders.length > 25
    || (value.next_after && !value.work_orders.length)
    || (after && value.work_orders.some(row => row.work_order_id <= after))) {
    throw new Error('Work scope or paging changed. Reload the authorized view.');
  }
  const seen = new Set();
  for (const row of value.work_orders) {
    if (!row.work_order_id || !row.team_id || !row.team_name
      || seen.has(row.work_order_id)) throw new Error('Invalid scoped work page.');
    seen.add(row.work_order_id);
  }
  return { tier: Number(value.caller_tier), rows: value.work_orders,
    nextAfter: value.next_after || null };
}
function staffingRenderWork() {
  const card = staffingCard(), work = staffingWork;
  const rows = card.querySelector('#staffing-work-rows');
  rows.replaceChildren();
  for (const row of work?.rows || []) {
    const tr = document.createElement('tr');
    for (const value of [row.team_name, row.property_address, row.wo_number,
      row.field_status, row.due_date]) {
      const td = document.createElement('td');
      td.textContent = value == null ? '—' : String(value);
      tr.append(td);
    }
    rows.append(tr);
  }
  card.querySelector('#staffing-work-status').textContent = work
    ? `Tier ${work.tier} · ${work.rows.length} authorized jobs loaded (read-only).`
    : '';
  const more = card.querySelector('#staffing-work-more');
  more.classList.toggle('hidden', !work?.nextAfter);
  more.disabled = staffingWorkBusy;
  card.querySelector('#staffing-invite-form').classList.toggle('hidden', work?.tier < 2);
  card.querySelector('#staffing-roster-area').classList.toggle('hidden', work?.tier < 2);
  card.querySelector('#staffing-capacity').classList.toggle('hidden', work?.tier < 2);
  staffingRenderHandoff();
}
async function staffingLoadMore() {
  const check = staffingIdentity(), current = staffingWork;
  if (!staffingStillCurrent(check) || staffingWorkBusy || !current?.nextAfter) return;
  staffingWorkBusy = true;
  staffingRenderWork();
  try {
    const page = await staffingReadWorkPage(check.org, current.nextAfter);
    if (!staffingStillCurrent(check)) return;
    if (page.tier !== current.tier
      || page.rows.some(row => current.rows.some(old => old.work_order_id === row.work_order_id))
      || (page.nextAfter && page.nextAfter === current.nextAfter)) {
      throw new Error('Supervisor scope changed; refresh before viewing more jobs.');
    }
    staffingWork = { tier: current.tier, rows: [...current.rows, ...page.rows],
      nextAfter: page.nextAfter };
  } catch (error) {
    if (staffingStillCurrent(check)) {
      staffingWork = null;
      staffingCard().querySelector('#staffing-work-status').textContent = error.message;
      signOutButton.click(); // Old rows must not remain visible after denied read.
      setLoginStatus('Supervisor work scope needs a fresh sign-in.', true);
    }
  } finally {
    staffingWorkBusy = false;
    if (staffingStillCurrent(check)) staffingRenderWork();
  }
}
async function showScopedStaffingPortal(organizationId) {
  if (currentUser?.app_metadata?.role !== 'SUPERVISOR'
      || currentUser.app_metadata.organization_id !== organizationId) {
    throw new Error('Verified Supervisor account required.');
  }
  const check = staffingIdentity();
  const work = await staffingReadWorkPage(organizationId);
  if (!staffingStillCurrent(check)) throw new Error('The Supervisor session changed.');
  // Tier 1 cannot call the staffing/roster RPCs at all.
  const [snapshot, roster] = work.tier >= 2 ? await Promise.all([
    staffingReadSnapshot(organizationId), staffingReadRoster(organizationId)
  ]) : [null, null];
  if (!staffingStillCurrent(check)) throw new Error('The Supervisor session changed.');
  staffingWork = work;
  staffingSnapshot = snapshot;
  staffingRoster = roster;
  const card = staffingCard();
  loginCard.classList.add('hidden');
  resultsCard.classList.add('hidden');
  card.classList.remove('hidden');
  card.querySelector('#staffing-account').textContent = currentUser.email || 'Supervisor account';
  if (snapshot) { staffingRender(); staffingRenderRoster(); }
  staffingRenderWork();
}
async function staffingRefresh() {
  const check = staffingIdentity();
  if (!staffingStillCurrent(check)) throw new Error('Sign in as an authorized Supervisor.');
  if (staffingRosterPending) {
    throw new Error('Reconcile the exact pending Contractor action before refreshing staffing.');
  }
  if (staffingHandoffPending) {
    throw new Error('Retry the exact unresolved work-order handoff before refreshing.');
  }
  // A fresh work gate is required even to render staffing; a changed tier is
  // never inferred from an old browser selection or cached JWT role.
  try {
    const work = await staffingReadWorkPage(check.org);
    if (!staffingStillCurrent(check)) return;
    const [snapshot, roster] = work.tier >= 2 ? await Promise.all([
      staffingReadSnapshot(check.org), staffingReadRoster(check.org)
    ]) : [null, null];
    if (!staffingStillCurrent(check)) return;
    staffingWork = work;
    staffingSnapshot = snapshot;
    staffingRoster = roster;
    staffingRosterNeedsRefresh = false;
    staffingHandoffPreview = null;
    staffingHandoffNeedsRefresh = false;
    if (snapshot) { staffingRender(); staffingRenderRoster(); }
    else staffingCard().querySelector('#staffing-link-result').classList.add('hidden');
    staffingRenderWork();
    staffingMessage('Current Supervisor work/team scope verified.');
  } catch (error) {
    if (staffingStillCurrent(check)) {
      signOutButton.click();
      setLoginStatus('Current Supervisor authorization could not be reverified.', true);
    }
    throw error;
  }
}
function staffingRender() {
  const card = staffingCard(), data = staffingSnapshot;
  card.querySelector('#staffing-capacity').textContent =
    `Admin seats: ${data.admin_active} active, ${data.admin_reserved} reserved, ${data.admin_available} available of ${data.admin_limit}.`;
  const choice = card.querySelector('#staffing-team'), previous = choice.value;
  choice.replaceChildren(new Option('Choose an authorized team', ''));
  for (const team of data.teams) choice.add(new Option(team.name, team.team_id));
  if ([...choice.options].some(option => option.value === previous)) choice.value = previous;
  const submit = card.querySelector('#staffing-submit');
  submit.disabled = staffingBusy || staffingNeedsRefresh || Number(data.admin_available) < 1;
  staffingRenderOperation();
  if (Number(data.admin_available) < 1 && !staffingPending) {
    staffingMessage('No Admin seat is available. Only the Product Owner can raise the allowance.');
  }
}
async function staffingInvite() {
  const check = staffingIdentity(), card = staffingCard(), data = staffingSnapshot;
  if (staffingBusy || staffingNeedsRefresh || !data || !staffingStillCurrent(check)) return;
  const operation = card.querySelector('#staffing-operation').value;
  const newTeam = operation === 'invite_admin_new_team';
  const req = { operation,
    team_name: newTeam ? card.querySelector('#staffing-team-name').value.trim() : '',
    team_id: newTeam ? (staffingPending?.request.team_id || crypto.randomUUID())
      : card.querySelector('#staffing-team').value,
    display_name: card.querySelector('#staffing-name').value.trim(),
    email: card.querySelector('#staffing-email').value.trim().toLowerCase(),
    reason: card.querySelector('#staffing-reason').value.trim(),
    expected_allowance_revision: data.allowance_revision
  };
  if (!req.team_id || !req.display_name || !req.email || !req.reason
    || (newTeam && !req.team_name)
    || (!newTeam && !data.teams.some(team => team.team_id === req.team_id))) {
    staffingMessage('Enter complete details for an authorized team.', true); return;
  }
  if (staffingPending && JSON.stringify(staffingPending.request) !== JSON.stringify(req)) {
    staffingMessage('An earlier invitation has an uncertain outcome. Restore its exact details before retrying.', true);
    return;
  }
  staffingPending ||= { action: crypto.randomUUID(), request: req };
  staffingBusy = true;
  card.querySelector('#staffing-submit').disabled = true;
  card.querySelector('#staffing-link').value = '';
  card.querySelector('#staffing-link-result').classList.add('hidden');
  staffingMessage('Confirming exact staff seat and one-time identity…');
  try {
    const response = await adminFetch(`${SUPABASE_URL}/functions/v1/admin-invite-contractor`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ ...req, action_id: staffingPending.action })
    });
    const outcome = await response.json().catch(() => ({}));
    if (!staffingStillCurrent(check)) return;
    if (!response.ok || outcome.status !== 'BOUND' || !outcome.setup_url
      || outcome.action_id !== staffingPending.action || outcome.team_id !== req.team_id) {
      throw new Error(outcome.error || 'The original invitation needs protected reconciliation.');
    }
    card.querySelector('#staffing-link').value = outcome.setup_url;
    card.querySelector('#staffing-link-result').classList.remove('hidden');
    staffingPending = null;
    staffingNeedsRefresh = true;
    staffingMessage('One-time link verified. Refresh staffing before requesting another seat.');
  } catch (error) {
    if (staffingStillCurrent(check)) staffingMessage(
      `${error.message} The exact action remains protected; do not create a second invitation.`, true);
  } finally {
    staffingBusy = false;
    if (staffingStillCurrent(check))
      card.querySelector('#staffing-submit').disabled = staffingNeedsRefresh;
  }
}

function staffingRosterMessage(message, error = false) {
  const node = document.getElementById('staffing-roster-status');
  if (node) { node.textContent = message; node.classList.toggle('error',error); }
}
async function staffingReadRoster(org) {
  let after = null, first = null;
  const people = [], seen = new Set();
  for (let page = 0; page < 20; page++) {
    const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/office_contractor_roster_snapshot`,{
      method:'POST',headers:authHeaders(true),
      body:JSON.stringify({p_org:org,p_environment:STAFFING_ENVIRONMENT,p_after:after,p_limit:50})
    });
    if (!response.ok) throw new Error(await readableError(response,'Scoped Contractor roster denied.'));
    const value = await response.json();
    if (value?.organization_id !== org || ![2,3].includes(Number(value.caller_tier))
      || !Array.isArray(value.contractors) || value.contractors.length>50
      || (first && value.caller_tier!==first.caller_tier)) {
      throw new Error('Contractor roster scope changed during refresh.');
    }
    first ||= value;
    for (const person of value.contractors) {
      if (!person.user_id || seen.has(person.user_id)
        || (after && person.user_id<=after)) {
        throw new Error('Contractor roster did not satisfy exact paging or team scope.');
      }
      seen.add(person.user_id);
      people.push(person);
    }
    if (!value.next_after) return {tier:Number(first.caller_tier),people};
    if (!value.contractors.length || value.next_after===after) break;
    after=value.next_after;
  }
  throw new Error('Contractor roster exceeds the supported page window.');
}
function staffingRenderRoster() {
  const card=staffingCard(), roster=staffingRoster, staff=staffingSnapshot;
  const personSelect=card.querySelector('#staffing-roster-person');
  const teamSelect=card.querySelector('#staffing-roster-team');
  const previousPerson=personSelect.value, previousTeam=teamSelect.value;
  personSelect.replaceChildren(new Option('Choose an eligible Contractor',''));
  if (roster && staff) {
    for (const person of roster.people) {
      // Busy Contractors are displayed as unavailable, never offered for a
      // roster-only move. The transaction rechecks this under database locks.
      const mayMove=person.idle && (roster.tier===3 || !person.team_id);
      const label=`${person.email || person.user_id} · ${person.team_id
        ? (staff.teams.find(t=>t.team_id===person.team_id)?.name || 'Assigned team')
        : 'Unassigned'}${person.idle?'':' · Open work'}`;
      const option=new Option(label,person.user_id);
      option.disabled=!mayMove;
      personSelect.add(option);
    }
  }
  if ([...personSelect.options].some(x=>x.value===previousPerson && !x.disabled))
    personSelect.value=previousPerson;
  const chosen=roster?.people.find(x=>x.user_id===personSelect.value);
  teamSelect.replaceChildren(new Option('Choose authorized destination',''));
  for (const team of staff?.teams||[]) {
    const option=new Option(team.name,team.team_id);
    option.disabled=chosen?.team_id===team.team_id;
    teamSelect.add(option);
  }
  if ([...teamSelect.options].some(x=>x.value===previousTeam && !x.disabled))
    teamSelect.value=previousTeam;
  const submit=card.querySelector('#staffing-roster-submit');
  submit.disabled=staffingRosterBusy || staffingRosterNeedsRefresh
    || !chosen || !chosen.idle || (roster.tier===2 && Boolean(chosen.team_id))
    || !staff?.teams?.some(t=>t.team_id===teamSelect.value && t.team_id!==chosen.team_id);
}
async function staffingPlaceContractor() {
  const check=staffingIdentity(), card=staffingCard(), roster=staffingRoster;
  if (!staffingStillCurrent(check) || staffingRosterBusy || staffingRosterNeedsRefresh || !roster) return;
  const userId=card.querySelector('#staffing-roster-person').value;
  const teamId=card.querySelector('#staffing-roster-team').value;
  const reason=card.querySelector('#staffing-roster-reason').value.trim();
  const chosen=roster.people.find(p=>p.user_id===userId);
  if (!chosen || !chosen.idle || (roster.tier===2 && chosen.team_id)
    || !staffingSnapshot?.teams.some(t=>t.team_id===teamId)
    || chosen.team_id===teamId || !reason || reason.length>1000) {
    staffingRosterMessage('Select an idle, eligible Contractor and a different authorized team.',true);
    return;
  }
  const request={p_org:check.org,p_user:userId,p_team:teamId,
    p_expected_revision:chosen.revision||null,p_reason:reason,p_environment:STAFFING_ENVIRONMENT};
  if (staffingRosterPending && JSON.stringify(staffingRosterPending.request)!==JSON.stringify(request)) {
    staffingRosterMessage('The original move is unresolved. Restore its exact Contractor, team and reason before retrying.',true);
    return;
  }
  staffingRosterPending ||= {action:crypto.randomUUID(),request};
  staffingRosterBusy=true;
  card.querySelector('#staffing-roster-submit').disabled=true;
  staffingRosterMessage('Confirming exact Contractor roster action…');
  try {
    const response=await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/manage_idle_contractor_roster`,{
      method:'POST',headers:authHeaders(true),
      body:JSON.stringify({...request,p_action:staffingRosterPending.action})
    });
    const outcome=await response.json().catch(()=>({}));
    if (!staffingStillCurrent(check)) return;
    if (!response.ok || outcome.action_id!==staffingRosterPending.action
      || outcome.user_id!==userId || outcome.new_team_id!==teamId
      || !outcome.revision) throw new Error(
        outcome.message||'Move outcome needs reconciliation under the same action.');
    staffingRosterPending=null;
    staffingRosterNeedsRefresh=true;
    staffingRosterMessage('Server confirmed the roster change. Refresh staffing before another action.');
  } catch (error) {
    if (staffingStillCurrent(check)) staffingRosterMessage(
      `${error.message} Original action retained for safe retry; active jobs have not been handed off.`,true);
  } finally {
    staffingRosterBusy=false;
    if (staffingStillCurrent(check)) staffingRenderRoster();
  }
}

// Review and confirm through the one existing audited no-evidence handoff
// transaction. This cannot reassign an active WO or migrate photo authority.
function staffingHandoffMessage(value, error = false) {
  const node = document.getElementById('staffing-handoff-status');
  if (node) { node.textContent = value; node.classList.toggle('error',error); }
}
function staffingHandoffInputs() {
  const card=staffingCard();
  return { p_work_order:card.querySelector('#staffing-handoff-wo').value,
    p_destination:card.querySelector('#staffing-handoff-team').value,
    p_reason:card.querySelector('#staffing-handoff-reason').value.trim() };
}
function staffingRenderHandoff() {
  const card=staffingCard(), work=staffingWork;
  const section=card.querySelector('#staffing-handoff-area');
  section.classList.toggle('hidden',work?.tier!==3);
  if (work?.tier!==3) {
    card.querySelector('#staffing-handoff-review').classList.add('hidden');
    return;
  }
  const job=card.querySelector('#staffing-handoff-wo');
  const destination=card.querySelector('#staffing-handoff-team');
  const oldJob=job.value,oldTeam=destination.value;
  job.replaceChildren(new Option('Choose an authorized work order',''));
  for (const row of work.rows) job.add(
    new Option(`${row.wo_number||'Work order'} · ${row.property_address||'Address not listed'}`,
      row.work_order_id));
  destination.replaceChildren(new Option('Choose another authorized team',''));
  for (const team of staffingSnapshot?.teams||[])
    destination.add(new Option(team.name,team.team_id));
  if ([...job.options].some(o=>o.value===oldJob)) job.value=oldJob;
  if ([...destination.options].some(o=>o.value===oldTeam)) destination.value=oldTeam;
  const selected=work.rows.find(w=>w.work_order_id===job.value);
  for (const option of destination.options) option.disabled=Boolean(selected&&option.value===selected.team_id);
  if (destination.selectedOptions[0]?.disabled) destination.value='';
  card.querySelector('#staffing-handoff-preview').disabled=
    staffingHandoffBusy || staffingHandoffNeedsRefresh || Boolean(staffingHandoffPending);
  card.querySelector('#staffing-handoff-confirm').disabled=
    staffingHandoffBusy || staffingHandoffNeedsRefresh || !staffingHandoffPreview;
}
async function staffingPreviewHandoff() {
  const check=staffingIdentity(), card=staffingCard(), req=staffingHandoffInputs();
  if (!staffingStillCurrent(check)||staffingWork?.tier!==3||staffingHandoffBusy
    ||staffingHandoffPending||staffingHandoffNeedsRefresh) return;
  const row=staffingWork.rows.find(w=>w.work_order_id===req.p_work_order);
  if (!row||!staffingSnapshot?.teams.some(t=>t.team_id===req.p_destination)
    ||row.team_id===req.p_destination||!req.p_reason||req.p_reason.length>1000) {
    staffingHandoffMessage('Choose a listed job, another authorized team and a reason.',true); return;
  }
  staffingHandoffPreview=null;
  card.querySelector('#staffing-handoff-review').classList.add('hidden');
  staffingHandoffBusy=true; staffingRenderHandoff();
  staffingHandoffMessage('Checking exact current work and team eligibility…');
  try {
    const response=await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/preview_work_order_team_handoff`,{
      method:'POST',headers:authHeaders(true),
      body:JSON.stringify({p_work_order:req.p_work_order,
        p_destination:req.p_destination,p_environment:STAFFING_ENVIRONMENT})
    });
    const review=await response.json().catch(()=>({}));
    if (!staffingStillCurrent(check)) return;
    if (!response.ok) throw new Error(review.message||'Handoff review is not authorized.');
    if (review.organization_id!==check.org||review.work_order_id!==req.p_work_order
      ||review.old_team_id!==row.team_id||review.new_team_id!==req.p_destination
      ||typeof review.eligible!=='boolean'
      ||(review.eligible&&!/^[0-9a-f]{32}$/.test(review.review_fingerprint||''))) {
      throw new Error('Handoff review identity changed; reload before attempting transfer.');
    }
    if (!review.eligible) {
      staffingHandoffMessage(review.block_reason||'This job has protected work and cannot be handed off.',true);
      return;
    }
    staffingHandoffPreview={request:req,fingerprint:review.review_fingerprint};
    card.querySelector('#staffing-handoff-review-text').textContent=
      `Move unassigned job ${row.wo_number||row.work_order_id} from ${review.old_team_name} to ${review.new_team_name}? ${req.p_reason}`;
    card.querySelector('#staffing-handoff-review').classList.remove('hidden');
    staffingHandoffMessage('Eligible now. Confirmation will recheck the same fingerprint under lock.');
  } catch(error) {
    if (staffingStillCurrent(check)) staffingHandoffMessage(error.message,true);
  } finally {
    staffingHandoffBusy=false;
    if (staffingStillCurrent(check)) staffingRenderHandoff();
  }
}
async function staffingConfirmHandoff() {
  const check=staffingIdentity(), card=staffingCard(), preview=staffingHandoffPreview;
  if (!staffingStillCurrent(check)||staffingWork?.tier!==3||staffingHandoffBusy
    ||staffingHandoffNeedsRefresh||!preview) return;
  const req={p_work_order:preview.request.p_work_order,
    p_destination:preview.request.p_destination,
    p_expected_fingerprint:preview.fingerprint,
    p_reason:preview.request.p_reason,p_environment:STAFFING_ENVIRONMENT};
  if (JSON.stringify(staffingHandoffInputs())!==JSON.stringify(preview.request)) {
    staffingHandoffMessage('Restore the exact reviewed fields before retrying.',true); return;
  }
  if (staffingHandoffPending && JSON.stringify(staffingHandoffPending.request)!==JSON.stringify(req)) {
    staffingHandoffMessage('An earlier handoff is unresolved. Retry only its original reviewed action.',true); return;
  }
  staffingHandoffPending ||= {action:crypto.randomUUID(),request:req};
  staffingHandoffBusy=true; staffingRenderHandoff();
  staffingHandoffMessage('Confirming exact audited team handoff…');
  try {
    const response=await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/handoff_work_order_team`,{
      method:'POST',headers:authHeaders(true),
      body:JSON.stringify({...req,p_action:staffingHandoffPending.action})
    });
    const outcome=await response.json().catch(()=>({}));
    if (!staffingStillCurrent(check)) return;
    if (!response.ok||outcome.status!=='HANDED_OFF'
      ||outcome.action_id!==staffingHandoffPending.action
      ||outcome.work_order_id!==req.p_work_order
      ||outcome.new_team_id!==req.p_destination)
      throw new Error(outcome.message||'Handoff outcome needs exact-action reconciliation.');
    staffingHandoffPending=null;
    staffingHandoffPreview=null;
    staffingHandoffNeedsRefresh=true;
    card.querySelector('#staffing-handoff-review').classList.add('hidden');
    staffingHandoffMessage('Server confirmed audited handoff. Refresh work before another move.');
  } catch(error) {
    if (staffingStillCurrent(check)) staffingHandoffMessage(
      `${error.message} Retain the exact action for safe retry.`,true);
  } finally {
    staffingHandoffBusy=false;
    if (staffingStillCurrent(check)) staffingRenderHandoff();
  }
}
function staffingSignedOut() {
  staffingGeneration++;
  staffingSnapshot = null;
  staffingPending = null;
  staffingRoster = null;
  staffingRosterPending = null;
  staffingRosterBusy = false;
  staffingRosterNeedsRefresh = false;
  staffingWork = null;
  staffingWorkBusy = false;
  staffingHandoffPreview = null;
  staffingHandoffPending = null;
  staffingHandoffBusy = false;
  staffingHandoffNeedsRefresh = false;
  staffingBusy = false;
  staffingNeedsRefresh = false;
  const card = document.getElementById('staffing-card');
  if (card) {
    card.classList.add('hidden');
    card.querySelector('#staffing-link').value = '';
    card.querySelector('#staffing-link-result').classList.add('hidden');
    card.querySelector('#staffing-invite-form').reset();
    card.querySelector('#staffing-roster-form').reset();
    card.querySelector('#staffing-roster-person').replaceChildren();
    card.querySelector('#staffing-roster-team').replaceChildren();
    card.querySelector('#staffing-work-rows').replaceChildren();
    card.querySelector('#staffing-work-more').classList.add('hidden');
    card.querySelector('#staffing-work-status').textContent = '';
    card.querySelector('#staffing-handoff-form').reset();
    card.querySelector('#staffing-handoff-review').classList.add('hidden');
    card.querySelector('#staffing-handoff-area').classList.add('hidden');
    staffingHandoffMessage('');
    staffingRosterMessage('');
  }
}
signOutButton.addEventListener('click', staffingSignedOut);
