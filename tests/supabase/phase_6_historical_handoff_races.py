"""Actual lock waits for completed-job handoff in disposable CI PostgreSQL only."""
import json
import os
from pathlib import Path
import threading
import time
import uuid
import psycopg
from psycopg.types.json import Jsonb

DSN = os.environ['FWH_TEST_DATABASE_URL']
GATE = Path(__file__).with_name('phase_5_recovery_gate.sql').read_text()
FIXTURE = GATE[GATE.index('create function pg_temp.recovery_fixture_photo'):GATE.index('do $gate$')]
CALL = 'select public.handoff_work_order_team(%s,%s,%s,%s,%s,%s)'


def claims(c, actor, org):
    c.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({
        'sub': str(actor), 'session_id': str(actor),
        'app_metadata': {'role': 'SUPERVISOR', 'organization_id': str(org)},
    }),))
    c.execute('set local role authenticated')


def run_case(kind):
    org, source, target, admin, contractor, supervisor, action, later = [uuid.uuid4() for _ in range(8)]
    with psycopg.connect(DSN) as c:
        assert c.info.dbname == 'fwh_test' and c.info.host in ('localhost', '127.0.0.1', '::1')
        c.execute("insert into public.organizations(id,name) values(%s,'HANDOFF RACE TEST')", (org,))
        for team in (source, target):
            c.execute("insert into public.admin_teams(id,organization_id,name) values(%s,%s,'TEST')", (team, org))
        for actor, role in ((admin, 'ADMIN'), (contractor, 'CONTRACTOR'), (supervisor, 'SUPERVISOR')):
            c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(%s,%s,now(),%s)',
                      (actor, 'fixture@example.invalid', Jsonb({'role': role, 'organization_id': str(org)})))
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (actor, actor))
            c.execute('insert into private.account_work_access(organization_id,user_id,work_role,active) values(%s,%s,%s,true)', (org, actor, role))
        c.execute('insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, source, admin))
        c.execute('insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, source, contractor))
        c.execute('insert into private.org_work_settings(organization_id,supervisor_work_ready) values(%s,true)', (org,))
        c.execute("insert into private.supervisor_grants(organization_id,user_id,tier,active,granted_by,reason) values(%s,%s,3,true,%s,'TEST')", (org, supervisor, admin))
        c.execute(FIXTURE)
        photo = c.execute('select pg_temp.recovery_fixture_photo(%s,%s,%s,%s,true)', (admin, org, source, contractor)).fetchone()[0]
        wo, run = c.execute('select work_order_id,run_id from public.photos where id=%s', (photo,)).fetchone()
        claims(c, supervisor, org)
        fp = c.execute("select public.preview_work_order_team_handoff(%s,%s,'TEST')", (wo, target)).fetchone()[0]['review_fingerprint']
    args = (action, wo, target, fp, 'TEST continuity', 'TEST')
    ready, release, started = threading.Event(), threading.Event(), threading.Event()
    results, errors, pid = {}, [], []

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind == 'same-action':
                    claims(c, supervisor, org)
                    results['first'] = c.execute(CALL, args).fetchone()[0]
                elif kind == 'office-scope-first':
                    c.execute('update private.admin_team_memberships set active=false where user_id=%s', (admin,))
                else:
                    c.execute('insert into public.photos(id,work_order_id,run_id,captured_by,captured_at) values(%s,%s,%s,%s,now())', (later, wo, run, contractor))
                ready.set()
                assert release.wait(10)
        except BaseException as error:
            errors.append(error)
            ready.set()

    def second():
        try:
            with psycopg.connect(DSN) as c:
                pid.append(c.info.backend_pid)
                claims(c, supervisor, org)
                started.set()
                try:
                    results['second'] = c.execute(CALL, args).fetchone()[0]
                except psycopg.Error as error:
                    c.rollback()
                    results['second'] = error.sqlstate
        except BaseException as error:
            errors.append(error)
            started.set()

    one, two = threading.Thread(target=first), threading.Thread(target=second)
    one.start()
    try:
        assert ready.wait(10)
        if errors:
            raise errors[0]
        two.start()
        assert started.wait(10)
        blocked = False
        with psycopg.connect(DSN, autocommit=True) as c:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                blocked = c.execute("select exists(select 1 from pg_stat_activity where pid=%s and wait_event_type='Lock')", (pid[0],)).fetchone()[0]
                if blocked:
                    break
                time.sleep(.02)
        assert blocked, 'Handoff did not wait for exact competing cutoff/evidence transaction'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]
    with psycopg.connect(DSN) as c:
        actual_team = c.execute('select responsible_team_id from public.work_orders where id=%s', (wo,)).fetchone()[0]
        grants = c.execute('select count(*) from private.photo_recovery_grants where scope_work_order_id=%s', (wo,)).fetchone()[0]
        if kind == 'same-action':
            assert results['first'] == results['second'] and actual_team == target and grants == 1, results
            assert c.execute('select count(*) from private.work_order_team_handoff_actions where action_id=%s', (action,)).fetchone()[0] == 1
        else:
            assert results['second'] == '40001' and actual_team == source and grants == 0, results
            assert c.execute('select count(*) from private.work_order_team_handoff_actions where action_id=%s', (action,)).fetchone()[0] == 0
    print(f'PASS Phase 6 historical handoff {kind}: real lock wait; exact cutoff and replay preserved')


for scenario in ('same-action', 'office-scope-first', 'photo-first'):
    run_case(scenario)
