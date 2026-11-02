"""Actual catalog/session/receipt lock waits, disposable PostgreSQL only.

No physical Storage byte claim; the Edge suite separately checks controlled bytes.
"""
import json
import os
from pathlib import Path
import threading
import time
import uuid

import psycopg

DSN = os.environ['FWH_TEST_DATABASE_URL']
GATE = Path(__file__).with_name('phase_5_transfer_gate.sql').read_text()
FIXTURE = GATE[GATE.index('create function pg_temp.recovery_fixture_photo'):GATE.index('do $gate$')]
CONFIRM = 'select public.confirm_photo_transfer(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)'


def run_case(kind):
    org, team, admin, contractor, object_id, action = [uuid.uuid4() for _ in range(6)]
    with psycopg.connect(DSN) as c:
        assert c.info.dbname == 'fwh_test' and c.info.host in ('localhost', '127.0.0.1', '::1')
        c.execute("insert into public.organizations(id,name) values(%s,'VERIFICATION RACE TEST')", (org,))
        c.execute("insert into public.admin_teams(id,organization_id,name) values(%s,%s,'TEST')", (team, org))
        for actor, role in [(admin, 'ADMIN'), (contractor, 'CONTRACTOR')]:
            c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(%s,%s,now(),%s::jsonb)',
                      (actor, 'verification-race@example.invalid', json.dumps({'role': role, 'organization_id': str(org)})))
            c.execute('insert into auth.sessions(id,user_id) values(%s,%s)', (actor, actor))
            c.execute('insert into private.account_work_access(organization_id,user_id,work_role,active) values(%s,%s,%s,true)', (org, actor, role))
        c.execute('insert into private.admin_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, team, admin))
        c.execute('insert into private.contractor_team_memberships(organization_id,team_id,user_id,active) values(%s,%s,%s,true)', (org, team, contractor))
        c.execute(FIXTURE)
        photo = c.execute('select pg_temp.recovery_fixture_photo(%s,%s,%s,%s,true)', (admin, org, team, contractor)).fetchone()[0]
        c.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': str(contractor), 'session_id': str(contractor)}),))
        prepared = c.execute('select public.begin_photo_transfer(%s,%s,%s,250000)', (uuid.uuid4(), photo, 'b' * 64)).fetchone()[0]
        c.execute("insert into storage.objects(id,bucket_id,name,owner_id,version) values(%s,%s,%s,%s,'V1')",
                  (object_id, prepared['bucket'], prepared['object_key'], str(contractor)))
        c.execute('set local role service_role')
        target = c.execute('select public.photo_verification_target_for_session(%s,%s,%s,%s)',
                           (photo, uuid.UUID(prepared['transfer_version']), contractor, contractor)).fetchone()[0]
        assert target['object_version'] == 'V1'
    args = (action, photo, uuid.UUID(prepared['transfer_version']), contractor, contractor,
            object_id, 'V1', prepared['bucket'], prepared['object_key'], 'b' * 64, 250000)
    ready, release, second_ready = threading.Event(), threading.Event(), threading.Event()
    results, errors, second_pid = {}, [], []

    def confirm(c):
        c.execute('set local role service_role')
        return c.execute(CONFIRM, args).fetchone()[0]

    def change(c):
        if kind == 'session-before-confirm':
            c.execute('delete from auth.sessions where id=%s', (contractor,))
        else:
            c.execute("update storage.objects set version='V2' where id=%s", (object_id,))

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind in ('confirm-before-replacement', 'same-action'):
                    results['first'] = confirm(c)
                else:
                    change(c)
                ready.set()
                assert release.wait(10)
        except BaseException as error:
            errors.append(error); ready.set()

    def second():
        try:
            with psycopg.connect(DSN) as c:
                second_pid.append(c.info.backend_pid); second_ready.set()
                try:
                    if kind == 'confirm-before-replacement':
                        change(c); results['second'] = 'CHANGED'
                    else:
                        results['second'] = confirm(c)
                except psycopg.Error as error:
                    c.rollback(); results['second'] = error.sqlstate
        except BaseException as error:
            errors.append(error); second_ready.set()

    one, two = threading.Thread(target=first), threading.Thread(target=second)
    one.start()
    try:
        assert ready.wait(10)
        if errors: raise errors[0]
        two.start(); assert second_ready.wait(10)
        blocked = False
        with psycopg.connect(DSN, autocommit=True) as observer:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                blocked = observer.execute("select exists(select 1 from pg_stat_activity where pid=%s and wait_event_type='Lock')", (second_pid[0],)).fetchone()[0]
                if blocked: break
                time.sleep(.02)
        assert blocked, 'No actual catalog/session/receipt lock wait observed'
    finally:
        release.set(); one.join(10)
        if two.ident is not None: two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors: raise errors[0]
    success = kind in ('same-action', 'confirm-before-replacement')
    if kind == 'same-action': assert results['first'] == results['second']
    elif kind == 'confirm-before-replacement': assert results['second'] == 'CHANGED'
    else: assert results['second'] == ('42501' if kind == 'session-before-confirm' else '22023'), results
    with psycopg.connect(DSN) as c:
        assert c.execute('select count(*) from private.photo_transfer_receipts where photo_id=%s', (photo,)).fetchone()[0] == int(success)
        assert c.execute('select count(*) from private.photo_receipt_actions where action_id=%s', (action,)).fetchone()[0] == int(success)
        assert c.execute('select state from private.photo_transfers where photo_id=%s', (photo,)).fetchone()[0] == ('RECEIVED' if success else 'WAITING')
        if success:
            assert c.execute('select object_id,object_version from private.photo_transfer_receipts where photo_id=%s', (photo,)).fetchone() == (object_id, 'V1')
        assert c.execute('select sync_status,remote_file_id,uploaded_at from public.photos where id=%s', (photo,)).fetchone() == ('WAITING', None, None)
    print(f'PASS photo verification {kind}: real lock wait; exact immutable receipt and no false client delivery')


for scenario in ['replacement-before-confirm', 'session-before-confirm', 'confirm-before-replacement', 'same-action']:
    run_case(scenario)
