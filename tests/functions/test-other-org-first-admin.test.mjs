import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTestOtherOrgFirstAdmin } from
  '../../supabase/functions/admin-invite-contractor/test-other-org-first-admin.mjs';

const primary = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const team = '33333333-3333-4333-8333-333333333333';
const revision = '44444444-4444-4444-8444-444444444444';
const authUser = '55555555-5555-4555-8555-555555555555';
const redirectUrl = 'https://timbone72-cc.github.io/field-work-hub/admin-invite.html';
const email = 'disposable@example.invalid';
const mailboxUser = {
  id: authUser, email,
  app_metadata: { role: 'ADMIN', organization_id: target },
  user_metadata: { scoped_admin_invitation_id: team }
};

function fixture(changes = {}) {
  const events = [];
  const opts = {
    enabled: true, environment: 'TEST', callerOrganizationId: primary,
    organizations: [{ id: target, name: 'TEST OTHER ORGANIZATION - DISPOSABLE' }],
    teams: [{ id: team, active: true }],
    capacity: {
      organization_id: target, revision, admin_limit: 1, admin_active: 0,
      admin_reserved: 0, supervisor_limit: 0, supervisor_active: 0,
      supervisor_reserved: 0
    },
    deniedOwner: false, seat: 'RESERVED', issue: 'CREATE_ONCE',
    ...changes
  };
  let beginCount = 0;
  const adminClient = {
    from(table) {
      events.push(['service-select', table]);
      return {
        select() {
          return { eq(field, value) {
            events.push(['selector', table, field, value]);
            return { async limit() {
              return { data: table === 'organizations'
                ? opts.organizations : opts.teams };
            } };
          }};
        }
      };
    },
    auth: { admin: {
      async generateLink() {
        events.push(['generateLink']);
        return { data: { user: mailboxUser,
          properties: { action_link: 'https://auth.example.invalid/one-time' } } };
      },
      async updateUserById(user, info) {
        events.push(['updateUser', user, info]);
        return { data: { user: { id: user } } };
      },
      async listUsers() {
        events.push(['listUsers']);
        return { data: { users: [] } };
      }
    } },
    async rpc(method, payload) {
      events.push(['service-rpc', method, payload]);
      assert.equal(method, 'team_finalize_scoped_admin_issue');
      return { data: { status: 'BOUND', auth_user_id: authUser } };
    }
  };
  const callerClient = {
    async rpc(method, payload) {
      events.push(['caller-rpc', method, payload]);
      if (method === 'owner_office_capacity_status') {
        return opts.deniedOwner ? { error: { code: '42501' } }
          : { data: opts.capacity };
      }
      if (method === 'reserve_scoped_admin_invitation') {
        return { data: { status: opts.seat, team_id: team } };
      }
      if (method === 'begin_scoped_admin_invitation_issue') {
        return { data: {
          status: 'ISSUING',
          instruction: ++beginCount === 1 ? opts.issue : 'RECONCILE',
          action_id: team, organization_id: target, team_id: team,
          invite_email: email
        } };
      }
      throw Error('Unexpected RPC ' + method);
    }
  };
  return {
    events,
    args: {
      body: { email, display_name: 'Disposable Admin', reason: 'Cross-org TEST gate' },
      adminClient, callerClient, callerOrganizationId: opts.callerOrganizationId,
      enabled: opts.enabled, environment: opts.environment, redirectUrl
    }
  };
}

const creates = events => events.filter(e =>
  ['generateLink', 'updateUser', 'service-rpc'].includes(e[0]));

test('verified current Product Owner issues a one-time foreign TEST invitation using existing owner', async () => {
  const { args, events } = fixture();
  const r = await handleTestOtherOrgFirstAdmin(args);
  assert.equal(r.status, 200);
  assert.equal(r.body.action_id, team);
  assert.equal(r.body.team_id, team);
  assert.equal(r.body.organization_id, target);
  assert.equal(r.body.status, 'BOUND');
  assert.equal(r.body.setup_url, 'https://auth.example.invalid/one-time');
  const invite = events.find(e => e[1] === 'reserve_scoped_admin_invitation');
  assert.equal(invite[2].p_org, target);
  assert.equal(invite[2].p_action, team);
  assert.equal(invite[2].p_expected_allowance_revision, revision);
  assert.equal(invite[2].p_environment, 'TEST');
  assert.equal(events.filter(e => e[0] === 'generateLink').length, 1);
  assert.equal(events.some(e => e[1] === 'create_admin_team_and_reserve_invitation'), false);
});

test('feature is hard-disabled for production, missing flag and forged target identifiers', async () => {
  for (const changes of [{ enabled: false }, { environment: 'PRODUCTION' }]) {
    const { args, events } = fixture(changes);
    assert.equal((await handleTestOtherOrgFirstAdmin(args)).status, 503);
    assert.equal(events.length, 0);
  }
  for (const key of ['organization_id', 'team_id', 'action_id',
    'expected_allowance_revision', 'team_name']) {
    const { args, events } = fixture();
    args.body[key] = target;
    assert.equal((await handleTestOtherOrgFirstAdmin(args)).status, 400);
    assert.equal(events.length, 0);
  }
});

test('wrong company, duplicate target name or extra/inactive team denied without Auth', async () => {
  for (const changes of [
    { callerOrganizationId: target },
    { organizations: [] },
    { organizations: [
      { id: target, name: 'TEST OTHER ORGANIZATION - DISPOSABLE' },
      { id: primary, name: 'TEST OTHER ORGANIZATION - DISPOSABLE' }
    ] },
    { organizations: [{ id: target, name: 'Customer company' }] },
    { teams: [] },
    { teams: [{ id: team, active: false }] },
    { teams: [{ id: team, active: true }, { id: primary, active: true }] }
  ]) {
    const { args, events } = fixture(changes);
    assert.notEqual((await handleTestOtherOrgFirstAdmin(args)).status, 200);
    assert.deepEqual(creates(events), []);
  }
});

test('non-owner, changed revision/seat or supervisor scope fail closed', async () => {
  const basic = fixture();
  for (const changes of [
    { deniedOwner: true },
    { capacity: { ...basic.args.callerClient.capacity, revision: null } },
    { capacity: { organization_id: target, revision, admin_limit: 2 } },
    { capacity: { ...({
      organization_id: target, revision, admin_limit: 1, admin_active: 1,
      admin_reserved: 0, supervisor_limit: 0, supervisor_active: 0,
      supervisor_reserved: 0
    }) } },
    { capacity: {
      organization_id: target, revision, admin_limit: 1, admin_active: 0,
      admin_reserved: 2, supervisor_limit: 0, supervisor_active: 0,
      supervisor_reserved: 0
    } }
  ]) {
    const { args, events } = fixture(changes);
    assert.equal((await handleTestOtherOrgFirstAdmin(args)).status, 403);
    assert.equal(creates(events).length, 0);
  }
});

test('recorded or uncertain invitation never generates another Auth link', async () => {
  for (const changes of [
    { seat: 'CONSUMED' }, { seat: 'RELEASED' },
    { seat: 'ISSUING', issue: 'RECONCILE' }
  ]) {
    const { args, events } = fixture(changes);
    const r = await handleTestOtherOrgFirstAdmin(args);
    assert.equal(r.status, 409);
    assert.equal(events.filter(e => e[0] === 'generateLink').length, 0);
  }
});
