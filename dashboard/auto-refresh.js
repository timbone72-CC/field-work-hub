const ADMIN_AUTO_REFRESH_MS = 15_000;
let adminAutoRefreshTimer = null;
let adminAutoRefreshPending = false;
let adminEditSnapshot = null;

const renderSignedInBeforeAutoRefresh = renderSignedIn;
renderSignedIn = function renderSignedInWithAutoRefresh(rows, users, organizationId) {
  const result = renderSignedInBeforeAutoRefresh(rows, users, organizationId);
  setAdminAutoRefreshStatus('Automatic updates on.');
  scheduleAdminAutoRefresh();
  return result;
};

const openEditorBeforeAutoRefresh = openEditor;
openEditor = function openEditorWithSnapshot(workOrderId, selectedRow = null) {
  openEditorBeforeAutoRefresh(workOrderId, selectedRow);
  adminEditSnapshot = JSON.stringify(selectedRow || workOrderRows.find(row => row.id === workOrderId));
};

signOutButton.addEventListener('click', stopAdminAutoRefresh);
document.addEventListener('visibilitychange', resumeAdminAutoRefresh);
window.addEventListener('online', resumeAdminAutoRefresh);
window.addEventListener('offline', () => {
  stopAdminAutoRefresh();
  if (accessToken && currentUser) setAdminAutoRefreshStatus('Offline. Showing the last received data.');
});
window.addEventListener('focus', resumeAdminAutoRefresh);

function adminAutoRefreshAllowed() {
  return Boolean(accessToken && currentUser && !document.hidden && navigator.onLine !== false);
}

function stopAdminAutoRefresh() {
  clearTimeout(adminAutoRefreshTimer);
  adminAutoRefreshTimer = null;
}

function scheduleAdminAutoRefresh(delay = ADMIN_AUTO_REFRESH_MS) {
  stopAdminAutoRefresh();
  if (adminAutoRefreshAllowed()) {
    adminAutoRefreshTimer = setTimeout(refreshAdminViewAutomatically, delay);
  }
}

function resumeAdminAutoRefresh() {
  if (adminAutoRefreshAllowed()) scheduleAdminAutoRefresh(0);
  else stopAdminAutoRefresh();
}

async function refreshAdminViewAutomatically() {
  stopAdminAutoRefresh();
  if (!adminAutoRefreshAllowed() || adminAutoRefreshPending) return;
  if (adminWritesPending || createButton.disabled || saveEditButton.disabled) {
    scheduleAdminAutoRefresh();
    return;
  }

  adminAutoRefreshPending = true;
  const epoch = adminSessionEpoch;
  const writeRevision = adminWriteRevision;
  const organizationId = currentUser.app_metadata.organization_id;

  try {
    const [rows, users, summary, invitations] = await Promise.all([
      fetchWorkOrders(), fetchAssignableUsers(),
      fetchContractorSeatSummary(), fetchPendingContractorInvitations()
    ]);
    if (epoch !== adminSessionEpoch || writeRevision !== adminWriteRevision
        || adminWritesPending || !adminAutoRefreshAllowed()) return;
    verifyAdminRls(rows, organizationId);
    if (!Array.isArray(users)) throw new Error('Unexpected Contractor response.');

    if (typeof JobWorkspace !== 'undefined') JobWorkspace.accept(rows.page);
    const usersChanged = JSON.stringify(users) !== JSON.stringify(assignableUsers);
    const changed = JSON.stringify(rows) !== JSON.stringify(workOrderRows) || usersChanged;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    workOrderRows = rows;
    assignableUsers = users;

    if (typeof JobWorkspace !== 'undefined') JobWorkspace.refreshed(rows);
    if (changed) {
      if (usersChanged) preserveAdminAssigneeSelection(assigneeSelect, users);
      assigneeSelect.disabled = users.length === 0;
      if (!editSection.classList.contains('hidden')) {
        if (usersChanged) preserveAdminAssigneeSelection(editAssigneeSelect, users);
        const row = rows.find(item => item.id === editWorkOrderIdInput.value);
        if (typeof JobWorkspace === 'undefined' && JSON.stringify(row) !== adminEditSnapshot) {
          setEditStatus('This work order changed on the server. Your unsaved edits were kept.', false);
        }
      }
      renderRlsSummary(rows);
      renderWorkOrders(rows, organizationId);
      window.scrollTo(scrollX, scrollY);
    }
    renderContractorManagement(summary, invitations);
    const inviteStatus = document.getElementById('contractor-invite-status');
    if (inviteStatus && /JWT expired|dashboard session expired/i.test(inviteStatus.textContent)) {
      setContractorInviteStatus('', false);
    }
    setAdminAutoRefreshStatus('Automatic updates on.');
  } catch (error) {
    if (epoch === adminSessionEpoch && accessToken) {
      setAdminAutoRefreshStatus('Unable to update right now. Showing the last received data; retrying.');
    }
  } finally {
    adminAutoRefreshPending = false;
    scheduleAdminAutoRefresh();
  }
}

function preserveAdminAssigneeSelection(select, users) {
  const selected = select.value;
  fillAssigneeSelect(select, users, 'Choose Team user', selected);
  if (selected && !users.some(user => user.user_id === selected)) {
    const previous = new Option('Previously selected Contractor is unavailable', selected);
    previous.disabled = true;
    select.add(previous);
    select.value = selected;
  }
}

function setAdminAutoRefreshStatus(message) {
  let status = document.getElementById('admin-auto-refresh-status');
  if (!status) {
    status = document.createElement('p');
    status.id = 'admin-auto-refresh-status';
    status.className = 'muted';
    status.setAttribute('role', 'status');
    rlsResult.after(status);
  }
  if (status.textContent !== message) status.textContent = message;
}
