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
      <h2>Team staffing</h2><p id="staffing-account" class="muted"></p>
    </div><button type="button" id="staffing-sign-out" class="secondary">Sign Out</button></div>
    <p class="muted">Only your server-authorized teams and available Admin seats appear here.
      Job and photo controls are not enabled on this staffing screen.</p>
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
async function showScopedStaffingPortal(organizationId) {
  if (currentUser?.app_metadata?.role !== 'SUPERVISOR'
      || currentUser.app_metadata.organization_id !== organizationId) {
    throw new Error('Verified Supervisor account required.');
  }
  const check = staffingIdentity();
  const [snapshot, roster] = await Promise.all([
    staffingReadSnapshot(organizationId), staffingReadRoster(organizationId)
  ]);
  if (!staffingStillCurrent(check)) throw new Error('The Supervisor session changed.');
  staffingSnapshot = snapshot;
  staffingRoster = roster;
  const card = staffingCard();
  loginCard.classList.add('hidden');
  resultsCard.classList.add('hidden');
  card.classList.remove('hidden');
  card.querySelector('#staffing-account').textContent = currentUser.email || 'Supervisor account';
  staffingRender();
  staffingRenderRoster();
}
async function staffingRefresh() {
  const check = staffingIdentity();
  if (!staffingStillCurrent(check)) throw new Error('Sign in as an authorized Supervisor.');
  if (staffingRosterPending) {
    throw new Error('Reconcile the exact pending Contractor action before refreshing staffing.');
  }
  const [result, roster] = await Promise.all([
    staffingReadSnapshot(check.org), staffingReadRoster(check.org)
  ]);
  if (!staffingStillCurrent(check)) return;
  staffingSnapshot = result;
  staffingRoster = roster;
  staffingRosterNeedsRefresh = false;
  staffingRender();
  staffingRenderRoster();
  staffingMessage('Current seat allowance and exact team permissions verified.');
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

function staffingSignedOut() {
  staffingGeneration++;
  staffingSnapshot = null;
  staffingPending = null;
  staffingRoster = null;
  staffingRosterPending = null;
  staffingRosterBusy = false;
  staffingRosterNeedsRefresh = false;
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
    staffingRosterMessage('');
  }
}
signOutButton.addEventListener('click', staffingSignedOut);
