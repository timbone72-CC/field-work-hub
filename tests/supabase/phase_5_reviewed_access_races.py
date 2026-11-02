"""Actual reviewed-access races in disposable PostgreSQL only; no live accounts."""
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
    org, team, admin, manager, contractor, owner, wo = [uuid.uuid4() for _ in range(7)]
    action = uuid.uuid4()
    with psycopg.connect(DSN) as c:
        assert c.execute('select current_database()').fetchone()[0] == 'fwh_test'
        assert c.info.host in ('localhost', '127.0.0.1')
        c.execute("insert into public.organizations(id,name,contractor_seat_limit) values(%s,'REVIEW RACE TEST',1)", (org,))
        c.execute("insert into public.admin_teams(id,organization_id,name) values(%s,%s,'RACE TEAM')", (team, org))
        for user, role in [(admin, 'ADMIN'), (manager, 'ADMIN'), (contractor, 'CONTRACTOR'), (owner, 'PLATFORM')]:
            c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(%s,%s,now(),%s::jsonb)',
                      (user, f'{user}@example.invalid', json.dumps({'role': role, 'organization_id': str(org)})))
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (user, user))
            if role != 'PLATFORM':
                c.execute('insert into private.account_work_access(organization_id,user_id,work_role,active) values(%s,%s,%s,true)', (org, user, role))
        c.execute('insert into private.admin_team_memberships(organization_id,user_id,team_id,active) values(%s,%s,%s,true),(%s,%s,%s,true)', (org, admin, team, org, manager, team))
        c.execute('insert into private.contractor_team_memberships(organization_id,user_id,team_id,active) values(%s,%s,%s,true)', (org, contractor, team))
        c.execute("insert into private.platform_owner_capabilities(user_id,active,environment,verified_at) values(%s,true,'TEST',now())", (owner,))
        c.execute("insert into public.work_orders(id,organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,due_date) values(%s,%s,%s,%s,%s,'TEST ADDRESS','TEST',current_date)", (wo, org, team, contractor, f'REVIEW-RACE-{wo}'))
        original_run = c.execute('select current_run_id from public.work_orders where id=%s', (wo,)).fetchone()[0]
        claims(c, owner, 'PLATFORM', org)
        review = c.execute("select public.review_account_work_access(%s,false,'TEST')", (admin,)).fetchone()[0]
    choices = json.dumps([{'team_id': str(team), 'decision': 'KEEP_MANAGER', 'manager_user_id': str(manager)}])
    ready, release, second_started = threading.Event(), threading.Event(), threading.Event()
    results, errors, second_pid = {}, [], []

    def confirm(c):
        claims(c, owner, 'PLATFORM', org)
        return c.execute("select * from public.set_reviewed_account_work_access(%s,%s,%s,false,'REVIEW RACE','TEST',%s,%s::jsonb)",
                         (action, admin, review['access_revision'], review['review_fingerprint'], choices)).fetchone()

    def edit(c):
        claims(c, manager, 'ADMIN', org)
        return c.execute('select * from public.admin_update_work_order(%s,%s,%s,%s,%s,current_date,%s)',
                         (wo, f'REVIEW-RACE-{wo}', 'TEST ADDRESS', 'TEST', 'CHANGED IN RACE', contractor)).fetchone()

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind in ('same-action', 'confirm-before-job'):
                    results['first'] = confirm(c)
                elif kind == 'job-before-confirm':
                    results['first'] = edit(c)
                elif kind == 'scope-before-confirm':
                    c.execute('select private.lock_account_lifecycle()')
                    c.execute('update private.admin_team_memberships set active=false where user_id=%s', (admin,))
                elif kind == 'manager-before-confirm':
                    claims(c, owner, 'PLATFORM', org)
                    manager_review = c.execute("select public.review_account_work_access(%s,false,'TEST')", (manager,)).fetchone()[0]
                    manager_choices = json.dumps([{'team_id': str(team), 'decision': 'KEEP_MANAGER', 'manager_user_id': str(admin)}])
                    results['first'] = c.execute("select * from public.set_reviewed_account_work_access(%s,%s,%s,false,'MANAGER RACE','TEST',%s,%s::jsonb)",
                        (uuid.uuid4(), manager, manager_review['access_revision'], manager_review['review_fingerprint'], manager_choices)).fetchone()
                else:
                    c.execute('delete from auth.sessions where id=%s', (owner,))
                ready.set()
                assert release.wait(10), 'First review race was not released'
        except BaseException as error:
            errors.append(error)
            ready.set()

    def second():
        try:
            with psycopg.connect(DSN) as c:
                second_pid.append(c.info.backend_pid)
                second_started.set()
                try:
                    results['second'] = edit(c) if kind == 'confirm-before-job' else confirm(c)
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
        assert blocked, 'No actual review authority lock wait observed'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]
    success = kind in ('same-action', 'confirm-before-job')
    if kind == 'same-action':
        assert results['first'] == results['second'], results
    elif kind == 'confirm-before-job':
        assert isinstance(results['second'], tuple), results
    else:
        expected = '40001' if kind in ('job-before-confirm', 'manager-before-confirm') else '42501'
        assert results['second'] == expected, results
    with psycopg.connect(DSN) as c:
        assert c.execute('select active from private.account_work_access where user_id=%s', (admin,)).fetchone()[0] is (not success)
        assert c.execute('select count(*) from private.account_work_access_actions where action_id=%s', (action,)).fetchone()[0] == int(success)
        assert c.execute('select count(*) from private.account_work_access_reviews where action_id=%s', (action,)).fetchone()[0] == int(success)
        assert c.execute('select count(*) from private.photo_recovery_grants where action_id=%s and state=\'READY\'', (action,)).fetchone()[0] == int(success)
        status, run, assignee, instructions = c.execute('select field_status,current_run_id,assigned_user_id,instructions from public.work_orders where id=%s', (wo,)).fetchone()
        assert status == 'ASSIGNED' and run == original_run and assignee == contractor
        assert instructions == ('CHANGED IN RACE' if 'job' in kind else None)
    print(f'PASS reviewed access {kind}: observed real lock wait; exact review/audit/recovery and job identity preserved')


for scenario in ['job-before-confirm', 'scope-before-confirm', 'manager-before-confirm',
                 'session-before-confirm', 'confirm-before-job', 'same-action']:
    run_case(scenario)
