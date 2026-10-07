"""Fixed-cutoff races on actual connections in the disposable CI database only.

Synthetic grant fixtures are retained until the CI service is destroyed. No
production deletion operation or trigger bypass is introduced for cleanup.
"""
import json
import os
from pathlib import Path
import threading
import time
import uuid

import psycopg
from psycopg.types.json import Jsonb

DSN = os.environ['FWH_TEST_DATABASE_URL']
CALL = 'select private.freeze_photo_recovery_scope(%s,%s,%s,%s,%s,%s)'
BEGIN = 'select public.begin_photo_transfer(%s,%s,%s,%s)'
CONFIRM = 'select public.confirm_photo_transfer(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)'
# Reuse the controlled gate's public-RPC fixture, not implementation SQL.
GATE = Path(__file__).with_name('phase_5_recovery_gate.sql').read_text()
FIXTURE_SQL = GATE[GATE.index('create function pg_temp.recovery_fixture_photo'):GATE.index('do $gate$')]


def claims(c, actor, org, role):
    c.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({
        'sub': str(actor), 'session_id': str(actor),
        'app_metadata': {'role': role, 'organization_id': str(org)},
    }),))


def race(kind):
    org, team, admin, contractor, action, later = [uuid.uuid4() for _ in range(6)]
    transfer_case = kind in ('same-begin', 'changed-begin', 'receipt-after-disable')
    target = contractor if kind == 'finish-after-cutoff' or transfer_case else admin
    with psycopg.connect(DSN) as c:
        # This test is destructive only to a throwaway DB's lifetime, never a
        # hosted project. Refuse any substituted non-CI database or remote host.
        assert c.info.dbname == 'fwh_test' and c.info.host in ('localhost', '127.0.0.1', '::1')
        c.execute("insert into public.organizations(id,name) values(%s,'RECOVERY RACE TEST')", (org,))
        c.execute("insert into public.admin_teams(id,organization_id,name) values(%s,%s,'TEST')", (team, org))
        for actor, role in [(admin, 'ADMIN'), (contractor, 'CONTRACTOR')]:
            c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(%s,%s,now(),%s)',
                      (actor, 'recovery-race@example.invalid', Jsonb({'role': role, 'organization_id': str(org)})))
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (actor, actor))
            c.execute('insert into private.account_work_access(organization_id,user_id,work_role,active) values(%s,%s,%s,true)',
                      (org, actor, role))
        c.execute('insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)',
                  (org, team, admin))
        c.execute(FIXTURE_SQL)
        photo = c.execute('select pg_temp.recovery_fixture_photo(%s,%s,%s,%s,%s)',
                          (admin, org, team, contractor, kind != 'finish-after-cutoff')).fetchone()[0]
        revision = c.execute('select revision from private.account_work_access where user_id=%s', (target,)).fetchone()[0]
        finish = c.execute('select f.work_order_id,f.run_id,f.assignment_instance_id,f.requirement_revision,f.id,f.digest '
                           'from public.photo_finish_sets f join public.photos p on p.finish_set_id=f.id where p.id=%s',
                           (photo,)).fetchone()
        begin_args = (action, photo, 'b' * 64, 250000)
        if kind == 'receipt-after-disable':
            claims(c, contractor, org, 'CONTRACTOR')
            prepared = c.execute(BEGIN, begin_args).fetchone()[0]
            receipt_args = (uuid.uuid4(), photo, uuid.UUID(prepared['transfer_version']), contractor, contractor,
                            later, 'TEST-V1', prepared['bucket'], prepared['object_key'], 'b' * 64, 250000)
    args = (action, org, target, revision, [] if target == contractor else [team], 'TEST')
    ready, release, second_ready = threading.Event(), threading.Event(), threading.Event()
    results, errors, second_pid = {}, [], []

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind == 'receipt-after-disable':
                    c.execute("update private.account_work_access set active=false,suspension_authority='OWNER',"
                              "suspension_reason='TEST',disabled_at=now() where user_id=%s", (contractor,))
                elif kind in ('same-begin', 'changed-begin'):
                    claims(c, contractor, org, 'CONTRACTOR')
                    c.execute('set local role authenticated')
                    results['first'] = c.execute(BEGIN, begin_args).fetchone()[0]
                elif kind == 'scope-removed':
                    c.execute('update private.admin_team_memberships set active=false where user_id=%s', (admin,))
                elif kind == 'role-changed':
                    c.execute("update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','\"SUPERVISOR\"') where id=%s", (admin,))
                elif kind == 'revision-changed':
                    c.execute('update private.account_work_access set revision=%s where user_id=%s', (uuid.uuid4(), admin))
                else:
                    c.execute('set local role service_role')
                    results['first'] = c.execute(CALL, args).fetchone()[0]
                ready.set()
                assert release.wait(10), 'First transaction was not released'
        except BaseException as error:
            errors.append(error)
            ready.set()

    def second():
        try:
            with psycopg.connect(DSN) as c:
                second_pid.append(c.info.backend_pid)
                second_ready.set()
                if transfer_case:
                    try:
                        if kind == 'receipt-after-disable':
                            c.execute('set local role service_role')
                            results['second'] = c.execute(CONFIRM, receipt_args).fetchone()[0]
                        else:
                            claims(c, contractor, org, 'CONTRACTOR')
                            c.execute('set local role authenticated')
                            changed_args = (uuid.uuid4(), photo, 'c' * 64, 250000) if kind == 'changed-begin' else begin_args
                            results['second'] = c.execute(BEGIN, changed_args).fetchone()[0]
                    except (psycopg.errors.InsufficientPrivilege, psycopg.errors.InvalidParameterValue) as error:
                        results['second'] = error.sqlstate
                elif kind == 'photo-after-cutoff':
                    c.execute('insert into public.photos(id,work_order_id,run_id,captured_by,captured_at) '
                              'select %s,work_order_id,run_id,captured_by,now() from public.photos where id=%s', (later, photo))
                    results['second'] = later
                elif kind == 'finish-after-cutoff':
                    claims(c, contractor, org, 'CONTRACTOR')
                    c.execute('set local role authenticated')
                    results['second'] = c.execute("select public.accept_field_action_v4(%s,%s,%s,%s,'COMPLETE',"
                                                  "to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),%s,%s,%s)",
                                                  (uuid.uuid4(),) + finish).fetchone()[0]
                else:
                    c.execute('set local role service_role')
                    try:
                        results['second'] = c.execute(CALL, args).fetchone()[0]
                    except (psycopg.errors.InsufficientPrivilege, psycopg.errors.SerializationFailure) as error:
                        results['second'] = error.sqlstate
        except BaseException as error:
            errors.append(error)
            second_ready.set()

    one, two = threading.Thread(target=first), threading.Thread(target=second)
    one.start()
    try:
        assert ready.wait(10), 'First transaction did not start'
        if errors:
            raise errors[0]
        two.start()
        assert second_ready.wait(10), 'Second transaction did not start'
        blocked = False
        with psycopg.connect(DSN, autocommit=True) as observer:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                blocked = observer.execute("select exists(select 1 from pg_stat_activity where pid=%s and wait_event_type='Lock')",
                                           (second_pid[0],)).fetchone()[0]
                if blocked:
                    break
                time.sleep(.02)
        assert blocked, 'Second connection did not wait on cutoff/access/evidence lock'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]

    if transfer_case:
        with psycopg.connect(DSN) as c:
            transfers = c.execute('select prepared_sha256,prepared_size,state from private.photo_transfers where photo_id=%s', (photo,)).fetchall()
            assert transfers == [('b' * 64, 250000, 'WAITING')], transfers
            assert c.execute('select count(*) from private.photo_transfer_receipts where photo_id=%s', (photo,)).fetchone()[0] == 0
            if kind == 'same-begin':
                assert results['first'] == results['second'], results
                assert c.execute('select count(*) from private.photo_transfer_actions where photo_id=%s', (photo,)).fetchone()[0] == 1
            else:
                assert results['second'] == ('22023' if kind == 'changed-begin' else '42501'), results
        print(f'PASS Phase 5 transfer {kind}: real lock wait; no replacement or unauthorized receipt')
        return

    denied = kind in ('scope-removed', 'role-changed', 'revision-changed')
    with psycopg.connect(DSN) as c:
        count = c.execute('select count(*) from private.photo_recovery_grants where action_id=%s', (action,)).fetchone()[0]
        assert count == (0 if denied else 1)
        if denied:
            assert results['second'] == ('40001' if kind == 'revision-changed' else '42501'), results
            assert c.execute('select count(*) from private.photo_recovery_members where grant_id=%s', (action,)).fetchone()[0] == 0
        else:
            c.execute('set local role service_role')
            assert c.execute(CALL, args).fetchone()[0] == action
            assert c.execute('select private.complete_photo_recovery_grant(%s)', (action,)).fetchone()[0] == 1
            assert c.execute('select private.complete_photo_recovery_grant(%s)', (action,)).fetchone()[0] == 1
            c.execute('reset role')
            claims(c, target, org, 'CONTRACTOR' if target == contractor else 'ADMIN')
            c.execute('set local role authenticated')
            assert c.execute('select private.can_recover_photo(%s)', (photo,)).fetchone()[0]
            if kind == 'same-action':
                assert results['first'] == results['second'] == action, results
            elif kind == 'photo-after-cutoff':
                assert results['second'] == later
                assert not c.execute('select private.can_recover_photo(%s)', (later,)).fetchone()[0]
            elif kind == 'finish-after-cutoff':
                assert results['second']['outcome'] == 'APPLIED', results
                assert not c.execute('select private.has_pre_cutoff_finish(%s)', (photo,)).fetchone()[0]
                c.execute('reset role')
                assert c.execute('select private.photo_has_accepted_finish(%s)', (photo,)).fetchone()[0]
                assert not c.execute('select accepted_finish_at_cutoff from private.photo_recovery_members where grant_id=%s', (action,)).fetchone()[0]
    print(f'PASS Phase 5 recovery {kind}: real lock wait; fixed, identity-bound cutoff')


for case in ['same-action', 'scope-removed', 'role-changed', 'revision-changed', 'photo-after-cutoff', 'finish-after-cutoff',
             'same-begin', 'changed-begin', 'receipt-after-disable']:
    race(case)
