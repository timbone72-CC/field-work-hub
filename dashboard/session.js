const ADMIN_SESSION_STORAGE_KEY = 'fppTeamAdmin.tabAuthSession';

let pendingAdminSession = null;
let activeAdminSession = null;
let adminSessionEpoch = 0;
let adminRefreshPromise = null;
let adminWritesPending = 0;
let adminWriteRevision = 0;

const originalSignInWithPassword = signInWithPassword;
signInWithPassword = async function persistedSignInWithPassword(email, password) {
  const epoch = ++adminSessionEpoch;
  activeAdminSession = null;
  const session = await originalSignInWithPassword(email, password);
  if (epoch !== adminSessionEpoch) throw new Error('The Admin session changed.');
  pendingAdminSession = session;
  return session;
};

const originalRenderSignedIn = renderSignedIn;
renderSignedIn = function persistedRenderSignedIn(rows, users, organizationId) {
  const metadata = currentUser && currentUser.app_metadata ? currentUser.app_metadata : {};
  if (pendingAdminSession && metadata.role === 'ADMIN' && metadata.organization_id) {
    storeAdminSession(pendingAdminSession);
    pendingAdminSession = null;
  }
  return originalRenderSignedIn(rows, users, organizationId);
};

signOutButton.addEventListener('click', () => {
  adminSessionEpoch++;
  pendingAdminSession = null;
  adminRefreshPromise = null;
  clearAdminSession();
});

restoreAdminSession();

async function restoreAdminSession() {
  const epoch = adminSessionEpoch;
  const stored = readAdminSession();
  if (!stored) {
    return;
  }

  setLoginStatus('Restoring Admin session…', false);

  try {
    let session = stored;
    if (sessionNeedsRefresh(session)) {
      session = await refreshAdminSession(session.refresh_token);
      if (epoch !== adminSessionEpoch) return;
      storeAdminSession(session);
    }

    if (epoch !== adminSessionEpoch) return;
    storeAdminSession(session);
    accessToken = session.access_token;

    try {
      currentUser = await fetchCurrentUser();
    } catch (firstError) {
      // A timeout / offline response is not an expired JWT. Rotating a
      // refresh token on network uncertainty risks losing a usable session.
      if (epoch !== adminSessionEpoch || firstError?.status !== 401) throw firstError;
      session = await refreshAdminSession(session.refresh_token);
      if (epoch !== adminSessionEpoch) return;
      storeAdminSession(session);
      accessToken = session.access_token;
      currentUser = await fetchCurrentUser();
    }

    if (epoch !== adminSessionEpoch) return;
    const metadata = currentUser.app_metadata || {};
    if (!metadata.organization_id || !['ADMIN', 'SUPERVISOR'].includes(metadata.role)) {
      throw new Error('Stored session is not authorized for office access.');
    }
    if (metadata.role === 'SUPERVISOR') {
      await showScopedStaffingPortal(metadata.organization_id);
      if (epoch !== adminSessionEpoch) return;
      setLoginStatus('', false);
      return;
    }

    const [rows, users] = await Promise.all([
      fetchWorkOrders(),
      fetchAssignableUsers()
    ]);

    if (epoch !== adminSessionEpoch) return;
    verifyAdminRls(rows, metadata.organization_id);
    renderSignedIn(rows, users, metadata.organization_id);
    setLoginStatus('', false);
  } catch (error) {
    if (epoch !== adminSessionEpoch) return;
    if (error?.status === 403 && accessToken && currentUser?.id) {
      try {
        await RecoveryGallery.show();
        if (epoch === adminSessionEpoch) {
          setLoginStatus('', false);
          return; // Valid Auth and exact server-restricted photo recovery; no work access.
        }
      } catch {
        // Server must reauthorize every requested recovery object.
      }
    }
    RecoveryGallery.reset();
    const transient = transientAdminConnectionError(error);
    // Fail closed for visible data, but do not destroy the protected tab
    // refresh credential merely because an authorized read timed out.
    if (!transient) clearAdminSession();
    pendingAdminSession = null;
    accessToken = null;
    currentUser = null;
    assignableUsers = [];
    workOrderRows = [];
    setLoginStatus(error?.requestStage ? adminLoginFailureMessage(error) : transient
      ? 'The connection timed out while restoring your Admin session. Your saved session was preserved; no work data was opened. Try reloading after the connection recovers.'
      : 'Your dashboard session could not be restored. Sign in again.', transient);
  }
}

function transientAdminConnectionError(error) {
  // Only transport/transient HTTP failures are retryable. Invalid or
  // forbidden credentials must still remove the stored operational session.
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
    || error?.name === 'TypeError'
    || [408, 429, 500, 502, 503, 504].includes(error?.status);
}

// Fixed labels only: never retain URLs, query strings, credentials or server
// message/details fields in diagnostics. Keep them in the existing error path.
function adminRequestStage(url) {
  const path = String(url).split('?')[0];
  if (path === `${SUPABASE_URL}/auth/v1/token`) return 'signing in';
  if (path === `${SUPABASE_URL}/auth/v1/user`) return 'verifying your account';
  if (path === `${SUPABASE_URL}/rest/v1/work_orders`) return 'loading work orders';
  if (path === `${SUPABASE_URL}/rest/v1/rpc/admin_list_assignable_users`) return 'loading contractors';
  return 'contacting the dashboard service';
}

function adminConnectionFailure(error, stage, startedAt) {
  const failure = new Error('Field Work Hub connection failed.');
  failure.name = ['TimeoutError', 'AbortError', 'TypeError'].includes(error?.name) ? error.name : 'Error';
  failure.requestStage = stage;
  failure.elapsedMs = Math.max(0, Date.now() - startedAt);
  return failure;
}

async function adminHttpFailure(response, stage = 'contacting the dashboard service', startedAt = Date.now()) {
  const failure = new Error('Field Work Hub request was rejected.');
  failure.status = response.status;
  failure.requestStage = stage;
  try {
    const body = await response.json();
    // These codes contain no operator-provided text. Discard every other field.
    if (typeof body?.code === 'string' && /^PGRST\d{3}$/.test(body.code)) failure.code = body.code;
    if (['invalid_credentials', 'refresh_token_not_found', 'refresh_token_already_used'].includes(body?.error_code)) {
      failure.code = body.error_code;
    }
    if (body?.message === 'JWT issued at future') failure.validationReason = 'token time validation';
    if (body?.message === 'JWT expired') failure.validationReason = 'token expiry validation';
    if (response.status === 403 && body?.message === 'Office work access disabled') {
      failure.accessReason = 'Office work access disabled';
    }
  } catch {
    // HTTP denial remains a denial even if its body cannot be read.
  }
  failure.elapsedMs = Math.max(0, Date.now() - startedAt);
  failure.message = adminLoginFailureMessage(failure);
  return failure;
}

function adminLoginFailureMessage(error) {
  const stage = error.requestStage || 'checking sign-in';
  const elapsed = `${(Math.max(0, Number(error.elapsedMs) || 0) / 1000).toFixed(1)} s`;
  const detail = [error.status ? `HTTP ${error.status}` : '', error.code || '', elapsed].filter(Boolean).join('; ');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `The connection timed out while ${stage} (${detail}). This does not mean your password is wrong. No work data was opened.`;
  }
  if (!error.status) return `The connection failed while ${stage} (${detail}). No work data was opened.`;
  const reason = error.validationReason ? ` The service reported ${error.validationReason}.` : '';
  const accessReason = error.accessReason ? ` ${error.accessReason}.` : '';
  return `The service rejected the request while ${stage} (${detail}).${reason}${accessReason} No work data was opened.`;
}

async function refreshAdminSession(refreshToken) {
  if (!refreshToken) {
    throw new Error('No refresh token is available.');
  }

  const startedAt = Date.now();
  const stage = 'refreshing your session';
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw adminConnectionFailure(error, stage, startedAt);
  }

  if (!response.ok) {
    throw await adminHttpFailure(response, stage, startedAt);
  }

  let session;
  try {
    session = await response.json();
  } catch (error) {
    throw adminConnectionFailure(error, stage, startedAt);
  }
  if (!session.access_token || !session.refresh_token) {
    throw new Error('Supabase did not return a complete refreshed session.');
  }
  return session;
}

function storeAdminSession(session) {
  if (!session || !session.access_token || !session.refresh_token) {
    return;
  }

  const expiresAt = Number(session.expires_at)
    || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);

  const stored = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: expiresAt
  };

  activeAdminSession = stored;
  try {
    sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Tab-session persistence is a convenience only; normal sign-in still works without it.
  }
}

function readAdminSession() {
  if (activeAdminSession) return activeAdminSession;
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const session = JSON.parse(raw);
    if (!session.access_token || !session.refresh_token) {
      clearAdminSession();
      return null;
    }
    return session;
  } catch {
    clearAdminSession();
    return null;
  }
}

function clearAdminSession() {
  activeAdminSession = null;
  try {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // Nothing else is required if browser storage is unavailable.
  }
}

function sessionNeedsRefresh(session) {
  const expiresAt = Number(session && session.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return false;
  }
  return Math.floor(Date.now() / 1000) >= expiresAt - 30;
}

async function ensureFreshAdminSession() {
  requireAccessToken();
  const session = pendingAdminSession || readAdminSession();
  if (!session || !sessionNeedsRefresh(session)) return;
  if (adminRefreshPromise) return adminRefreshPromise;

  const epoch = adminSessionEpoch;
  const previousUser = currentUser;
  const flight = (async () => {
    try {
      const refreshed = await refreshAdminSession(session.refresh_token);
      if (epoch !== adminSessionEpoch || !accessToken) throw new Error('The Admin session changed.');
      const user = refreshed.user;
      const metadata = user && user.app_metadata;
      if (!metadata || !['ADMIN', 'SUPERVISOR'].includes(metadata.role) || !metadata.organization_id
          || (previousUser && (user.id !== previousUser.id
            || metadata.role !== previousUser.app_metadata.role
            || metadata.organization_id !== previousUser.app_metadata.organization_id))) {
        expireAdminSession();
        throw new Error('This session is no longer authorized as a Team Admin.');
      }
      accessToken = refreshed.access_token;
      currentUser = user;
      pendingAdminSession = null;
      storeAdminSession(refreshed);
    } catch (error) {
      if (epoch === adminSessionEpoch && (error.status === 400 || error.status === 401)) {
        expireAdminSession(error.requestStage ? error.message : undefined);
      }
      throw error;
    }
  })();
  adminRefreshPromise = flight;
  try {
    await flight;
  } finally {
    if (adminRefreshPromise === flight) adminRefreshPromise = null;
  }
}

function expireAdminSession(message = 'Your dashboard session expired. Sign in again.') {
  signOutButton.click();
  setLoginStatus(message, true);
}

async function adminFetch(url, options = {}) {
  const epoch = adminSessionEpoch;
  await ensureFreshAdminSession();
  if (epoch !== adminSessionEpoch || !accessToken) throw new Error('The Admin session changed.');
  const mutation = /\/rpc\/admin_(create|update)_work_order|\/rpc\/admin_save_photo_template|\/functions\/v1\/admin-invite-contractor/.test(url);
  if (mutation) {
    adminWritesPending++;
    adminWriteRevision++;
  }
  const startedAt = Date.now();
  const stage = adminRequestStage(url);
  try {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30_000),
        headers: { ...options.headers, apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` }
      });
    } catch (error) {
      throw adminConnectionFailure(error, stage, startedAt);
    }
    if (epoch !== adminSessionEpoch || !accessToken) throw new Error('The Admin session changed.');
    if (response.status === 401) {
      const error = await adminHttpFailure(response, stage, startedAt);
      // Reading an error body can overlap sign-out / a different login.
      if (epoch !== adminSessionEpoch || !accessToken) throw new Error('The Admin session changed.');
      expireAdminSession(error.message);
      throw error;
    }
    response.adminRequestStage = stage;
    response.adminRequestStartedAt = startedAt;
    const readJson = response.json.bind(response);
    response.json = async () => {
      let payload;
      try {
        payload = await readJson();
      } catch (error) {
        throw adminConnectionFailure(error, stage, startedAt);
      }
      if (epoch !== adminSessionEpoch || !accessToken) throw new Error('The Admin session changed.');
      return payload;
    };
    return response;
  } finally {
    if (mutation) {
      adminWritesPending--;
      adminWriteRevision++;
    }
  }
}
