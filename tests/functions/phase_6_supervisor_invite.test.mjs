import test from 'node:test';
import assert from 'node:assert/strict';
import { handleScopedAdminInvite } from '../../supabase/functions/admin-invite-contractor/scoped-admin-invite.mjs';

const action = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const team = '33333333-3333-4333-8333-333333333333';
const revision = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const email = 'supervisor@example.invalid';
const user = { id: userId, email,
  app_metadata: { role: 'SUPERVISOR', organization_id: org },
  user_metadata: { scoped_admin_invitation_id: action } };

function harness({ claimInstruction = 'CREATE_ONCE', seatStatus = 'RESERVED', authUser = user,
  listing = [], reserveError = null, generateError = null } = {}) {
  const events = [];
  let begins = 0;
  const callerClient = { async rpc(name, params) {
    events.push(['caller', name, params]);
    if (name === 'reserve_scoped_supervisor_invitation') return reserveError
      ? { error: reserveError } : { data: { status: seatStatus, tier: 2, team_ids: [team] } };
    if (name === 'begin_scoped_supervisor_invitation_issue') return { data: {
      action_id: action, organization_id: org, invite_email: email, tier: 2,
      team_ids: [team], status: begins++ === 0 ? 'ISSUING' : 'ISSUING',
      instruction: begins === 1 ? claimInstruction : 'RECONCILE'
    } };
    throw Error(`Unexpected caller RPC ${name}`);
  }};
  const adminClient = {
    auth: { admin: {
      async generateLink(params) { events.push(['generateLink', params]); return {
        data: { user: authUser, properties: { action_link: 'https://auth.example.invalid/supervisor' } },
        error: generateError
      }; },
      async updateUserById(id, payload) { events.push(['updateUser', id, payload]); return { data: { user: { id } } }; },
      async listUsers() { events.push(['listUsers']); return { data: { users: listing } }; }
    }},
    async rpc(name, params) { events.push(['service', name, params]);
      assert.equal(name, 'team_finalize_scoped_supervisor_issue');
      return { data: { status: 'BOUND', auth_user_id: params.p_auth_user } };
    }
  };
  return { events, args: { body: { action_id: action, tier: 2, team_ids: [team],
    expected_allowance_revision: revision, email, display_name: 'New Supervisor',
    reason: 'Owner approved supervisor access' }, callerClient, adminClient,
    organizationId: org, environment: 'TEST', redirectUrl:
      'https://timbone72-cc.github.io/field-work-hub/admin-invite.html', targetRole: 'SUPERVISOR' } };
}

test('Product Owner Supervisor invitation uses the existing one-time staff setup owner', async () => {
  const { events, args } = harness();
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { action_id: action, organization_id: org, role: 'SUPERVISOR',
    status: 'BOUND', setup_url: 'https://auth.example.invalid/supervisor', tier: 2, team_ids: [team] });
  assert.deepEqual(events.map(event => event[0]), ['caller','caller','generateLink','caller','updateUser','service']);
  assert.equal(events[0][1], 'reserve_scoped_supervisor_invitation');
  assert.equal(events[0][2].p_tier, 2);
  assert.deepEqual(events[0][2].p_team_ids, [team]);
  assert.equal(events[2][1].options.data.scoped_admin_invitation_id, action);
  assert.equal(events[4][2].app_metadata.role, 'SUPERVISOR');
});

test('Supervisor invitation validation and reservation failure produce no Auth side effect', async () => {
  const { events, args } = harness({ reserveError: new Error('owner denied') });
  const denied = await handleScopedAdminInvite({ ...args, body: { ...args.body, tier: 3, team_ids: [team] } });
  assert.equal(denied.status, 400);
  assert.equal(events.length, 0);
  const failed = await handleScopedAdminInvite(args);
  assert.equal(failed.status, 409);
  assert.equal(events.filter(event => event[0] === 'generateLink').length, 0);
});

test('Supervisor uncertain Auth result retains the exact action and never issues a second link', async () => {
  const first = harness({ authUser: null, generateError: new Error('gateway') });
  const result = await handleScopedAdminInvite(first.args);
  assert.equal(result.status, 503);
  assert.equal(result.body.status, 'RECONCILE');
  assert.equal(first.events.filter(event => event[0] === 'generateLink').length, 1);

  const retry = harness({ claimInstruction: 'RECONCILE', listing: [user] });
  const retried = await handleScopedAdminInvite(retry.args);
  assert.equal(retried.status, 409);
  assert.equal(retried.body.status, 'BOUND');
  assert.equal(retry.events.filter(event => event[0] === 'generateLink').length, 0);
});

test('obsolete Supervisor callback is rejected before any reservation or Auth call', async () => {
  const { events, args } = harness();
  const result = await handleScopedAdminInvite({ ...args, redirectUrl:
    'https://timbone72-cc.github.io/field-work-hub/phase56-review/admin-invite.html' });
  assert.equal(result.status, 503);
  assert.equal(events.length, 0);
});
test('confirmed duplicate identity has an actionable error, distinct from uncertain reservation failure', async () => {
  const { events, args } = harness({ reserveError:
    { code: '23505', message: 'Identity or invitation already pending' } });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'SUPERVISOR_IDENTITY_EXISTS');
  assert.match(result.body.error, /email already belongs/);
  assert.equal(events.length, 1);
  const uncertain = harness({ reserveError: { code: '23505', message: 'Other unique violation' } });
  const denied = await handleScopedAdminInvite(uncertain.args);
  assert.equal(denied.status, 409);
  assert.equal(denied.body.code, undefined);
  assert.equal(uncertain.events.length, 1);
});
