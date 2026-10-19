import { handleScopedAdminInvite } from './scoped-admin-invite.mjs';
import { handleTestOtherOrgFirstAdmin } from './test-other-org-first-admin.mjs';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const INVITE_REDIRECT_URL =
  Deno.env.get('TEAM_INVITE_REDIRECT_URL') ??
  'https://timbone72-cc.github.io/field-work-hub/contractor-invite.html';

const ALLOWED_ORIGIN = 'https://timbone72-cc.github.io';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizedEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizedName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function bearerToken(req: Request) {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? '';
}

function readableError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return fallback;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: 'Invite service is not configured.' });
  }

  const token = bearerToken(req);
  if (!token) {
    return jsonResponse(401, { error: 'Authentication required.' });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await adminClient.auth.getUser(token);

  const callerRole = caller?.app_metadata?.role;
  const callerOrganizationId = caller?.app_metadata?.organization_id;

  if (callerError || !caller || !['ADMIN', 'SUPERVISOR'].includes(String(callerRole)) || !callerOrganizationId) {
    return jsonResponse(403, { error: 'Admin permission required.' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Request body must be valid JSON.' });
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const operation = typeof body.operation === 'string'
    ? body.operation.trim().toLowerCase()
    : 'invite';

  if (operation === 'test_other_org_first_admin') {
    // Separate, explicitly gated TEST fixture. The caller JWT is never
    // rewritten to the other organization and gains no business/photo scope.
    const result = await handleTestOtherOrgFirstAdmin({
      body, callerClient, adminClient,
      callerOrganizationId: String(callerOrganizationId),
      environment: Deno.env.get('TEAM_ADMIN_INVITE_ENVIRONMENT') ?? '',
      redirectUrl: Deno.env.get('TEAM_ADMIN_INVITE_REDIRECT_URL') ?? '',
      enabled: Deno.env.get('TEAM_TEST_OTHER_ORG_FIRST_ADMIN_ENABLED') === 'true'
    });
    return jsonResponse(result.status, result.body);
  }

  if (operation === 'invite_admin' || operation === 'invite_admin_new_team') {
    // Explicitly disabled unless this exact Team environment has been
    // provider-reviewed; ordinary Contractor invitations remain unchanged.
    if (Deno.env.get('TEAM_ADMIN_INVITE_ENABLED') !== 'true') {
      return jsonResponse(503, { error: 'Staff setup links are not enabled.' });
    }
    const result = await handleScopedAdminInvite({
      body,
      callerClient,
      adminClient,
      organizationId: String(callerOrganizationId),
      environment: Deno.env.get('TEAM_ADMIN_INVITE_ENVIRONMENT') ?? '',
      redirectUrl: Deno.env.get('TEAM_ADMIN_INVITE_REDIRECT_URL') ?? '',
      newTeam: operation === 'invite_admin_new_team',
    });
    return jsonResponse(result.status, result.body);
  }

  // The original Contractor invite/cancel owner remains ADMIN-only; extending
  // staff recruitment cannot silently widen existing Contractor authority.
  if (callerRole !== 'ADMIN') {
    return jsonResponse(403, { error: 'Admin permission required.' });
  }

  if (operation === 'cancel') {
    return handleCancel(
      body,
      callerOrganizationId,
      callerClient,
      adminClient,
    );
  }

  if (operation !== 'invite') {
    return jsonResponse(400, { error: 'Unsupported Contractor management operation.' });
  }

  return handleInvite(
    body,
    callerOrganizationId,
    callerClient,
    adminClient,
  );
});

async function handleInvite(
  body: Record<string, unknown>,
  callerOrganizationId: string,
  callerClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
) {
  const email = normalizedEmail(body.email);
  const displayName = normalizedName(body.display_name);

  if (!email || !displayName) {
    return jsonResponse(400, { error: 'Contractor name and email are required.' });
  }

  const { data: reservationRows, error: reservationError } = await callerClient.rpc(
    'admin_reserve_contractor_invitation',
    {
      p_email: email,
      p_display_name: displayName,
    },
  );

  if (reservationError) {
    return jsonResponse(400, {
      error: readableError(reservationError, 'Unable to reserve a Contractor seat.'),
    });
  }

  const reservation = Array.isArray(reservationRows) ? reservationRows[0] : null;
  if (!reservation?.invitation_id || reservation.organization_id !== callerOrganizationId) {
    return jsonResponse(500, { error: 'The server did not return a valid invitation reservation.' });
  }

  const invitationId = String(reservation.invitation_id);
  let authUserId: string | null = null;

  async function finalize(outcome: 'SENT' | 'FAILED' | 'PROBLEM', userId: string | null) {
    const { data, error } = await adminClient.rpc('team_finalize_contractor_invitation', {
      p_invitation_id: invitationId,
      p_outcome: outcome,
      p_auth_user_id: userId,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : null;
  }

  async function applyTeamMetadata(user: { id: string; app_metadata?: Record<string, unknown> | null }) {
    const existingMetadata = user.app_metadata ?? {};
    const { data, error } = await adminClient.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...existingMetadata,
        role: 'CONTRACTOR',
        organization_id: callerOrganizationId,
      },
    });
    if (error || !data.user) throw error ?? new Error('Unable to finalize Contractor metadata.');
    return data.user;
  }

  async function reconcileOwnInvite() {
    const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;

    return data.users.find((user) => {
      const userEmail = (user.email ?? '').trim().toLowerCase();
      const marker = user.user_metadata?.team_invitation_id;
      return userEmail === email && marker === invitationId;
    }) ?? null;
  }

  try {
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: INVITE_REDIRECT_URL,
        data: {
          display_name: displayName,
          team_invitation_id: invitationId,
        },
      },
    });

    const invitedUser = linkData.user;
    const setupUrl = linkData.properties?.action_link ?? '';

    if (invitedUser) {
      authUserId = invitedUser.id;
    }

    if (linkError || !invitedUser || !setupUrl) {
      throw linkError ?? new Error('Supabase did not return a usable Contractor setup link.');
    }

    const updatedUser = await applyTeamMetadata(invitedUser);
    authUserId = updatedUser.id;
    const finalized = await finalize('SENT', authUserId);

    return jsonResponse(200, {
      invitation_id: invitationId,
      email,
      display_name: displayName,
      status: finalized?.status ?? 'SENT',
      setup_url: setupUrl,
      seat_limit: reservation.seat_limit,
      used_seats: reservation.used_seats,
      available_seats: reservation.available_seats,
    });
  } catch (error) {
    try {
      if (!authUserId) {
        const reconciled = await reconcileOwnInvite();
        if (reconciled) {
          authUserId = reconciled.id;
          const updatedUser = await applyTeamMetadata(reconciled);
          authUserId = updatedUser.id;
        }
      }

      if (authUserId) {
        await finalize('PROBLEM', authUserId);
      } else {
        await finalize('FAILED', null);
      }
    } catch {
      // The RESERVED row itself remains fail-closed and continues to hold the seat.
    }

    return jsonResponse(authUserId ? 500 : 400, {
      error: readableError(error, 'Setup link generation outcome is uncertain and requires review.'),
    });
  }
}

async function handleCancel(
  body: Record<string, unknown>,
  callerOrganizationId: string,
  callerClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
) {
  const invitationId = typeof body.invitation_id === 'string'
    ? body.invitation_id.trim()
    : '';

  if (!invitationId) {
    return jsonResponse(400, { error: 'Invitation id is required.' });
  }

  const { data: beginRows, error: beginError } = await callerClient.rpc(
    'admin_begin_contractor_invitation_cancel',
    { p_invitation_id: invitationId },
  );

  if (beginError) {
    return jsonResponse(400, {
      error: readableError(beginError, 'Unable to begin invitation cancellation.'),
    });
  }

  const pending = Array.isArray(beginRows) ? beginRows[0] : null;
  if (!pending?.invitation_id || pending.organization_id !== callerOrganizationId) {
    return jsonResponse(500, { error: 'The server did not return a valid cancellation target.' });
  }

  async function finalizeCancellation(outcome: 'CANCELLED' | 'PROBLEM') {
    const { data, error } = await adminClient.rpc('team_finalize_contractor_invitation_cancel', {
      p_invitation_id: invitationId,
      p_outcome: outcome,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : null;
  }

  try {
    const targetUserId = pending.auth_user_id ? String(pending.auth_user_id) : null;

    if (targetUserId) {
      const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(targetUserId);
      const user = userData.user;

      const safeUnusedIdentity =
        !userError &&
        user &&
        (user.email ?? '').trim().toLowerCase() === String(pending.email).trim().toLowerCase() &&
        !user.email_confirmed_at &&
        !user.last_sign_in_at &&
        user.app_metadata?.role === 'CONTRACTOR' &&
        user.app_metadata?.organization_id === callerOrganizationId &&
        user.user_metadata?.team_invitation_id === invitationId;

      if (!safeUnusedIdentity) {
        await finalizeCancellation('PROBLEM');
        return jsonResponse(409, {
          error: 'This invitation can no longer be safely cancelled as an unused account.',
        });
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
      if (deleteError) {
        await finalizeCancellation('PROBLEM');
        return jsonResponse(500, {
          error: readableError(deleteError, 'Unable to delete the unused invited Auth identity.'),
        });
      }
    }

    const finalized = await finalizeCancellation('CANCELLED');
    return jsonResponse(200, {
      invitation_id: invitationId,
      email: pending.email,
      display_name: pending.display_name,
      status: finalized?.status ?? 'CANCELLED',
    });
  } catch (error) {
    try {
      await finalizeCancellation('PROBLEM');
    } catch {
      // Keep CANCELLING/PROBLEM seat reservation fail-closed when outcome is ambiguous.
    }

    return jsonResponse(500, {
      error: readableError(error, 'Cancellation outcome is uncertain and requires review.'),
    });
  }
}
