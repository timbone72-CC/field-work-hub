// Exact scoped Admin setup. This screen never selects a team or grants work;
// the authenticated server RPC verifies the bound invitation and consumes its seat.
const STAFF_SUPABASE_URL = 'https://vyocaujuwrivoqynvitm.supabase.co';
const STAFF_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_UPmj_Y10-mLwJo7soekCpg_BYZ08LNZ';
let staffSetupToken = null;
let staffSetupUser = null;
const check = document.getElementById('invite-check');
const form = document.getElementById('password-form');
const identity = document.getElementById('invite-identity');
const password = document.getElementById('new-password');
const confirm = document.getElementById('confirm-password');
const submit = document.getElementById('set-password');
const status = document.getElementById('setup-status');

function setStatus(message, error = false) {
  status.textContent = message;
  status.className = error ? 'status error' : 'status';
}
function fail(message) {
  staffSetupToken = null;
  staffSetupUser = null;
  check.className = 'check';
  check.textContent = message;
  form.classList.add('hidden');
}
async function apiError(response, fallback) {
  try {
    const body = await response.json();
    return body.error_description || body.msg || body.message || body.error || fallback;
  } catch {
    return fallback;
  }
}
async function startSetup() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get('access_token');
  const type = hash.get('type');
  // Never leave bearer credentials in URL, browser history, copied links, or logs.
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!token || (type && type !== 'invite')) {
    fail('This page requires an approved Admin setup link.');
    return;
  }
  staffSetupToken = token;
  try {
    const response = await fetch(STAFF_SUPABASE_URL + '/auth/v1/user', {
      headers: {
        apikey: STAFF_SUPABASE_PUBLISHABLE_KEY,
        Authorization: 'Bearer ' + token
      }
    });
    if (!response.ok) {
      throw Error(await apiError(response, 'This setup link is invalid or expired.'));
    }
    const user = await response.json();
    if (user.app_metadata?.role !== 'ADMIN' ||
        !user.app_metadata.organization_id ||
        !user.user_metadata?.scoped_admin_invitation_id) {
      throw Error('This is not a Field Work Hub Admin invitation.');
    }
    staffSetupUser = user;
    check.className = 'check pass';
    check.textContent = 'INVITATION VERIFIED';
    identity.textContent = (user.user_metadata?.display_name || 'Admin') + ' • ' + user.email;
    form.classList.remove('hidden');
    password.focus();
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Unable to verify Admin invitation.');
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  setStatus('Finishing Admin setup…');
  try {
    if (!staffSetupToken || !staffSetupUser) {
      throw Error('The setup session is unavailable. Contact the person who invited you.');
    }
    if (password.value.length < 10 || password.value !== confirm.value) {
      throw Error('Enter two matching passwords, at least 10 characters long.');
    }
    const passwordResponse = await fetch(STAFF_SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: {
        apikey: STAFF_SUPABASE_PUBLISHABLE_KEY,
        Authorization: 'Bearer ' + staffSetupToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: password.value })
    });
    if (!passwordResponse.ok) {
      throw Error(await apiError(passwordResponse, 'Unable to save the password.'));
    }
    const activationResponse = await fetch(
      STAFF_SUPABASE_URL + '/rest/v1/rpc/complete_scoped_admin_invitation_activation', {
        method: 'POST',
        headers: {
          apikey: STAFF_SUPABASE_PUBLISHABLE_KEY,
          Authorization: 'Bearer ' + staffSetupToken,
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    );
    if (!activationResponse.ok) {
      throw Error(await apiError(activationResponse,
        'Password saved, but the Team did not authorize this Admin account.'));
    }
    const outcome = await activationResponse.json();
    if (!['ACCEPTED', 'ALREADY_ACTIVATED'].includes(outcome?.status)) {
      throw Error('Admin setup could not be confirmed. Work access remains unavailable.');
    }
    staffSetupToken = null;
    staffSetupUser = null;
    password.value = '';
    confirm.value = '';
    form.classList.add('hidden');
    check.className = 'check pass';
    check.textContent = 'ADMIN ACCOUNT READY';
    setStatus('Your Admin account is ready. Sign in to Field Work Hub Admin.');
  } catch (error) {
    // A confirmed password write is not proof of team/work activation.
    setStatus(error instanceof Error ? error.message : 'Admin setup failed.', true);
  } finally {
    submit.disabled = false;
  }
});
void startSetup();
