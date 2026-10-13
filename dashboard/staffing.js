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
let staffingDetailGeneration = 0;
let staffingWorkDetail = null;
let staffingWorkEditPending = null;
let staffingWorkEditBusy = false;
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
      Only due-date corrections and appended instructions are editable here. Assignments, photos and Send remain unavailable.</p>
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
        <thead><tr><th>Team</th><th>Address</th><th>WO</th><th>Status</th><th>Due</th><th>Details</th></tr></thead>
        <tbody id="staffing-work-rows"></tbody>
      </table></div>
      <button id="staffing-work-more" type="button" class="secondary hidden">More authorized work</button>
      <section id="staffing-work-detail" class="subsection hidden" aria-label="Selected work order">
        <div class="row between gap"><h4>Selected work order</h4>
          <button id="staffing-work-detail-close" type="button" class="secondary">Close details</button></div>
        <p id="staffing-work-detail-status" class="muted" role="status" aria-live="polite"></p>
        <dl id="staffing-work-detail-fields"></dl>
        <form id="staffing-work-edit-form" class="admin-form hidden" autocomplete="off">
          <p class="muted">Correct due date or append instructions; existing instructions stay intact.</p>
          <label>Corrected due date<input id="staffing-work-edit-due" type="date" required></label>
          <label>Additional instructions (append only)
            <textarea id="staffing-work-edit-note" maxlength="1000"></textarea></label>
          <label>Correction reason<input id="staffing-work-edit-reason" maxlength="1000" required></label>
          <button id="staffing-work-edit-submit" type="submit">Save correction</button>
        </form>
      </section>
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
  card.querySelector('#staffing-work-detail-close').addEventListener('click', () => {
    if (staffingWorkEditPending || staffingWorkEditBusy || SupervisorPhotoReview.blocked) {
      card.querySelector('#staffing-work-detail-status').textContent =
        'Resolve the exact pending correction before closing this job.';
      return;
    }
    staffingClearWorkDetail();
  });
  card.querySelector('#staffing-work-edit-form').addEventListener('submit', event => {
    event.preventDefault();
    void staffingSaveWorkCorrection();
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
  card.querySelector('#staffing-handoff-form').addEventListener('submit', event => event.preventDefault());
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
  if (!response.ok) {
    const error = new Error(await readableError(response, 'Current Supervisor work access denied.'));
    error.status = response.status;
    throw error;
  }
  const value = await response.json();
  if (value?.organization_id !== org || ![1,2,3].includes(Number(value.caller_tier))
    || !/^[a-f0-9]{32}$/.test(value.scope_fingerprint || '')
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
    scopeFingerprint: value.scope_fingerprint, nextAfter: value.next_after || null };
}
function staffingClearWorkDetail() {
  SupervisorAssignmentCandidates.reset();
  SupervisorPhotoReview.reset();
  staffingDetailGeneration++;
  staffingWorkDetail = null;
  const section = document.getElementById('staffing-work-detail');
  if (section) {
    section.classList.add('hidden');
    section.querySelector('#staffing-work-detail-status').textContent = '';
    section.querySelector('#staffing-work-detail-fields').replaceChildren();
    section.querySelector('#staffing-work-edit-form').classList.add('hidden');
    section.querySelector('#staffing-work-edit-form').reset();
  }
}
function staffingRenderDetail() {
  const section = document.getElementById('staffing-work-detail');
  if (!section || !staffingWorkDetail) return;
  const details = section.querySelector('#staffing-work-detail-fields');
  details.replaceChildren();
  for (const [label, key] of [
    ['Team','team_name'],['Work order','wo_number'],['Address','property_address'],
    ['Work type','work_type'],['Instructions','instructions'],
    ['Field status','field_status'],['Due','due_date'],['Created','created_at']
  ]) {
    const title = document.createElement('dt');
    title.textContent = label;
    const value = document.createElement('dd');
    value.textContent = staffingWorkDetail[key] == null ? '—' : String(staffingWorkDetail[key]);
    details.append(title,value);
  }
  // Read only: distinguish the phone's durable download receipt from
  // a Contractor's explicit Accept. Neither fact is inferred from Start.
  const assignment = staffingWorkDetail.assignment;
  if (assignment && typeof assignment === 'object') {
    for (const [label, value] of [
      ['Current assignee', assignment.assignee_label],
      ['Phone download received', assignment.download_received_at],
      ['Contractor accepted', assignment.human_accepted_at],
      ['Pending reassignment to', assignment.pending_assignee_label],
      ['Reassignment requested', assignment.reassignment_requested_at]
    ]) {
      const title = document.createElement('dt');
      title.textContent = label;
      const entry = document.createElement('dd');
      entry.textContent = value == null || value === '' ? 'Not confirmed' : String(value);
      details.append(title,entry);
    }
  }
  const canCorrect = ['ASSIGNED','IN_PROGRESS'].includes(staffingWorkDetail.field_status)
    && Boolean(staffingWorkDetail.work_revision) && Boolean(staffingWorkDetail.updated_at);
  const form = section.querySelector('#staffing-work-edit-form');
  form.classList.toggle('hidden', !canCorrect);
  if (canCorrect) {
    form.querySelector('#staffing-work-edit-due').value = staffingWorkDetail.due_date || '';
    form.querySelector('#staffing-work-edit-note').value = '';
    form.querySelector('#staffing-work-edit-reason').value = '';
    form.querySelector('#staffing-work-edit-submit').disabled = staffingWorkEditBusy;
  }
  section.querySelector('#staffing-work-detail-status').textContent =
    canCorrect ? 'Current team authorization confirmed. Due date and added instructions may be corrected.'
      : 'Current scope confirmed. This job is not eligible for schedule correction.';
  section.classList.remove('hidden');
}
async function staffingOpenWorkDetail(workOrderId) {
  const check = staffingIdentity(), work = staffingWork;
  if (!staffingStillCurrent(check) || !work ||
    !work.rows.some(row => row.work_order_id === workOrderId)) return;
  if (staffingWorkEditPending || staffingWorkEditBusy || SupervisorPhotoReview.blocked) {
    staffingCard().querySelector('#staffing-work-detail-status').textContent =
      'Resolve the pending exact correction before changing jobs.';
    return;
  }
  staffingClearWorkDetail();
  const generation = staffingDetailGeneration, row = work.rows.find(r=>r.work_order_id===workOrderId);
  const section = staffingCard().querySelector('#staffing-work-detail');
  section.classList.remove('hidden');
  section.querySelector('#staffing-work-detail-status').textContent = 'Checking current work scope…';
  try {
    const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/office_supervisor_work_detail`,{
      method:'POST',headers:authHeaders(true),
      body:JSON.stringify({p_org:check.org,p_work_order:workOrderId,
        p_expected_scope_fingerprint:work.scopeFingerprint})
    });
    if (!staffingStillCurrent(check) || generation !== staffingDetailGeneration) return;
    if (!response.ok) {
      if ([401,403,409].includes(response.status)) {
        signOutButton.click();
        setLoginStatus('Supervisor work scope needs a fresh sign-in.',true);
        return;
      }
      throw new Error(await readableError(response,'Selected work order is unavailable.'));
    }
    const result = await response.json();
    if (!staffingStillCurrent(check) || generation !== staffingDetailGeneration) return;
    const detail = result?.work_order;
    if (result?.organization_id !== check.org || result.caller_tier !== work.tier
      || result.scope_fingerprint !== work.scopeFingerprint
      || !detail || detail.work_order_id !== workOrderId || detail.team_id !== row.team_id
      || staffingWork?.scopeFingerprint !== work.scopeFingerprint
      || !staffingWork.rows.some(r=>r.work_order_id===workOrderId&&r.team_id===detail.team_id)) {
      signOutButton.click();
      setLoginStatus('Supervisor work scope needs a fresh sign-in.',true);
      return;
    }
    staffingWorkDetail = detail;
    staffingRenderDetail();
    SupervisorPhotoReview.mount(section);
    SupervisorAssignmentCandidates.mount(section);
  } catch (error) {
    if (staffingStillCurrent(check) && generation === staffingDetailGeneration) {
      section.querySelector('#staffing-work-detail-status').textContent = error.message;
    }
  }
}
async function staffingSaveWorkCorrection() {
  const check = staffingIdentity(), work = staffingWork, detail = staffingWorkDetail;
  if (!staffingStillCurrent(check) || !work || !detail || staffingWorkEditBusy) return;
  const section = staffingCard().querySelector('#staffing-work-detail');
  const due = section.querySelector('#staffing-work-edit-due').value;
  const note = section.querySelector('#staffing-work-edit-note').value.trim();
  const reason = section.querySelector('#staffing-work-edit-reason').value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !reason || reason.length > 1000
    || note.length > 1000 || (due === detail.due_date && !note)) {
    section.querySelector('#staffing-work-detail-status').textContent =
      'Enter a changed due date or additional instructions, plus a reason.';
    return;
  }
  const request = {
    p_org: check.org, p_work_order: detail.work_order_id,
    p_expected_scope_fingerprint: work.scopeFingerprint,
    p_expected_updated_at: detail.updated_at,
    p_expected_work_revision: detail.work_revision,
    p_due_date: due, p_append_note: note, p_reason: reason
  };
  if (staffingWorkEditPending &&
    JSON.stringify(staffingWorkEditPending.request) !== JSON.stringify(request)) {
    section.querySelector('#staffing-work-detail-status').textContent =
      'A correction outcome is uncertain. Restore its exact original inputs to retry.';
    return;
  }
  staffingWorkEditPending ||= { action: crypto.randomUUID(), request };
  const action = staffingWorkEditPending.action;
  const generation = staffingDetailGeneration;
  staffingWorkEditBusy = true;
  section.querySelector('#staffing-work-edit-submit').disabled = true;
  section.querySelector('#staffing-work-detail-status').textContent =
    'Saving current authorized correction…';
  try {
    const response = await adminFetch(SUPABASE_URL +
      '/rest/v1/rpc/office_supervisor_correct_work_schedule', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ p_action: action, ...request })
    });
    if (!staffingStillCurrent(check) || generation !== staffingDetailGeneration) return;
    if (!response.ok) {
      if ([401,403,409].includes(response.status)) {
        signOutButton.click();
        setLoginStatus('Supervisor job authorization or revision changed. Sign in and reload.', true);
        return;
      }
      if (response.status >= 500) throw new Error('Server correction outcome uncertain.');
      const message = await readableError(response, 'Correction rejected.');
      staffingWorkEditPending = null;
      throw new Error(message);
    }
    const saved = await response.json();
    if (!staffingStillCurrent(check) || generation !== staffingDetailGeneration) return;
    if (saved?.action_id !== action || saved.work_order_id !== detail.work_order_id
      || saved.team_id !== detail.team_id || saved.due_date !== request.p_due_date
      || saved.status !== 'SAVED' || !saved.updated_at || !saved.work_revision
      || staffingWork?.scopeFingerprint !== request.p_expected_scope_fingerprint) {
      signOutButton.click();
      setLoginStatus('Supervisor correction receipt did not match the authorized request.', true);
      return;
    }
    staffingWorkEditPending = null;
    staffingWorkDetail = { ...detail, due_date: saved.due_date,
      instructions: saved.instructions, updated_at: saved.updated_at,
      work_revision: saved.work_revision };
    const row = staffingWork.rows.find(r => r.work_order_id === detail.work_order_id);
    if (row) row.due_date = saved.due_date;
    staffingRenderWork();
    staffingRenderDetail();
    section.querySelector('#staffing-work-detail-status').textContent =
      'Server saved the correction, actor and reason.';
  } catch (error) {
    if (staffingStillCurrent(check) && generation === staffingDetailGeneration) {
      section.querySelector('#staffing-work-detail-status').textContent =
        error.message + (staffingWorkEditPending ? ' Retry with the same inputs.' : '');
    }
  } finally {
    staffingWorkEditBusy = false;
    if (staffingStillCurrent(check) && generation === staffingDetailGeneration) {
      section.querySelector('#staffing-work-edit-submit').disabled = false;
    }
  }
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
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary staffing-view-detail';
    button.textContent = 'View details';
    button.setAttribute('aria-label',`View details for ${row.wo_number || row.work_order_id}`);
    button.addEventListener('click', () => void staffingOpenWorkDetail(row.work_order_id));
    action.append(button);
    tr.append(action);
    rows.append(tr);
  }
  card.querySelector('#staffing-work-status').textContent = work
    ? `Tier ${work.tier} · ${work.rows.length} authorized jobs loaded (guarded correction only).`
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
    if (page.tier !== current.tier || page.scopeFingerprint !== current.scopeFingerprint
      || page.rows.some(row => current.rows.some(old => old.work_order_id === row.work_order_id))
      || (page.nextAfter && page.nextAfter === current.nextAfter)) {
      throw new Error('Supervisor scope changed; refresh before viewing more jobs.');
    }
    staffingWork = { tier: current.tier, scopeFingerprint: current.scopeFingerprint,
      rows: [...current.rows, ...page.rows], nextAfter: page.nextAfter };
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
  if (staffingWorkEditPending || staffingWorkEditBusy || SupervisorPhotoReview.blocked) {
    throw new Error('Retry the exact pending job correction before refreshing.');
  }
  staffingClearWorkDetail();
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

// Review and confirm through the existing audited handoff and exact-recovery owners.
// Started assignments remain blocked until their separate consent gate is ready.
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
    staffingHandoffBusy || staffingHandoffNeedsRefresh || (!staffingHandoffPreview && !staffingHandoffPending);
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
    if (JSON.stringify(staffingHandoffInputs())!==JSON.stringify(req)) {
      throw new Error('Handoff selection changed while reviewing; review the current fields again.');
    }
    if (!response.ok) throw new Error(review.message||'Handoff review is not authorized.');
    if (review.organization_id!==check.org||review.work_order_id!==req.p_work_order
      ||review.old_team_id!==row.team_id||review.new_team_id!==req.p_destination
      ||typeof review.eligible!=='boolean'
      ||(review.eligible&&!/^[0-9a-f]{32}$/.test(review.review_fingerprint||''))) {
      throw new Error('Handoff review identity changed; reload before attempting transfer.');
    }
    if (!review.eligible) {
      if (review.consent_possible && review.consent_status==='NOT_REQUESTED'
        && /^[0-9a-f]{32}$/.test(review.review_fingerprint||'')) {
        staffingHandoffPreview={request:req,fingerprint:review.review_fingerprint,mode:'CONSENT'};
        card.querySelector('#staffing-handoff-confirm').textContent='Request Contractor consent';
        card.querySelector('#staffing-handoff-review-text').textContent=
          'Ask the original Contractor to approve changing the responsible office team for '
          +(row.wo_number||row.work_order_id)+'. This does not reassign the job, release photos, or move work.';
        card.querySelector('#staffing-handoff-review').classList.remove('hidden');
        staffingHandoffMessage('Consent request is separate from a handoff. Contractor must approve online.');
      } else {
        staffingHandoffMessage(review.consent_status==='PENDING'
          ? 'Contractor consent is pending. The original office still owns this job.'
          : review.consent_status==='APPROVED'
            ? 'Contractor consent was approved; active handoff remains gated until exact assignment continuity is verified.'
            : review.block_reason||'This job has protected work and cannot be handed off.',true);
      }
      return;
    }
    card.querySelector('#staffing-handoff-confirm').textContent='Confirm reviewed handoff';
    staffingHandoffPreview={request:req,fingerprint:review.review_fingerprint,mode:'MOVE'};
    const historical=review.handoff_kind==='FIELD_COMPLETE';
    const active=review.handoff_kind==='IN_PROGRESS';
    if((historical||active) && ((historical && review.field_status!=='FIELD_COMPLETE')
      ||(active && review.field_status!=='IN_PROGRESS')
      ||!Number.isSafeInteger(review.recovery_recipient_count)||review.recovery_recipient_count<0
      ||!Number.isSafeInteger(review.protected_photo_count)||review.protected_photo_count<0
      ||!review.original_run_id||!review.original_assignment_id||!review.original_assignee_id)) {
      staffingHandoffPreview=null;
      throw new Error('Exact old assignment or photo recovery changed; reload before handoff.');
    }
    card.querySelector('#staffing-handoff-review-text').textContent=
      `Move ${active?'in-progress':historical?'field-complete':'unassigned'} job ${row.wo_number||row.work_order_id} from ${review.old_team_name} to ${review.new_team_name}? ${req.p_reason}`
      +(active?` Contractor approved this exact office-team change. Original assignment, run, protected photos and Contractor stay fixed; ${review.recovery_recipient_count} former office users retain exact recovery for ${review.protected_photo_count} existing photos.`
       :historical?` Original Contractor and photo identities stay fixed. ${review.recovery_recipient_count} former office users retain recovery of ${review.protected_photo_count} existing photos.`:'');
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
    ||staffingHandoffNeedsRefresh||(!preview&&!staffingHandoffPending)) return;
  const consent=staffingHandoffPending?.mode==='CONSENT'
    || (!staffingHandoffPending && preview?.mode==='CONSENT');
  const req=staffingHandoffPending?.request || (preview && {
    p_work_order:preview.request.p_work_order,
    p_destination:preview.request.p_destination,
    p_expected_fingerprint:preview.fingerprint,
    p_reason:preview.request.p_reason,p_environment:STAFFING_ENVIRONMENT});
  const reviewedInputs={p_work_order:req.p_work_order,p_destination:req.p_destination,p_reason:req.p_reason};
  if (JSON.stringify(staffingHandoffInputs())!==JSON.stringify(reviewedInputs)) {
    staffingHandoffMessage('Restore the exact reviewed fields before retrying.',true); return;
  }
  if (staffingHandoffPending && JSON.stringify(staffingHandoffPending.request)!==JSON.stringify(req)) {
    staffingHandoffMessage('An earlier handoff is unresolved. Retry only its original reviewed action.',true); return;
  }
  staffingHandoffPending ||= {action:crypto.randomUUID(),request:req,mode:consent?'CONSENT':'MOVE'};
  staffingHandoffBusy=true; staffingRenderHandoff();
  staffingHandoffMessage(consent?'Requesting exact original-Contractor consent…':'Confirming exact audited team handoff…');
  try {
    const response=await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/${consent?'request_work_order_team_handoff_consent':'handoff_work_order_team'}`,{
      method:'POST',headers:authHeaders(true),
      body:JSON.stringify({...req,[consent?'p_request':'p_action']:staffingHandoffPending.action})
    });
    const outcome=await response.json().catch(()=>({}));
    if (!staffingStillCurrent(check)) return;
    if (!response.ok
      || (consent
        ? (outcome.status!=='PENDING'||outcome.request_id!==staffingHandoffPending.action
          ||outcome.work_order_id!==req.p_work_order)
        : (outcome.status!=='HANDED_OFF'||outcome.action_id!==staffingHandoffPending.action
          ||outcome.work_order_id!==req.p_work_order||outcome.new_team_id!==req.p_destination)))
      throw new Error(outcome.message||'Exact handoff/consent outcome needs reconciliation.');
    staffingHandoffPending=null;
    staffingHandoffPreview=null;
    staffingHandoffNeedsRefresh=true;
    staffingClearWorkDetail();
    card.querySelector('#staffing-handoff-review').classList.add('hidden');
    staffingHandoffMessage(consent
      ? 'Consent request recorded. Original Contractor can approve or decline in the phone app; job remains unchanged.'
      : 'Server confirmed audited handoff. Refresh work before another move.');
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
  SupervisorPhotoReview.reset();
  staffingWorkEditPending = null;
  staffingWorkEditBusy = false;
  staffingClearWorkDetail();
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
