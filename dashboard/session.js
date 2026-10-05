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
      session = await refreshAdminSession(session.refresh_token);
      if (epoch !== adminSessionEpoch) return;
      storeAdminSession(session);
      accessToken = session.access_token;
      currentUser = await fetchCurrentUser();
    }

    if (epoch !== adminSessionEpoch) return;
    const metadata = currentUser.app_metadata || {};
    if (metadata.role !== 'ADMIN' || !metadata.organization_id) {
      throw new Error('Stored session is not authorized as a Team Admin.');
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
    clearAdminSession();
    pendingAdminSession = null;
    accessToken = null;
    currentUser = null;
    assignableUsers = [];
    workOrderRows = [];
    setLoginStatus('Your dashboard session could not be restored. Sign in again.', false);
  }
}

async function refreshAdminSession(refreshToken) {
  if (!refreshToken) {
    throw new Error('No refresh token is available.');
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const error = new Error(await readableError(response, 'Unable to refresh the Admin session.'));
    error.status = response.status;
    throw error;
  }

  const session = await response.json();
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
      if (!metadata || metadata.role !== 'ADMIN' || !metadata.organization_id
          || (previousUser && (user.id !== previousUser.id
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
        expireAdminSession();
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

function expireAdminSession() {
  signOutButton.click();
  setLoginStatus('Your dashboard session expired. Sign in again.', true);
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
  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(30_000),
      headers: { ...options.headers, apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (epoch !== adminSessionEpoch || !accessToken) throw new Error('The Admin session changed.');
    if (response.status === 401) {
      expireAdminSession();
      throw new Error('Your dashboard session expired. Sign in again.');
    }
    const readJson = response.json.bind(response);
    response.json = async () => {
      const payload = await readJson();
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
