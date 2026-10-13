const SUPABASE_URL = 'https://vyocaujuwrivoqynvitm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_UPmj_Y10-mLwJo7soekCpg_BYZ08LNZ';
const WO_NUMBER_MODE_STORAGE_KEY = 'fppTeamAdmin.woNumberMode';

let accessToken = null;
let currentUser = null;
let assignableUsers = [];
let workOrderRows = [];

const loginCard = document.getElementById('login-card');
const resultsCard = document.getElementById('results-card');
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginStatus = document.getElementById('login-status');
const signOutButton = document.getElementById('sign-out');
const accountHeading = document.getElementById('account-heading');
const rlsResult = document.getElementById('rls-result');
const workOrders = document.getElementById('work-orders');

const createForm = document.getElementById('create-wo-form');
const createButton = document.getElementById('create-wo');
const createStatus = document.getElementById('create-status');
const woNumberInput = document.getElementById('wo-number');
const woNumberModeInputs = Array.from(document.querySelectorAll('input[name="wo-number-mode"]'));
const customWoNumberField = document.getElementById('custom-wo-number-field');
const rememberWoNumberMode = document.getElementById('remember-wo-number-mode');
const propertyAddressInput = document.getElementById('property-address');
const workTypeInput = document.getElementById('work-type');
const instructionsInput = document.getElementById('instructions');
const dueDateInput = document.getElementById('due-date');
const assigneeSelect = document.getElementById('assignee');

const editSection = document.getElementById('edit-work-order-section');
const editForm = document.getElementById('edit-wo-form');
const editWorkOrderIdInput = document.getElementById('edit-work-order-id');
const editWoNumberInput = document.getElementById('edit-wo-number');
const editPropertyAddressInput = document.getElementById('edit-property-address');
const editWorkTypeInput = document.getElementById('edit-work-type');
const editInstructionsInput = document.getElementById('edit-instructions');
const editDueDateInput = document.getElementById('edit-due-date');
const editAssigneeSelect = document.getElementById('edit-assignee');
const editReassignNote = document.getElementById('edit-reassign-note');
const saveEditButton = document.getElementById('save-edit');
const cancelEditButton = document.getElementById('cancel-edit');
const editStatus = document.getElementById('edit-status');

// Template application requests only editable work instructions; it cannot
// mutate client binding, assigned contractor or any frozen field/run identity.
function applyTemplateInstructions(input, template) {
  const next=String(template.instructions||'');
  if (input.value.trim() && input.value!==next && !window.confirm(
    'Replace the current work instructions with this template’s instructions?')) return false;
  input.value=next;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
const createPhotos = new PhotoRequirementEditor(
  document.getElementById('create-photo-requirements'),() => workTypeInput.value,
  template => applyTemplateInstructions(instructionsInput,template));
const editPhotos = new PhotoRequirementEditor(
  document.getElementById('edit-photo-requirements'),() => editWorkTypeInput.value,
  template => applyTemplateInstructions(editInstructionsInput,template));
// Phase 6B: copy a server-read prior WO into a NEW, unsent draft only.
// Never reuse the old client WO number, assignment, due date, photo evidence,
// package or finished work identity; the user must explicitly create the WO.
// Two distinct new-WO draft choices, never a same-WO corrective run.
// The current authorized WO is read again before using even its address.
function prepareWorkFromSelectedJob(copyPriorDetails) {
  JobWorkspace.guard(async () => {
    const oldId=editWorkOrderIdInput.value;
    const actor=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
    const epoch=adminSessionEpoch;
    if (!oldId || !actor || !org) return;
    try {
      const old=await fetchWorkOrder(oldId);
      if (adminSessionEpoch!==epoch || currentUser?.id!==actor
        || currentUser?.app_metadata?.organization_id!==org
        || !accessToken || editWorkOrderIdInput.value!==oldId) return;
      const snapshot=copyPriorDetails ? PhotoRules.copyPriorSnapshot(old.run?.requirement_snapshot) : null;
      const existingCreateDraft=Boolean(propertyAddressInput.value.trim()
        || workTypeInput.value.trim() || instructionsInput.value.trim()
        || dueDateInput.value || assigneeSelect.value || woNumberInput.value.trim()
        || createPhotos.value?.items?.length || createPhotos.value?.total?.enabled);
      if (existingCreateDraft && !window.confirm(copyPriorDetails
        ? 'Replace the unfinished Create Work Order draft with the previous job details?'
        : 'Replace the unfinished Create Work Order draft with a new custom job at this address?')) return;
      if (adminSessionEpoch!==epoch || currentUser?.id!==actor
        || currentUser?.app_metadata?.organization_id!==org
        || !accessToken || editWorkOrderIdInput.value!==oldId) return;
      if (JobWorkspace.dirty()) throw Error('The current job has unsaved changes. Save or discard them before preparing new work.');
      closeEditor(true);
      createForm.reset();
      applyWoNumberMode('auto');
      rememberWoNumberMode.checked=false;
      propertyAddressInput.value=old.property_address;
      if (copyPriorDetails) {
        workTypeInput.value=old.work_type;
        instructionsInput.value=old.instructions || '';
      }
      createPhotos.load(snapshot);
      fillWorkTypes();
      document.getElementById('create-wo-details').open=true;
      setCreateStatus(copyPriorDetails
        ? 'New work-order draft prepared from prior job. Enter a new due date and assignee; review all fields before creating.'
        : 'New custom work-order draft at this address. Choose work type, instructions, photos, due date and assignee before creating.',false);
      (copyPriorDetails ? dueDateInput : workTypeInput).focus();
    } catch(error) { setEditStatus(error.message,true); }
  });
}
document.getElementById('prepare-repeat-work').addEventListener('click', () => prepareWorkFromSelectedJob(true));
document.getElementById('prepare-custom-work').addEventListener('click', () => prepareWorkFromSelectedJob(false));

function fillWorkTypes() {
  for (const [prefix, input, editor] of [['', workTypeInput, createPhotos], ['edit-', editWorkTypeInput, editPhotos]]) {
    const select = document.getElementById(`${prefix}work-type-choice`);
    select.replaceChildren(new Option('Custom / Other', ''));
    const types = [...new Set([...workOrderRows.map(r => r.work_type), ...editor.templates.map(t => t.work_type)])].filter(Boolean).sort();
    for (const type of types) select.add(new Option(type, type));
    select.value = types.includes(input.value) ? input.value : '';
    input.hidden = !!select.value;
    select.onchange = () => { input.value = select.value; input.hidden = !!select.value; editor.useDefault(); };
    input.onchange = () => editor.refreshSuggestions();
  }
}

for (const input of woNumberModeInputs) {
  input.addEventListener('change', () => {
    applyWoNumberMode(currentWoNumberMode());
    persistWoNumberModePreference();
  });
}

rememberWoNumberMode.addEventListener('change', persistWoNumberModePreference);
restoreWoNumberModePreference();

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoginStatus('Signing in…', false);

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  let loginEpoch;
  try {
    const flight = signInWithPassword(email, password);
    loginEpoch = adminSessionEpoch;
    const session = await flight;
    if (loginEpoch !== adminSessionEpoch) return;
    passwordInput.value = '';
    accessToken = session.access_token;

    currentUser = await fetchCurrentUser();
    const metadata = currentUser.app_metadata || {};

    if (!metadata.organization_id || !['ADMIN', 'SUPERVISOR'].includes(metadata.role)) {
      throw new Error('This account is not authorized for Field Work Hub office access.');
    }
    if (metadata.role === 'SUPERVISOR') {
      // The narrow staffing RPC, not Auth metadata, proves current Tier 2/3
      // authority. No legacy Admin work or photo call runs for this role.
      await showScopedStaffingPortal(metadata.organization_id);
      if (pendingAdminSession) {
        storeAdminSession(pendingAdminSession);
        pendingAdminSession = null;
      }
      return;
    }

    const [rows, users] = await Promise.all([
      fetchWorkOrders(),
      fetchAssignableUsers()
    ]);

    if (loginEpoch !== adminSessionEpoch) return;
    verifyAdminRls(rows, metadata.organization_id);
    renderSignedIn(rows, users, metadata.organization_id);
  } catch (error) {
    // A superseded login must not clear or relabel the newer account's view.
    // A current HTTP 401 already cleared access and displayed its safe error.
    if (loginEpoch !== undefined && loginEpoch !== adminSessionEpoch) return;
    // A denied operational request is not an Auth failure. A fresh server
    // recovery grant read decides whether this identity can enter read-only mode.
    if (error?.status === 403 && accessToken && currentUser?.id) {
      try {
        await RecoveryGallery.show();
        if (pendingAdminSession) {
          storeAdminSession(pendingAdminSession);
          pendingAdminSession = null;
        }
        passwordInput.value = '';
        return;
      } catch {
        // Never treat an unverified photo grant or broken network as authority.
      }
    }
    // If Auth already verified the exact office identity but fetching the
    // first work page timed out, preserve the tab credential, not its stale
    // data. A refresh can restore the signed-in screen after connectivity
    // returns without submitting the password again. Never persist a denied
    // or unverified identity.
    const verifiedRole=currentUser?.app_metadata?.role;
    if (transientAdminConnectionError(error) && pendingAdminSession
        && currentUser?.app_metadata?.organization_id
        && ['ADMIN','SUPERVISOR'].includes(verifiedRole)) {
      storeAdminSession(pendingAdminSession);
      pendingAdminSession=null;
    }
    RecoveryGallery.reset();
    accessToken = null;
    currentUser = null;
    assignableUsers = [];
    workOrderRows = [];
    passwordInput.value = '';
    // A browser request timeout is not a password rejection. Do not
    // misdiagnose the error or suggest resetting an existing account.
    const message=error instanceof Error ? error.message : 'Sign-in failed.';
    const timedOut=error?.name==='TimeoutError'||/signal timed out/i.test(message);
    setLoginStatus(error?.requestStage ? adminLoginFailureMessage(error) : timedOut
      ? 'Field Work Hub connection timed out while checking sign-in. This does not mean your password is wrong. Wait briefly and try again.'
      : message,true);
  }
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setCreateStatus('Creating work order…', false);
  createButton.disabled = true;

  const mode = currentWoNumberMode();
  const rememberMode = rememberWoNumberMode.checked;

  try {
    const createdRows = await createWorkOrder({
      generateWoNumber: mode === 'auto',
      woNumber: mode === 'custom' ? woNumberInput.value.trim() : null,
      propertyAddress: propertyAddressInput.value.trim(),
      workType: workTypeInput.value.trim(),
      instructions: instructionsInput.value.trim(),
      dueDate: dueDateInput.value,
      assignedUserId: assigneeSelect.value,
      requirements: createPhotos.snapshot()
    });

    const created = Array.isArray(createdRows) ? createdRows[0] : null;
    if (!created || !created.work_order_id) {
      throw new Error('The server did not return the created work order.');
    }

    setCreateStatus(`Created and assigned ${created.wo_number}. Waiting for contractor receipt.`, false);
    createForm.reset();
    createPhotos.load(null);
    fillWorkTypes();
    rememberWoNumberMode.checked = rememberMode;
    applyWoNumberMode(mode);
    persistWoNumberModePreference();
    fillAssigneeSelect(assigneeSelect, assignableUsers, 'Choose Team user');
    await refreshWorkOrders();
  } catch (error) {
    setCreateStatus(error instanceof Error ? error.message : 'Unable to create work order.', true);
  } finally {
    createButton.disabled = false;
  }
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (JobWorkspace.needsReload()) { setEditStatus('Reload the latest job before saving again. Your unsaved changes are still here.', true); return; }
  setEditStatus('Saving changes…', false);
  saveEditButton.disabled = true;
  editForm.inert = true;
  let committed = false;
  let afterSave = null;
  const savedId = editWorkOrderIdInput.value;

  try {
    const updatedRows = await updateWorkOrder({
      workOrderId: editWorkOrderIdInput.value,
      woNumber: editWoNumberInput.value.trim(),
      propertyAddress: editPropertyAddressInput.value.trim(),
      workType: editWorkTypeInput.value.trim(),
      instructions: editInstructionsInput.value.trim(),
      dueDate: editDueDateInput.value,
      assignedUserId: editAssigneeSelect.value,
      requirements: editPhotos.snapshot(),
      expectedRevision: editPhotos.expectedRevision
    });

    const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updated || !updated.work_order_id) {
      throw new Error('The server did not return the updated work order.');
    }

    committed = true;
    JobWorkspace.saved();
    afterSave = await JobWorkspace.reconcileSaved(savedId);
    await refreshWorkOrders();

    if (updated.pending_assignee_user_id) {
      setEditStatus('Saved. Reassignment request is waiting for the current contractor to approve or decline.', false);
    } else {
      setEditStatus(`Saved ${updated.wo_number}.`, false);
    }
  } catch (error) {
    if (accessToken) setEditStatus(committed ? (JobWorkspace.needsReload() ? 'Changes saved. Unable to refresh the latest job right now; reload before saving again.' : 'Changes saved. Unable to refresh the job list right now.') : (error instanceof Error ? error.message : 'Unable to update work order.'), true);
  } finally {
    saveEditButton.disabled = false;
    editForm.inert = false;
    if (afterSave && accessToken) afterSave();
  }
});

cancelEditButton.addEventListener('click', closeEditor);

signOutButton.addEventListener('click', () => {
  RecoveryGallery.reset();
  PushDevice.signedOut();
  NotificationCenter.reset();
  accessToken = null;
  currentUser = null;
  assignableUsers = [];
  workOrderRows = [];
  createPhotos.clearAccount(); editPhotos.clearAccount();
  fillWorkTypes();
  workOrders.replaceChildren();
  rlsResult.textContent = '';
  accountHeading.textContent = 'Signed in';
  createForm.reset();
  restoreWoNumberModePreference();
  fillAssigneeSelect(assigneeSelect, [], 'Sign in to load Team users');
  assigneeSelect.disabled = true;
  createStatus.textContent = '';
  closeEditor(true);
  JobWorkspace.reset();
  resultsCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
  emailInput.focus();
  setLoginStatus('Signed out.', false);
});

async function signInWithPassword(email, password) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
  } catch (error) {
    throw adminConnectionFailure(error, 'signing in', startedAt);
  }

  if (!response.ok) {
    throw await adminHttpFailure(response, 'signing in', startedAt);
  }

  try {
    return await response.json();
  } catch (error) {
    throw adminConnectionFailure(error, 'signing in', startedAt);
  }
}

async function fetchCurrentUser() {
  requireAccessToken();
  const response = await adminFetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders() });

  if (!response.ok) {
    throw await adminHttpFailure(response, response.adminRequestStage, response.adminRequestStartedAt);
  }

  return response.json();
}

async function fetchWorkOrders() {
  requireAccessToken();
  JobWorkspace.ensureAccount(currentUser);
  const page = JobWorkspace.request();
  const select = [
    'id',
    'organization_id',
    'client_company_id',
    'assigned_user_id',
    'pending_assignee_user_id',
    'reassignment_requested_at',
    'assignment_received_at',
    'wo_number',
    'property_address',
    'work_type',
    'instructions',
    'due_date',
    'field_status',
    'created_at',
    'current_run_id',
    'run:work_order_runs!work_orders_current_run_same_work_order_fk(requirement_snapshot)'
  ].join(',');

  // Intentionally broad request: no organization_id or assigned_user_id filter.
  // Supabase RLS is the authorization boundary for rows returned here.
  const response = await adminFetch(
    `${SUPABASE_URL}/rest/v1/work_orders?select=${encodeURIComponent(select)}&${JobViewRules.parameters(page)}`,
    { headers: { ...authHeaders(), Prefer: 'count=exact' } }
  );

  if (!response.ok) {
    throw await adminHttpFailure(response, response.adminRequestStage, response.adminRequestStartedAt);
  }

  const rows = await response.json();
  JobWorkspace.accept(page);
  if (!Array.isArray(rows) || rows.length > page.size) throw new Error('Unexpected job page response.');
  rows.page = { ...page, total: JobViewRules.total(response.headers.get('Content-Range')) };
  return rows;
}

// Read-only exact-address sibling lookup. The current signed-in user's RLS
// still authorizes every row, with explicit company and org match checked
// again before rendering. Never use a fuzzy or cross-company property search.
async function fetchAddressWorkOrders(row,offset=0) {
  requireAccessToken();
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(row?.organization_id||'') || !uuid.test(row?.client_company_id||'')
    || !uuid.test(row?.id||'') || typeof row.property_address!=='string'
    || row.property_address.length<3 || row.property_address.length>500)
    throw new Error('Exact company/address identity required.');
  if (!Number.isSafeInteger(offset)||offset<0||offset>100000) throw new Error('Invalid address page.');
  // PostgREST quoted exact string; escaped quotes/backslashes are data, not operators.
  const address='"'+row.property_address.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
  const params=new URLSearchParams({
    select:'id,organization_id,client_company_id,wo_number,property_address',
    organization_id:'eq.'+row.organization_id,
    client_company_id:'eq.'+row.client_company_id,
    property_address:'eq.'+address,
    order:'id.asc',limit:'50',offset:String(offset)
  });
  const response=await adminFetch(`${SUPABASE_URL}/rest/v1/work_orders?${params}`,{
    headers:{...authHeaders(),Prefer:'count=exact'}
  });
  if (!response.ok) throw new Error(await readableError(response,'Unable to load address work orders.'));
  const rows=await response.json();
  if (!Array.isArray(rows)||rows.length>50) throw new Error('Unexpected address-work-order page.');
  verifyAdminRls(rows,row.organization_id);
  if (rows.some(item=>item.client_company_id!==row.client_company_id
    ||item.property_address!==row.property_address))
    throw new Error('Address/company scope mismatch.');
  return {rows,total:JobViewRules.total(response.headers.get('Content-Range'))};
}

async function fetchWorkOrder(id) {
  requireAccessToken();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid job identity.');
  const select = 'id,organization_id,client_company_id,assigned_user_id,pending_assignee_user_id,reassignment_requested_at,assignment_received_at,wo_number,property_address,work_type,instructions,due_date,field_status,created_at,current_run_id,run:work_order_runs!work_orders_current_run_same_work_order_fk(requirement_snapshot)';
  const response = await adminFetch(`${SUPABASE_URL}/rest/v1/work_orders?select=${encodeURIComponent(select)}&id=eq.${id}&limit=1`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readableError(response, 'Unable to open this job.'));
  const rows = await response.json();
  verifyAdminRls(rows, currentUser.app_metadata.organization_id);
  if (rows.length !== 1 || rows[0].id !== id) throw new Error('This job is no longer available to your account.');
  return rows[0];
}

async function fetchAssignableUsers() {
  requireAccessToken();
  const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/admin_list_assignable_users`, {
    method: 'POST',
    headers: authHeaders(true),
    body: '{}'
  });

  if (!response.ok) {
    throw await adminHttpFailure(response, response.adminRequestStage, response.adminRequestStartedAt);
  }

  return response.json();
}

async function createWorkOrder({ generateWoNumber, woNumber, propertyAddress, workType, instructions, dueDate, assignedUserId, requirements }) {
  requireAccessToken();
  const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/admin_create_work_order_v4`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      p_generate_wo_number: generateWoNumber,
      p_wo_number: woNumber,
      p_property_address: propertyAddress,
      p_work_type: workType,
      p_instructions: instructions || null,
      p_due_date: dueDate,
      p_assigned_user_id: assignedUserId,
      p_requirements: requirements
    })
  });

  if (!response.ok) {
    throw new Error(await readableError(response, 'Unable to create work order.'));
  }

  return response.json();
}

async function updateWorkOrder({ workOrderId, woNumber, propertyAddress, workType, instructions, dueDate, assignedUserId, requirements, expectedRevision }) {
  requireAccessToken();
  const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/admin_update_work_order_v4`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      p_work_order_id: workOrderId,
      p_wo_number: woNumber,
      p_property_address: propertyAddress,
      p_work_type: workType,
      p_instructions: instructions || null,
      p_due_date: dueDate,
      p_assigned_user_id: assignedUserId,
      p_requirements: requirements,
      p_expected_revision: expectedRevision
    })
  });

  if (!response.ok) {
    throw new Error(await readableError(response, 'Unable to update work order.'));
  }

  return response.json();
}

async function refreshWorkOrders() {
  const metadata = currentUser.app_metadata || {};
  const rows = await fetchWorkOrders();
  verifyAdminRls(rows, metadata.organization_id);
  workOrderRows = rows;
  renderRlsSummary(rows);
  renderWorkOrders(rows, metadata.organization_id);
}

function verifyAdminRls(rows, expectedOrganizationId) {
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected work-order response.');
  }

  const wrongOrganization = rows.find((row) => row.organization_id !== expectedOrganizationId);
  if (wrongOrganization) {
    throw new Error('RLS CHECK FAILED: a work order from another organization was returned.');
  }

  const numbers = new Set(rows.map((row) => row.wo_number));
  if (numbers.has('TEST-OTHER-ORG-CONTROL')) {
    throw new Error('RLS CHECK FAILED: the other-organization control work order was returned.');
  }
}

function renderSignedIn(rows, users, organizationId) {
  loginCard.classList.add('hidden');
  resultsCard.classList.remove('hidden');
  accountHeading.textContent = `Signed in as ${currentUser.email}`;
  assignableUsers = users;
  workOrderRows = rows;
  renderRlsSummary(rows);
  renderAssignableUsers(users);
  JobWorkspace.populateContractors(users);
  renderWorkOrders(rows, organizationId);
  if(document.getElementById('notification-center').open) NotificationCenter.load();
  Promise.all([createPhotos.reloadTemplates(), editPhotos.reloadTemplates()]).then(fillWorkTypes).catch(e => setCreateStatus(e.message, true));
}

function renderRlsSummary(rows) {
  rlsResult.className = 'check pass';
  rlsResult.textContent = `Work orders updated ${new Date().toLocaleTimeString()}.`;
}

function renderAssignableUsers(users) {
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('No assignable Team users were returned.');
  }
  fillAssigneeSelect(assigneeSelect, users, 'Choose Team user');
  assigneeSelect.disabled = false;
}

function fillAssigneeSelect(select, users, placeholder, selectedUserId = '') {
  select.replaceChildren(new Option(placeholder, ''));
  for (const user of users) {
    select.add(new Option(`${user.email} (${user.role})`, user.user_id));
  }
  if (selectedUserId) {
    select.value = selectedUserId;
  }
}

function renderWorkOrders(rows, organizationId) {
  JobWorkspace.page(rows);
  workOrders.replaceChildren();
  const userById = new Map(assignableUsers.map(user => [user.user_id, user]));
  const table = document.createElement('table');
  table.className = 'job-table';
  const caption = document.createElement('caption'); caption.textContent = 'Current work orders'; caption.className = 'sr-only'; table.append(caption);
  const head = table.createTHead().insertRow();
  for (const title of ['WO / Address', 'Work type', 'Assigned to', 'Due', 'Status / Receipt']) {
    const th = document.createElement('th'); th.scope = 'col'; th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    const title = tr.insertCell();
    const button = document.createElement('button'); button.type = 'button'; button.className = 'job-link';
    button.textContent = row.wo_number;
    button.setAttribute('aria-label', `Open ${row.wo_number}, ${row.property_address}`);
    button.dataset.jobOpenId = row.id;
    button.addEventListener('click', () => JobWorkspace.choose(row.id));
    const address = document.createElement('div'); address.textContent = row.property_address;
    title.append(button, address);
    tr.insertCell().textContent = row.work_type;
    tr.insertCell().textContent = userLabel(userById.get(row.assigned_user_id));
    tr.insertCell().textContent = row.due_date;
    const status = tr.insertCell();
    const field = document.createElement('div'); field.textContent = JobOperationalFacts.project(row).label;
    const receipt = document.createElement('small'); receipt.textContent = row.assignment_received_at ? 'Assignment received' : 'Not yet received';
    status.append(field, receipt);
    if (row.pending_assignee_user_id) {
      const handoff = document.createElement('div'); handoff.className = 'handoff pending'; handoff.textContent = 'Handoff awaiting approval'; status.append(handoff);
    }
  }
  workOrders.append(table);
}

function openEditor(workOrderId, selectedRow = null) {
  const row = selectedRow || workOrderRows.find((item) => item.id === workOrderId);
  if (!row) {
    setEditStatus('Work order is no longer available in the current list.', true);
    return;
  }

  editWorkOrderIdInput.value = row.id;
  editWoNumberInput.value = row.wo_number;
  editPropertyAddressInput.value = row.property_address;
  editWorkTypeInput.value = row.work_type;
  editPhotos.load(row.run?.requirement_snapshot || {}, row.field_status !== "ASSIGNED");
  // Only the server-authorized WO company may scope template suggestions.
  editPhotos.setCompany(row.client_company_id || null);
  fillWorkTypes();
  editInstructionsInput.value = row.instructions || '';
  editDueDateInput.value = row.due_date;

  const selectedAssignee = row.pending_assignee_user_id || row.assigned_user_id;
  fillAssigneeSelect(editAssigneeSelect, assignableUsers, 'Choose Team user', selectedAssignee);

  if (row.field_status === 'ASSIGNED') {
    editAssigneeSelect.disabled = false;
    editReassignNote.textContent = 'Changing the assignee now reassigns immediately. The new contractor must then receive the WO in the app.';
  } else if (row.field_status === 'IN_PROGRESS') {
    editAssigneeSelect.disabled = false;
    editReassignNote.textContent = row.pending_assignee_user_id
      ? 'A reassignment request is already waiting for the current contractor. Choose the current assignee and Save to cancel that request.'
      : 'Changing the assignee sends a request to the current contractor. The WO moves only if that contractor approves.';
  } else {
    editAssigneeSelect.disabled = true;
    editReassignNote.textContent = `Reassignment is locked because field status is ${row.field_status}. Dispatch details may still be corrected.`;
  }

  setEditStatus('', false);
  editSection.classList.remove('hidden');
  JobWorkspace.opened(row);
}

function closeEditor(force = false) {
  if (force !== true) { JobWorkspace.guard(() => closeEditor(true)); return; }
  JobWorkspace.closed();
  editForm.reset();
  editWorkOrderIdInput.value = '';
  editPhotos.setCompany(null);
  editPhotos.load(null);
  editAssigneeSelect.replaceChildren(new Option('Choose Team user', ''));
  editAssigneeSelect.disabled = true;
  editReassignNote.textContent = '';
  editStatus.textContent = '';
  editSection.classList.add('hidden');
}

function currentWoNumberMode() {
  const selected = woNumberModeInputs.find((input) => input.checked);
  return selected ? selected.value : 'auto';
}

function applyWoNumberMode(mode) {
  const normalized = mode === 'custom' ? 'custom' : 'auto';
  for (const input of woNumberModeInputs) {
    input.checked = input.value === normalized;
  }

  const custom = normalized === 'custom';
  customWoNumberField.classList.toggle('hidden', !custom);
  woNumberInput.disabled = !custom;
  woNumberInput.required = custom;
}

function restoreWoNumberModePreference() {
  let saved = null;
  try {
    saved = localStorage.getItem(WO_NUMBER_MODE_STORAGE_KEY);
  } catch {
    saved = null;
  }

  if (saved === 'auto' || saved === 'custom') {
    rememberWoNumberMode.checked = true;
    applyWoNumberMode(saved);
  } else {
    rememberWoNumberMode.checked = false;
    applyWoNumberMode('auto');
  }
}

function persistWoNumberModePreference() {
  try {
    if (rememberWoNumberMode.checked) {
      localStorage.setItem(WO_NUMBER_MODE_STORAGE_KEY, currentWoNumberMode());
    } else {
      localStorage.removeItem(WO_NUMBER_MODE_STORAGE_KEY);
    }
  } catch {
    // Preference storage is optional. Authentication state is never stored here.
  }
}

function userLabel(user) {
  return user ? `${user.email} (${user.role})` : 'Team user';
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function authHeaders(withJson = false) {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`
  };
  if (withJson) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

function requireAccessToken() {
  if (!accessToken) {
    throw new Error('No authenticated session is available.');
  }
}

async function readableError(response, fallback) {
  try {
    const body = await response.json();
    return body.msg || body.message || body.error_description || body.error || fallback;
  } catch {
    return fallback;
  }
}

function setLoginStatus(message, isError) {
  loginStatus.textContent = message;
  loginStatus.classList.toggle('error', isError);
}

function setCreateStatus(message, isError) {
  createStatus.textContent = message;
  createStatus.classList.toggle('error', isError);
}

function setEditStatus(message, isError) {
  editStatus.textContent = message;
  editStatus.classList.toggle('error', isError);
}

JobWorkspace.init();
