// One-purpose internal TEST-only setup panel. No stored credentials or JWTs.
// It is reached intentionally with ?test-other-org-first-admin=1.
const TEST_OTHER_ADMIN_PANEL_QUERY = 'test-other-org-first-admin';
let testOtherAdminBusy = false;
let testOtherAdminPending = null;
let testOtherAdminFinished = false;

const beforeTestOtherAdminRender = renderSignedIn;
renderSignedIn = function renderWithOtherOrgTestAdmin(...args) {
  const rendered = beforeTestOtherAdminRender(...args);
  renderOtherOrgTestAdminPanel();
  return rendered;
};
signOutButton.addEventListener('click', () => {
  document.getElementById('other-org-test-admin-panel')?.remove();
  testOtherAdminPending = null;
  testOtherAdminFinished = false;
  testOtherAdminBusy = false;
});

function renderOtherOrgTestAdminPanel() {
  if (!new URLSearchParams(location.search).has(TEST_OTHER_ADMIN_PANEL_QUERY) ||
      !accessToken || currentUser?.app_metadata?.role !== 'ADMIN' ||
      document.getElementById('other-org-test-admin-panel')) return;
  const section = document.createElement('details');
  section.id = 'other-org-test-admin-panel';
  section.className = 'admin-action';
  section.open = true;
  section.innerHTML = `
    <summary>Security TEST · Independent company Admin</summary>
    <p class="muted">Product Owner only. Creates one TEST Admin invitation for the
      existing disposable second organization. It does not grant you that
      company's jobs or photos. Use an independently controlled TEST mailbox.</p>
    <form id="other-org-test-admin-form" class="admin-form" autocomplete="off">
      <label>TEST Admin name
        <input id="other-org-test-admin-name" maxlength="200" required></label>
      <label>Independent TEST email
        <input id="other-org-test-admin-email" type="email" maxlength="320"
          autocomplete="off" required></label>
      <label>Reason for security test
        <input id="other-org-test-admin-reason" maxlength="1000" required
          value="Approved separate-company photo authorization TEST"></label>
      <button id="other-org-test-admin-submit" type="submit">Create one TEST setup link</button>
      <p id="other-org-test-admin-status" role="status" class="status"></p>
    </form>
    <div id="other-org-test-admin-result" class="hidden">
      <p class="muted">Bearer setup link: give it only to the TEST Admin.
        The link is not saved. Do not paste it into chat or a repository.</p>
      <label>One-time setup link
        <textarea id="other-org-test-admin-link" rows="4" readonly></textarea></label>
    </div>`;
  const root = document.getElementById('results-card');
  if (!root) return;
  root.append(section);
  section.querySelector('#other-org-test-admin-form').addEventListener(
    'submit', event => { event.preventDefault(); void submitOtherOrgTestAdmin(); });
}

async function submitOtherOrgTestAdmin() {
  if (testOtherAdminBusy || testOtherAdminFinished || !accessToken) return;
  const epoch = adminSessionEpoch;
  const userId = currentUser?.id;
  const section = document.getElementById('other-org-test-admin-panel');
  const status = section?.querySelector('#other-org-test-admin-status');
  const button = section?.querySelector('#other-org-test-admin-submit');
  if (!section || !status || !button) return;
  const input = {
    display_name: section.querySelector('#other-org-test-admin-name').value.trim(),
    email: section.querySelector('#other-org-test-admin-email').value.trim().toLowerCase(),
    reason: section.querySelector('#other-org-test-admin-reason').value.trim()
  };
  if (!input.email || !input.display_name || !input.reason) return;
  if (testOtherAdminPending &&
      JSON.stringify(testOtherAdminPending) !== JSON.stringify(input)) {
    status.textContent = 'An earlier attempt must be reconciled. Do not change the TEST account.';
    status.classList.add('error');
    return;
  }
  testOtherAdminPending = input;
  testOtherAdminBusy = true;
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Checking owner authority and the one available TEST seat…';
  try {
    const response = await adminFetch(`${SUPABASE_URL}/functions/v1/admin-invite-contractor`, {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ operation: 'test_other_org_first_admin', ...input })
    });
    const result = await response.json().catch(() => ({}));
    if (epoch !== adminSessionEpoch || userId !== currentUser?.id ||
        !document.getElementById('other-org-test-admin-panel')) return;
    if (!response.ok || result.status !== 'BOUND' || !result.setup_url ||
        result.action_id !== result.team_id ||
        result.organization_id === currentUser?.app_metadata?.organization_id) {
      throw Error(result.error || 'TEST Admin invitation could not be confirmed.');
    }
    section.querySelector('#other-org-test-admin-link').value = result.setup_url;
    section.querySelector('#other-org-test-admin-result').classList.remove('hidden');
    section.querySelector('#other-org-test-admin-form').reset();
    testOtherAdminFinished = true;
    testOtherAdminPending = null;
    status.textContent = 'One TEST setup link created. No other-company work access was granted to you.';
  } catch (error) {
    if (epoch === adminSessionEpoch && userId === currentUser?.id) {
      status.classList.add('error');
      status.textContent = (error instanceof Error ? error.message : 'Unverified invitation.') +
        ' No automatic retry or second invite. Review the original outcome.';
    }
  } finally {
    testOtherAdminBusy = false;
    if (epoch === adminSessionEpoch && userId === currentUser?.id) {
      button.disabled = testOtherAdminFinished || Boolean(testOtherAdminPending);
    }
  }
}
