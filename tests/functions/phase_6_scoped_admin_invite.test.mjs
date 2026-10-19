import test from 'node:test';
import assert from 'node:assert/strict';
import { handleScopedAdminInvite } from '../../supabase/functions/admin-invite-contractor/scoped-admin-invite.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const team = '33333333-3333-4333-8333-333333333333';
const revision = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const redirectUrl = 'https://timbone72-cc.github.io/field-work-hub/admin-invite.html';
const email = 'staff@example.invalid';
const user = {
  id: userId, email,
  app_metadata: { role: 'ADMIN', organization_id: org },
  user_metadata: { scoped_admin_invitation_id: id }
};
function harness({ seatStatus = 'RESERVED', claimInstruction = 'CREATE_ONCE', claimStatus = 'ISSUING',
  authUser = user, generateError = null, listing = [], bindError = null,
  newTeam = false } = {}) {
  const events = [];
  let beginCount = 0;
  const callerClient = { async rpc(name, params) {
    events.push(['caller', name, params]);
    if (name === 'reserve_scoped_admin_invitation' ||
        name === 'create_admin_team_and_reserve_invitation') {
      return { data: { status: seatStatus, team_id: team,
        ...(name === 'create_admin_team_and_reserve_invitation' ?
          { new_team: true, team_name: 'Fresh Admin Team' } : {}) } };
    }
    if (name === 'begin_scoped_admin_invitation_issue') {
      return { data: {
        instruction: ++beginCount === 1 ? claimInstruction : 'RECONCILE', status: claimStatus,
        action_id: id, organization_id: org, team_id: team, invite_email: email
      } };
    }
    throw Error('Unexpected caller RPC');
  }};
  const adminClient = {
    auth: { admin: {
      async generateLink(params) {
        events.push(['generateLink', params]);
        return { data: {
          user: authUser,
          properties: { action_link: 'https://auth.example.invalid/action' }
        }, error: generateError };
      },
      async updateUserById(uuid, payload) {
        events.push(['updateUser', uuid, payload]);
        return { data: { user: { id: uuid } } };
      },
      async listUsers() {
        events.push(['listUsers']);
        return { data: { users: listing } };
      }
    }},
    async rpc(name, params) {
      events.push(['service', name, params]);
      assert.equal(name, 'team_finalize_scoped_admin_issue');
      return bindError
        ? { error: bindError }
        : { data: { status: 'BOUND', auth_user_id: params.p_auth_user } };
    }
  };
  const args = {
    body: {
      action_id: id, team_id: team, expected_allowance_revision: revision,
      email: '  STAFF@EXAMPLE.INVALID  ', display_name: ' Staff ',
      reason: ' Approved staffed access ',
      ...(newTeam ? { team_name: ' Fresh Admin Team ' } : {})
    },
    callerClient, adminClient, organizationId: org, environment: 'TEST',
    newTeam,
    redirectUrl
  };
  return { events, args };
}

test('fresh verified request binds exact Auth UUID before returning the single setup URL', async () => {
  const { events, args } = harness();
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(result.body.setup_url, 'https://auth.example.invalid/action');
  assert.deepEqual(events.map(x => x[0]), ['caller','caller','generateLink','caller','updateUser','service']);
  assert.equal(events[2][1].options.data.scoped_admin_invitation_id, id);
  assert.equal(events[4][2].app_metadata.role, 'ADMIN');
  assert.equal(events[5][2].p_auth_user, userId);
});

test('identical in-flight action is allowed to reconcile without another Auth create', async () => {
  const { events, args } = harness({
    seatStatus: 'ISSUING',
    claimInstruction: 'RECONCILE',
    claimStatus: 'ISSUING',
    listing: [user]
  });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 409);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(events.some(e => e[0] === 'generateLink'), false);
});

test('released or consumed actions never enter Auth reconciliation', async () => {
  for (const seatStatus of ['RELEASED', 'CONSUMED']) {
    const { events, args } = harness({ seatStatus });
    const result = await handleScopedAdminInvite(args);
    assert.equal(result.status, 409);
    assert.equal(events.length, 1);
  }
});

test('new team and Admin seat are reserved in one guarded RPC before external Auth', async () => {
  const { events, args } = harness({ newTeam: true });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 200);
  assert.deepEqual(events.map(e => e[0]), [
    'caller','caller','generateLink','caller','updateUser','service'
  ]);
  assert.equal(events[0][1], 'create_admin_team_and_reserve_invitation');
  assert.equal(events[0][2].p_team, team);
  assert.equal(events[0][2].p_team_name, 'Fresh Admin Team');
  assert.equal(events[0][2].p_expected_allowance_revision, revision);
  assert.equal(events[2][1].options.data.scoped_admin_invitation_id, id);
});

test('same-action new-team retry reconciles without another Auth link', async () => {
  const { events, args } = harness({
    newTeam: true, seatStatus: 'ISSUING',
    claimInstruction: 'RECONCILE', listing: [user]
  });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 409);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(events[0][1], 'create_admin_team_and_reserve_invitation');
  assert.equal(events.filter(e => e[0] === 'generateLink').length, 0);
});

test('new-team request must name its team before any DB or Auth side effect', async () => {
  const { events, args } = harness({ newTeam: true });
  const result = await handleScopedAdminInvite({
    ...args, body: { ...args.body, team_name: '  ' }
  });
  assert.equal(result.status, 400);
  assert.equal(events.length, 0);
});

test('recorded binding never generates another setup link', async () => {
  const { events, args } = harness({ claimInstruction: 'RECONCILE', claimStatus: 'BOUND' });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 409);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(events.filter(x => x[0] === 'generateLink').length, 0);
});

test('uncertain Auth result attempts exact positive reconciliation, not new issuance', async () => {
  const { events, args } = harness({
    claimInstruction: 'RECONCILE', listing: [user]
  });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 409);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(events.filter(x => x[0] === 'generateLink').length, 0);
  assert.equal(events.filter(x => x[0] === 'service').length, 1);
});

test('inconclusive external Auth result retains the reserved seat without retry', async () => {
  const { events, args } = harness({
    authUser: null, generateError: new Error('network unavailable'), listing: []
  });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 503);
  assert.equal(result.body.status, 'RECONCILE');
  assert.equal(events.filter(x => x[0] === 'generateLink').length, 1);
  assert.equal(events.filter(x => x[0] === 'service').length, 0);
});

test('wrong Auth marker or role binding failure can never return usable setup URL', async () => {
  const wrong = { ...user, user_metadata: { scoped_admin_invitation_id: team } };
  const { events, args } = harness({ authUser: wrong, listing: [] });
  const result = await handleScopedAdminInvite(args);
  assert.equal(result.status, 503);
  assert.equal(result.body.setup_url, undefined);
  assert.equal(events.filter(x => x[0] === 'service').length, 0);

  const bound = harness({ bindError: Error('revoked scope') });
  const denied = await handleScopedAdminInvite(bound.args);
  assert.equal(denied.status, 503);
  assert.equal(denied.body.setup_url, undefined);
});

test('a claimed or foreign-organization Auth identity never has metadata rewritten', async () => {
  const claimed = harness({
    authUser: { ...user, email_confirmed_at: '2026-10-12T00:00:00Z' }, listing: []
  });
  const result = await handleScopedAdminInvite(claimed.args);
  assert.equal(result.status, 503);
  assert.equal(claimed.events.filter(x => x[0] === 'updateUser').length, 0);
  assert.equal(claimed.events.filter(x => x[0] === 'service').length, 0);

  const foreign = harness({
    authUser: { ...user, app_metadata: { role: 'ADMIN', organization_id: team } },
    listing: []
  });
  const denied = await handleScopedAdminInvite(foreign.args);
  assert.equal(denied.status, 503);
  assert.equal(foreign.events.filter(x => x[0] === 'updateUser').length, 0);
});

test('invalid team, unconfigured environment or cross-account details fail before reserving', async () => {
  const { args, events } = harness();
  const denied = await handleScopedAdminInvite({
    ...args, body: { ...args.body, team_id: 'wrong-team' }
  });
  assert.equal(denied.status, 400);
  const env = await handleScopedAdminInvite({ ...args, environment: '' });
  assert.equal(env.status, 503);
  assert.equal(events.length, 0);
});

test('exact isolated Admin preview callback is TEST-only and cannot redirect elsewhere', async () => {
  const preview = 'https://timbone72-cc.github.io/field-work-hub/phase56-review/admin-invite.html';
  const good = harness();
  const accepted = await handleScopedAdminInvite({
    ...good.args, redirectUrl: preview, environment: 'TEST'
  });
  assert.equal(accepted.status, 200);
  const generated = good.events.find(e => e[0] === 'generateLink');
  assert.equal(generated[1].options.redirectTo, preview);

  for (const [environment, redirectUrl] of [
    ['PRODUCTION', preview],
    ['TEST', 'https://example.invalid/field-work-hub/phase56-review/admin-invite.html'],
    ['TEST', preview + '?next=https://other.invalid'],
    ['TEST', preview.replace('https:', 'http:')],
    ['TEST', preview.replace('phase56-review/', '') + '/'],
    ['TEST', 'https://timbone72-cc.github.io/field-work-hub/phase56-review/*']
  ]) {
    const denied = harness();
    const response = await handleScopedAdminInvite({
      ...denied.args, environment, redirectUrl
    });
    assert.equal(response.status, 503);
    assert.equal(denied.events.length, 0,
      'No DB reservation or Auth call on unapproved callback');
  }
});
