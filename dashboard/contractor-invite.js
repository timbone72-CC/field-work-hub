const SUPABASE_URL = 'https://vyocaujuwrivoqynvitm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_UPmj_Y10-mLwJo7soekCpg_BYZ08LNZ';

let inviteAccessToken = null;
let invitedUser = null;

const inviteCheck = document.getElementById('invite-check');
const passwordForm = document.getElementById('password-form');
const identity = document.getElementById('invite-identity');
const passwordInput = document.getElementById('new-password');
const confirmPasswordInput = document.getElementById('confirm-password');
const submitButton = document.getElementById('set-password');
const setupStatus = document.getElementById('setup-status');

bootInvite();

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setSetupStatus('Finishing account setup…', false);

  try {
    const password = passwordInput.value;
    const confirmation = confirmPasswordInput.value;

    if (password.length < 10) {
      throw new Error('Use at least 10 characters for your password.');
    }
    if (password !== confirmation) {
      throw new Error('The two passwords do not match.');
    }
    if (!inviteAccessToken || !invitedUser) {
      throw new Error('The setup session is no longer available. Ask your Admin for a new setup link.');
    }

    const passwordResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${inviteAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });

    if (!passwordResponse.ok) {
      throw new Error(await readableError(passwordResponse, 'Unable to set your password.'));
    }

    const activationResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/complete_contractor_invitation_activation`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${inviteAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    );

    if (!activationResponse.ok) {
      throw new Error(await readableError(activationResponse, 'Password was set, but Team could not activate the Contractor account.'));
    }

    const rows = await activationResponse.json();
    const activation = Array.isArray(rows) ? rows[0] : null;
    if (!activation || activation.status !== 'ACCEPTED') {
      throw new Error('Team did not confirm Contractor activation.');
    }

    inviteAccessToken = null;
    invitedUser = null;
    passwordInput.value = '';
    confirmPasswordInput.value = '';
    passwordForm.classList.add('hidden');
    inviteCheck.className = 'check pass';
    inviteCheck.textContent = 'ACCOUNT READY';
    setSetupStatus('', false);

    const done = document.createElement('p');
    done.className = 'muted';
    done.textContent = 'Your Contractor account is ready. Open the Field Work Hub app and sign in with this email and the password you just chose.';
    inviteCheck.insertAdjacentElement('afterend', done);
  } catch (error) {
    setSetupStatus(error instanceof Error ? error.message : 'Unable to finish account setup.', true);
  } finally {
    submitButton.disabled = false;
  }
});

async function bootInvite() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get('access_token');
  const type = params.get('type');

  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

  if (!accessToken || (type && type !== 'invite')) {
    failInvite('This page needs a valid Contractor setup link. Open the link your Admin shared with you.');
    return;
  }

  inviteAccessToken = accessToken;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${inviteAccessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(await readableError(response, 'This setup link is invalid, expired, or already used.'));
    }

    invitedUser = await response.json();
    const metadata = invitedUser.app_metadata || {};
    const invitationMarker = invitedUser.user_metadata?.team_invitation_id;

    if (metadata.role !== 'CONTRACTOR' || !metadata.organization_id || !invitationMarker) {
      throw new Error('This is not a valid Field Work Hub Contractor setup link.');
    }

    inviteCheck.className = 'check pass';
    inviteCheck.textContent = 'INVITATION VERIFIED';
    identity.textContent = `${invitedUser.user_metadata?.display_name || 'Contractor'} • ${invitedUser.email}`;
    passwordForm.classList.remove('hidden');
    passwordInput.focus();
  } catch (error) {
    inviteAccessToken = null;
    invitedUser = null;
    failInvite(error instanceof Error ? error.message : 'Unable to verify this invitation.');
  }
}

function failInvite(message) {
  inviteCheck.className = 'check';
  inviteCheck.textContent = message;
  passwordForm.classList.add('hidden');
}

async function readableError(response, fallback) {
  try {
    const body = await response.json();
    return body.error_description || body.msg || body.message || body.error || fallback;
  } catch {
    return fallback;
  }
}

function setSetupStatus(message, isError) {
  setupStatus.textContent = message;
  setupStatus.className = isError ? 'status error' : 'status';
}
