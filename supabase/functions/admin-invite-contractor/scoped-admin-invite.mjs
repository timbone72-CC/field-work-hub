// Phase 6F staff path inside the EXISTING trusted invitation function owner.
// A generated URL is returned only after exact Auth UUID and DB binding agree.
// No direct team, work, or office seat mutation is trusted from the browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response = (status, body) => ({ status, body });
const valid = value => typeof value === 'string' && UUID.test(value);
const fail = (status, message) => response(status, { error: message });

export async function handleScopedAdminInvite({
  body, callerClient, adminClient, organizationId, environment, redirectUrl
}) {
  if (!valid(organizationId) || !['TEST', 'PRODUCTION'].includes(environment) ||
    typeof redirectUrl !== 'string' ||
    !/^https:\/\/timbone72-cc\.github\.io\/field-work-hub\/admin-invite\.html$/.test(redirectUrl)) {
    return fail(503, 'Scoped staff invitations are not configured.');
  }
  const action = body.action_id;
  const team = body.team_id;
  const expectedRevision = body.expected_allowance_revision;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (![action, team, expectedRevision].every(valid) ||
      !email || email.length > 320 || !displayName || displayName.length > 200 ||
      reason.length < 1 || reason.length > 1000) {
    return fail(400, 'An action ID, team, capacity revision, email, name, and reason are required.');
  }
  // An untrusted actor cannot claim an Auth outcome by calling the service-role
  // finalizer: the two ordinary RPCs re-evaluate current team and seat grants.
  const { data: seat, error: seatError } = await callerClient.rpc(
    'reserve_scoped_admin_invitation', {
      p_action: action, p_org: organizationId, p_team: team, p_email: email,
      p_name: displayName, p_expected_allowance_revision: expectedRevision,
      p_reason: reason, p_environment: environment
    });
  if (seatError || seat?.status !== 'RESERVED') {
    return fail(409, 'The Admin seat or team is no longer available. Refresh and review the request.');
  }
  const { data: claim, error: claimError } = await callerClient.rpc(
    'begin_scoped_admin_invitation_issue', {
      p_action: action, p_org: organizationId, p_environment: environment
    });
  if (claimError || !claim || claim.action_id !== action ||
      claim.organization_id !== organizationId || claim.team_id !== team ||
      claim.invite_email !== email) {
    return fail(409, 'Invitation authority changed. The reserved seat remains protected.');
  }

  async function bindUser(user) {
    if (!user || !valid(user.id) ||
      (user.email ?? '').trim().toLowerCase() !== email ||
      user.user_metadata?.scoped_admin_invitation_id !== action ||
      // Never mutate an already-claimed identity or move it between tenants.
      user.email_confirmed_at || user.last_sign_in_at ||
      (user.app_metadata?.organization_id &&
        user.app_metadata.organization_id !== organizationId) ||
      (user.app_metadata?.role &&
        !['ADMIN', 'authenticated'].includes(user.app_metadata.role))) {
      return false;
    }
    // Recheck the original actor's live scope after the network/Auth roundtrip.
    // If revoked, do not write elevated Auth metadata at all.
    const { data: scoped, error: scopeError } = await callerClient.rpc(
      'begin_scoped_admin_invitation_issue', {
        p_action: action, p_org: organizationId, p_environment: environment
      });
    if (scopeError || scoped?.status !== 'ISSUING' ||
      scoped.instruction !== 'RECONCILE' || scoped.action_id !== action ||
      scoped.team_id !== team) return false;
    // Metadata is server-managed. The reserved scope is verified again in SQL
    // and activation cannot grant work from a user-controlled marker.
    const { data: updated, error: updateError } =
      await adminClient.auth.admin.updateUserById(user.id, {
        app_metadata: {
          ...(user.app_metadata ?? {}),
          role: 'ADMIN',
          organization_id: organizationId
        }
      });
    if (updateError || updated?.user?.id !== user.id) return false;
    const { data: bound, error: boundError } =
      await adminClient.rpc('team_finalize_scoped_admin_issue', {
        p_action: action, p_org: organizationId, p_auth_user: user.id, p_outcome: 'BOUND'
      });
    return !boundError && bound?.status === 'BOUND' && bound.auth_user_id === user.id;
  }

  async function reconcile() {
    // Never issue a second link during an ambiguous outcome. Bounded Auth scan
    // is used only for positive identity discovery, NEVER to prove absence.
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page, perPage: 1000
      });
      if (error || !Array.isArray(data?.users)) return false;
      const exact = data.users.find(user =>
        user.user_metadata?.scoped_admin_invitation_id === action &&
        (user.email ?? '').trim().toLowerCase() === email);
      if (exact) return bindUser(exact);
      if (data.users.length < 1000) break;
    }
    return false;
  }

  if (claim.instruction !== 'CREATE_ONCE') {
    if (claim.status === 'BOUND') {
      return response(409, {
        status: 'BOUND',
        error: 'This invitation already has a recorded Auth identity. No new setup link was created.'
      });
    }
    if (claim.status === 'ISSUING' && await reconcile()) {
      return response(409, {
        status: 'BOUND',
        error: 'The original Auth identity was reconciled. No new setup link was generated.'
      });
    }
    return response(409, {
      status: 'RECONCILE',
      error: 'The original invitation outcome is uncertain. The same seat is held; do not issue another invitation.'
    });
  }

  try {
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'invite', email,
      options: {
        redirectTo: redirectUrl,
        data: {
          display_name: displayName,
          scoped_admin_invitation_id: action
        }
      }
    });
    const url = data?.properties?.action_link ?? '';
    if (error || !data?.user || typeof url !== 'string' ||
      !url.startsWith('https://') || !(await bindUser(data.user))) {
      throw Error('Auth or DB outcome unconfirmed');
    }
    return response(200, {
      action_id: action, organization_id: organizationId, team_id: team,
      status: 'BOUND', setup_url: url
    });
  } catch {
    if (await reconcile()) {
      return response(409, {
        status: 'BOUND',
        error: 'Auth identity was reconciled, but the original setup link is unavailable. No duplicate link was generated.'
      });
    }
    return response(503, {
      status: 'RECONCILE',
      error: 'Invitation result is uncertain. The reserved seat is protected; no new link may be issued automatically.'
    });
  }
}
