"""Actual connection waits in the disposable PostgreSQL CI database only."""
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
    org, team, admin, actor, wo = [uuid.uuid4() for _ in range(5)]
    cutoff = uuid.uuid4()
    with psycopg.connect(DSN) as c:
        assert c.execute('select current_database()').fetchone()[0] == 'fwh_test'
        assert c.info.host in ('localhost', '127.0.0.1')
        c.execute('insert into public.organizations(id,name) values(%s,%s)', (org, 'LEGACY RACE TEST'))
        c.execute('insert into public.admin_teams(id,organization_id,name) values(%s,%s,%s)', (team, org, 'TEST'))
        for user, role in [(admin, 'ADMIN'), (actor, 'CONTRACTOR')]:
            c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(%s,%s,now(),%s::jsonb)',
                      (user, 'fixture@example.invalid', json.dumps({'role': role, 'organization_id': str(org)})))
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (user, user))
            c.execute('insert into private.account_work_access(organization_id,user_id,work_role,active) values(%s,%s,%s,true)', (org, user, role))
        c.execute('insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, team, admin))
        c.execute('insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, team, actor))
        c.execute('insert into public.work_orders(id,organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,due_date) values(%s,%s,%s,%s,%s,%s,%s,current_date)',
                  (wo, org, team, actor, f'LEGACY-{wo}', 'TEST', 'TEST'))
        run = c.execute('select current_run_id from public.work_orders where id=%s', (wo,)).fetchone()[0]
        revision = c.execute('select revision from private.account_work_access where user_id=%s', (actor,)).fetchone()[0]
    ready, release, second_started = threading.Event(), threading.Event(), threading.Event()
    errors, results, second_pid = [], {}, []

    def disable(c, user):
        c.execute("update private.account_work_access set active=false,suspension_authority='OWNER',suspension_reason='TEST',disabled_at=now() where user_id=%s", (user,))

    def start(c):
        claims(c, actor, 'CONTRACTOR', org)
        return c.execute('select * from public.start_work(%s)', (wo,)).fetchone()

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind == 'session-revoked':
                    c.execute('delete from auth.sessions where id=%s', (actor,))
                elif kind == 'office-scope-removed':
                    c.execute('update private.admin_team_memberships set active=false where user_id=%s', (admin,))
                elif kind in ('cutoff-before-start', 'cutoff-before-insert'):
                    c.execute('select private.freeze_photo_recovery_scope(%s,%s,%s,%s,%s,%s)', (cutoff, org, actor, revision, [], 'TEST'))
                    disable(c, actor)
                    c.execute('select private.complete_photo_recovery_grant(%s)', (cutoff,))
                elif kind == 'write-before-cutoff':
                    results['first'] = start(c)
                else:
                    disable(c, actor)
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
                    if kind == 'write-before-cutoff':
                        results['second'] = c.execute('select private.freeze_photo_recovery_scope(%s,%s,%s,%s,%s,%s)', (cutoff, org, actor, revision, [], 'TEST')).fetchone()[0]
                        disable(c, actor)
                        c.execute('select private.complete_photo_recovery_grant(%s)', (cutoff,))
                    elif kind == 'office-scope-removed':
                        claims(c, admin, 'ADMIN', org)
                        results['second'] = c.execute('select * from public.admin_update_work_order(%s,%s,%s,%s,%s,current_date,%s)', (wo, f'LEGACY-{wo}', 'TEST', 'TEST', '', actor)).fetchone()
                    elif kind == 'cutoff-before-insert':
                        claims(c, actor, 'CONTRACTOR', org)
                        c.execute('insert into public.photos(work_order_id,run_id,captured_by,captured_at) values(%s,%s,%s,now())', (wo, run, actor))
                        results['second'] = 'INSERTED'
                    else:
                        results['second'] = start(c)
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
        assert blocked, 'Second transaction did not wait on the actual authority/cutoff lock'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]
    with psycopg.connect(DSN) as c:
        status, started = c.execute('select field_status,started_at from public.work_orders where id=%s', (wo,)).fetchone()
        assert c.execute('select count(*) from public.photos where work_order_id=%s', (wo,)).fetchone()[0] == 0
        if kind == 'write-before-cutoff':
            assert results['second'] == cutoff and status == 'IN_PROGRESS' and started is not None
            assert c.execute('select active from private.account_work_access where user_id=%s', (actor,)).fetchone()[0] is False
        else:
            assert results['second'] == '42501', results
            assert status == 'ASSIGNED' and started is None
    print(f'PASS legacy work {kind}: observed real lock wait; committed authority governs the result')


for scenario in ['disabled-before-start', 'session-revoked', 'office-scope-removed',
                 'cutoff-before-start', 'cutoff-before-insert', 'write-before-cutoff']:
    run_case(scenario)
