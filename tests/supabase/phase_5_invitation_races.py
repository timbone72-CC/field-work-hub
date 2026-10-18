"""Observe real invitation/activation/capacity waits in disposable PostgreSQL CI."""
import json
import os
import threading
import time
import uuid

import psycopg

DSN = os.environ['FWH_TEST_DATABASE_URL']


def claims(c, user, role, org):
    c.execute("select set_config('request.jwt.claims',%s,true)",
              (json.dumps({'sub': str(user), 'session_id': str(user),
                           'app_metadata': {'role': role, 'organization_id': str(org)}}),))
    c.execute('set local role authenticated')


def run_case(kind):
    org, team, admin, actor, owner = [uuid.uuid4() for _ in range(5)]
    invited = [uuid.uuid4(), uuid.uuid4()]
    activation_case = 'activation' in kind
    with psycopg.connect(DSN) as c:
        assert c.execute('select current_database()').fetchone()[0] == 'fwh_test'
        assert c.info.host in ('localhost', '127.0.0.1')
        c.execute("insert into public.organizations(id,name,contractor_seat_limit) values(%s,'INVITATION RACE',%s)", (org, 2 if kind == 'two-activations' else 1))
        c.execute("insert into public.admin_teams(id,organization_id,name) values(%s,%s,'TEST')", (team, org))
        for user, role in [(admin, 'ADMIN'), (actor, 'CONTRACTOR'), (owner, 'ADMIN')]:
            c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(%s,%s,now(),%s::jsonb)',
                      (user, f'{user}@example.invalid', json.dumps({'role': role, 'organization_id': str(org)})))
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (user, user))
        c.execute("insert into private.account_work_access(organization_id,user_id,work_role,active) values(%s,%s,'ADMIN',true),(%s,%s,'CONTRACTOR',true)", (org, admin, org, actor))
        c.execute('insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, team, admin))
        c.execute('insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, team, actor))
        c.execute("insert into private.platform_owner_capabilities(user_id,active,environment,verified_at) values(%s,true,'TEST',now())", (owner,))
        # Exact ordinary pause frees one active seat while preserving identity.
        revision = c.execute('select revision from private.account_work_access where user_id=%s', (actor,)).fetchone()[0]
        claims(c, admin, 'ADMIN', org)
        c.execute("select * from public.set_account_work_access(%s,%s,%s,false,'TEST','TEST')", (uuid.uuid4(), actor, revision))
        c.execute('reset role')
        actor_revision = c.execute('select revision from private.account_work_access where user_id=%s', (actor,)).fetchone()[0]
        admin_revision = c.execute('select revision from private.account_work_access where user_id=%s', (admin,)).fetchone()[0]
        if activation_case:
            for user in invited[:2 if kind == 'two-activations' else 1]:
                claims(c, admin, 'ADMIN', org)
                invite = c.execute('select invitation_id from public.admin_reserve_contractor_invitation_for_team(%s,%s,%s)', (team, f'{user}@example.invalid', 'TEST')).fetchone()[0]
                c.execute('reset role')
                c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values(%s,%s,now(),%s::jsonb,%s::jsonb)',
                          (user, f'{user}@example.invalid', json.dumps({'role': 'CONTRACTOR', 'organization_id': str(org)}), json.dumps({'team_invitation_id': str(invite)})))
                c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (user, user))
                c.execute("select * from public.team_finalize_contractor_invitation(%s,'SENT',%s)", (invite, user))
    ready, release, second_started = threading.Event(), threading.Event(), threading.Event()
    errors, results, second_pid = [], {}, []

    def reserve(c, user):
        claims(c, admin, 'ADMIN', org)
        return c.execute('select invitation_id from public.admin_reserve_contractor_invitation_for_team(%s,%s,%s)', (team, f'{user}@example.invalid', 'TEST')).fetchone()[0]

    def restore(c):
        claims(c, admin, 'ADMIN', org)
        return c.execute("select * from public.set_account_work_access(%s,%s,%s,true,'TEST RESTORE','TEST')", (uuid.uuid4(), actor, actor_revision)).fetchone()

    def activate(c, user):
        claims(c, user, 'CONTRACTOR', org)
        return c.execute('select * from public.complete_contractor_invitation_activation()').fetchone()

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind == 'restore-before-reserve':
                    results['first'] = restore(c)
                elif kind == 'two-activations':
                    results['first'] = activate(c, invited[0])
                elif kind == 'recruiter-disabled-before-activation':
                    claims(c, owner, 'ADMIN', org)
                    review = c.execute("select public.review_account_work_access(%s,false,'TEST')", (admin,)).fetchone()[0]
                    choices = [{'team_id': str(team), 'decision': 'NEEDS_MANAGER'}]
                    results['first'] = c.execute(
                        "select * from public.set_reviewed_account_work_access(%s,%s,%s,false,'TEST RECRUITER','TEST',%s,%s::jsonb)",
                        (uuid.uuid4(), admin, admin_revision, review['review_fingerprint'], json.dumps(choices))).fetchone()
                elif kind == 'session-revoked-before-activation':
                    c.execute('delete from auth.sessions where id=%s', (invited[0],))
                else:
                    results['first'] = reserve(c, invited[0])
                ready.set()
                assert release.wait(10)
        except BaseException as error:
            errors.append(error)
            ready.set()

    def second():
        try:
            with psycopg.connect(DSN) as c:
                second_pid.append(c.info.backend_pid)
                second_started.set()
                try:
                    if kind == 'reserve-before-restore':
                        results['second'] = restore(c)
                    elif activation_case:
                        results['second'] = activate(c, invited[1] if kind == 'two-activations' else invited[0])
                    else:
                        results['second'] = reserve(c, invited[1])
                except psycopg.Error as error:
                    c.rollback()
                    results['second'] = error.sqlstate
        except BaseException as error:
            errors.append(error)
            second_started.set()

    one, two = threading.Thread(target=first), threading.Thread(target=second)
    one.start()
    try:
        assert ready.wait(10)
        if errors:
            raise errors[0]
        two.start()
        assert second_started.wait(10)
        blocked = False
        with psycopg.connect(DSN, autocommit=True) as observer:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                blocked = observer.execute("select exists(select 1 from pg_stat_activity where pid=%s and wait_event_type='Lock')", (second_pid[0],)).fetchone()[0]
                if blocked:
                    break
                time.sleep(.02)
        assert blocked, 'No actual invitation/authority wait observed'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]
    if kind == 'two-activations':
        assert isinstance(results['second'], tuple), results
    else:
        assert results['second'] == ('42501' if activation_case else '22023'), results
    with psycopg.connect(DSN) as c:
        pending = c.execute("select count(*) from public.contractor_invitations where organization_id=%s and status in ('RESERVED','SENT','PROBLEM','CANCELLING')", (org,)).fetchone()[0]
        active = c.execute('select count(*) from auth.users u where private.is_assignable_contractor(u.id,%s)', (org,)).fetchone()[0]
        cap = c.execute('select contractor_seat_limit from public.organizations where id=%s', (org,)).fetchone()[0]
        assert active + pending == cap, 'Seat lost or oversubscribed'
        if kind == 'two-activations':
            assert active == 2 and pending == 0
            assert c.execute('select count(*) from private.contractor_team_memberships where organization_id=%s and team_id=%s and active', (org, team)).fetchone()[0] == 3  # paused original roster retained
        elif activation_case:
            assert pending == 1 and active == 0
            assert not c.execute('select exists(select 1 from private.account_work_access where user_id=%s)', (invited[0],)).fetchone()[0]
        elif kind == 'restore-before-reserve':
            assert active == 1 and pending == 0
        else:
            assert active == 0 and pending == 1
    print(f'PASS invitation {kind}: observed real lock wait; scoped authority and exact capacity preserved')


for scenario in ['two-reservations-last-seat', 'reserve-before-restore', 'restore-before-reserve',
                 'two-activations', 'recruiter-disabled-before-activation', 'session-revoked-before-activation']:
    run_case(scenario)
