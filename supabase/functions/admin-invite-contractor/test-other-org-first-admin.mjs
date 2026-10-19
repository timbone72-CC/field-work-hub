// TEST-only first Admin handoff for the already initialized disposable organization.
// Reuses the one-shot scoped invitation owner; does not grant work/photo authority.
import { handleScopedAdminInvite } from './scoped-admin-invite.mjs';

const TARGET_NAME = 'TEST OTHER ORGANIZATION - DISPOSABLE';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied = (status, error) => ({ status, body: { error } });

export async function handleTestOtherOrgFirstAdmin({
  body, callerClient, adminClient, callerOrganizationId,
  environment, redirectUrl, enabled
}) {
  if (!enabled || environment !== 'TEST') {
    return denied(503, 'Disposable first-Admin handoff is disabled.');
  }
  if (!UUID.test(callerOrganizationId ?? '') || !body ||
    typeof body !== 'object' ||
    ['organization_id', 'team_id', 'action_id', 'expected_allowance_revision',
      'team_name'].some(key => Object.hasOwn(body, key))) {
    return denied(400, 'An organization, team, or action override is not permitted.');
  }
  // The caller never selects a tenant. The trusted server finds the exact
  // disposable organization, requiring a unique match and one active team.
  const { data: organizations, error: orgError } = await adminClient
    .from('organizations').select('id,name').eq('name', TARGET_NAME).limit(2);
  if (orgError || !Array.isArray(organizations) || organizations.length !== 1 ||
      !UUID.test(organizations[0]?.id ?? '') ||
      organizations[0].name !== TARGET_NAME ||
      organizations[0].id === callerOrganizationId) {
    return denied(403, 'Verified separate TEST organization unavailable.');
  }
  const organizationId = organizations[0].id;
  const { data: teams, error: teamError } = await adminClient
    .from('admin_teams').select('id,active').eq('organization_id', organizationId).limit(2);
  if (teamError || !Array.isArray(teams) || teams.length !== 1 ||
      !UUID.test(teams[0]?.id ?? '') || teams[0].active !== true) {
    return denied(409, 'Single disposable Admin team is not ready.');
  }
  // This RPC uses the CALLER JWT, not the service role. It checks the actual
  // verified/recent Product Owner capability and reads current seat authority.
  const { data: allowance, error: allowanceError } = await callerClient.rpc(
    'owner_office_capacity_status', {
      p_org: organizationId, p_environment: 'TEST'
    });
  if (allowanceError || allowance?.organization_id !== organizationId ||
      !UUID.test(allowance?.revision ?? '') ||
      Number(allowance?.admin_limit) !== 1 ||
      Number(allowance?.supervisor_limit) !== 0 ||
      Number(allowance?.admin_active) !== 0 ||
      Number(allowance?.admin_reserved) > 1 ||
      Number(allowance?.supervisor_active) !== 0 ||
      Number(allowance?.supervisor_reserved) !== 0) {
    return denied(403, 'Verified Product Owner and unused TEST Admin seat required.');
  }
  // The only possible action ID IS the existing team UUID. A second action
  // cannot mint another Auth link, even after an uncertain network result.
  // Current SQL rechecks actor, owner, team, email, revision and capacity,
  // and refuses changed-input replay, BOUND replay and duplicate Auth create.
  return handleScopedAdminInvite({
    body: {
      action_id: teams[0].id,
      team_id: teams[0].id,
      expected_allowance_revision: allowance.revision,
      email: body.email,
      display_name: body.display_name,
      reason: body.reason
    },
    callerClient, adminClient, organizationId, environment: 'TEST',
    redirectUrl, newTeam: false
  });
}
