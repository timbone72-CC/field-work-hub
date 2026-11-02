"""Real two-connection work-access races in disposable PostgreSQL CI only."""
import json
import os
import threading
import time
import uuid

import psycopg

DSN = os.environ['FWH_TEST_DATABASE_URL']


def claims(c, user, role, org):
    c.execute(
        "select set_config('request.jwt.claims',%s,true)",
        (json.dumps({
            'sub': str(user),
            'session_id': str(user),
            'app_metadata': {'role': role, 'organization_id': str(org)},
        }),),
    )
    c.execute('set local role authenticated')


def setup_fixture():
    org, team, admin, contractor, wo = [uuid.uuid4() for _ in range(5)]
    with psycopg.connect(DSN) as c:
        assert c.execute('select current_database()').fetchone()[0] == 'fwh_test'
        assert c.info.host in ('localhost', '127.0.0.1')
        c.execute(
            "insert into public.organizations(id,name,contractor_seat_limit) values(%s,'LIFECYCLE RACE TEST',2)",
            (org,),
        )
        c.execute(
            "insert into public.admin_teams(id,organization_id,name) values(%s,%s,'RACE TEAM')",
            (team, org),
        )
        for user, role in [(admin, 'ADMIN'), (contractor, 'CONTRACTOR')]:
            c.execute(
                'insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) '
                'values(%s,%s,now(),%s::jsonb)',
                (
                    user,
                    f'{user}@example.invalid',
                    json.dumps({'role': role, 'organization_id': str(org)}),
                ),
            )
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (user, user))
            c.execute(
                'insert into private.account_work_access(organization_id,user_id,work_role,active) '
                'values(%s,%s,%s,true)',
                (org, user, role),
            )
        c.execute(
            'insert into private.admin_team_memberships(organization_id,team_id,user_id,active) '
            'values(%s,%s,%s,true)',
            (org, team, admin),
        )
        c.execute(
            'insert into private.contractor_team_memberships(organization_id,user_id,team_id,active) '
            'values(%s,%s,%s,true)',
            (org, contractor, team),
        )
        c.execute(
            'insert into public.work_orders(id,organization_id,responsible_team_id,assigned_user_id,'
            'wo_number,property_address,work_type,due_date) '
            "values(%s,%s,%s,%s,%s,'TEST','TEST',current_date)",
            (wo, org, team, contractor, f'LIFECYCLE-RACE-{wo}'),
        )
        revision = c.execute(
            'select revision from private.account_work_access where user_id=%s',
            (contractor,),
        ).fetchone()[0]
    return org, admin, contractor, wo, revision


def run_case(kind):
    org, admin, contractor, wo, revision = setup_fixture()
    action = uuid.uuid4()
    ready = threading.Event()
    release = threading.Event()
    second_started = threading.Event()
    errors = []
    results = {}
    second_pid = []

    def lifecycle(c):
        claims(c, admin, 'ADMIN', org)
        return c.execute(
            'select * from public.set_account_work_access(%s,%s,%s,false,%s,%s)',
            (action, contractor, revision, 'Lifecycle race cutoff', 'TEST'),
        ).fetchone()

    def start(c):
        claims(c, contractor, 'CONTRACTOR', org)
        return c.execute('select * from public.start_work(%s)', (wo,)).fetchone()

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind == 'start-before-disable':
                    results['first'] = start(c)
                else:
                    results['first'] = lifecycle(c)
                ready.set()
                assert release.wait(10), 'First lifecycle race transaction was not released'
        except BaseException as error:
            errors.append(error)
            ready.set()

    def second():
        try:
            with psycopg.connect(DSN) as c:
                second_pid.append(c.info.backend_pid)
                second_started.set()
                try:
                    if kind == 'disable-before-start':
                        results['second'] = start(c)
                    else:
                        results['second'] = lifecycle(c)
                except psycopg.Error as error:
                    c.rollback()
                    results['second'] = error.sqlstate
        except BaseException as error:
            errors.append(error)
            second_started.set()

    one = threading.Thread(target=first)
    two = threading.Thread(target=second)
    one.start()
    try:
        assert ready.wait(10), 'First lifecycle race transaction did not start'
        if errors:
            raise errors[0]
        two.start()
        assert second_started.wait(10), 'Second lifecycle race transaction did not start'
        blocked = False
        with psycopg.connect(DSN, autocommit=True) as observer:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                blocked = observer.execute(
                    "select exists(select 1 from pg_stat_activity "
                    "where pid=%s and wait_event_type='Lock')",
                    (second_pid[0],),
                ).fetchone()[0]
                if blocked:
                    break
                time.sleep(.02)
        assert blocked, 'Second lifecycle transaction did not wait on the real authority lock'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)

    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]

    with psycopg.connect(DSN) as c:
        active = c.execute(
            'select active from private.account_work_access where user_id=%s',
            (contractor,),
        ).fetchone()[0]
        status, started = c.execute(
            'select field_status,started_at from public.work_orders where id=%s',
            (wo,),
        ).fetchone()
        audit_count = c.execute(
            'select count(*) from private.account_work_access_actions where action_id=%s',
            (action,),
        ).fetchone()[0]
        recovery_state = c.execute(
            'select state from private.photo_recovery_grants where action_id=%s',
            (action,),
        ).fetchone()[0]

    assert active is False
    assert audit_count == 1
    assert recovery_state == 'READY'

    if kind == 'disable-before-start':
        assert results['second'] == '42501', results
        assert status == 'ASSIGNED' and started is None
    elif kind == 'start-before-disable':
        assert results['second'][0] == action, results
        assert status == 'IN_PROGRESS' and started is not None
    else:
        assert results['first'] == results['second'], results
        assert status == 'ASSIGNED' and started is None

    print(
        f'PASS Phase 5 lifecycle {kind}: real lock wait; '
        'one cutoff/audit and committed authority governs result'
    )


for scenario in ['disable-before-start', 'start-before-disable', 'same-action']:
    run_case(scenario)
