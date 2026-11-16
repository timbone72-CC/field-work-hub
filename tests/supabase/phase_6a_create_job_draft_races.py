"""Real two-connection new-work draft/save/consume races, disposable CI only."""
import datetime
import json
import os
import threading
import time
import uuid
import psycopg
from psycopg.types.json import Jsonb
DSN = os.environ['FWH_TEST_DATABASE_URL']
ORG = uuid.UUID('00000000-0000-0000-0000-000000000001')
ACTOR = uuid.UUID('00000000-0000-0000-0000-000000000010')
CONTRACTOR = uuid.UUID('00000000-0000-0000-0000-000000000011')

def claims(conn):
    conn.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({
        'sub': str(ACTOR), 'session_id': str(ACTOR), 'role': 'authenticated',
        'app_metadata': {'role': 'ADMIN', 'organization_id': str(ORG)}}),))
    conn.execute('set local role authenticated')

with psycopg.connect(DSN) as setup:
    assert setup.info.dbname == 'fwh_test' and setup.info.host in ('localhost', '127.0.0.1', '::1')
    before_work = setup.execute('select count(*) from public.work_orders').fetchone()[0]
    cfg = {'schema': 1, 'revision': str(uuid.uuid4()), 'total': {'enabled': False, 'minimum': 0}, 'items': []}
    body = {'woNumber': '', 'propertyAddress': '', 'workType': '', 'instructions': 'first new draft',
            'dueDate': '', 'assignedUserId': '', 'requirements': cfg, 'requirementsLegacy': False, 'expectedRevision': None,
            'numberMode': 'auto', 'rememberNumberMode': False, 'sourceTemplateId': None}

def race(first_call, second_call):
    ready, release, started = threading.Event(), threading.Event(), threading.Event()
    results, errors, second_pid = {}, [], []
    def first():
        try:
            with psycopg.connect(DSN) as conn:
                claims(conn)
                results['first'] = first_call(conn)
                ready.set()
                assert release.wait(10)
        except BaseException as exc:
            errors.append(exc)
            ready.set()
    def second():
        try:
            with psycopg.connect(DSN) as conn:
                second_pid.append(conn.info.backend_pid)
                claims(conn)
                started.set()
                try:
                    results['second'] = second_call(conn)
                except psycopg.Error as exc:
                    results['second'] = exc.sqlstate
                    conn.rollback()
        except BaseException as exc:
            errors.append(exc)
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
        with psycopg.connect(DSN, autocommit=True) as observer:
            deadline = time.monotonic()+3
            while time.monotonic() < deadline:
                blocked = observer.execute("select exists(select 1 from pg_stat_activity where pid=%s and wait_event_type='Lock')",
                                           (second_pid[0],)).fetchone()[0]
                if blocked:
                    break
                time.sleep(0.02)
        assert blocked, 'Second request did not wait on the creator transaction'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]
    return results

def save(conn):
    return conn.execute('select public.admin_save_job_draft(null,%s,null,null,%s)',
                        (Jsonb(body), uuid.uuid4())).fetchone()[0]

saved = race(save, save)
assert saved['second'] == 'PT409', saved
with psycopg.connect(DSN) as setup:
    claims(setup)
    draft = setup.execute('select public.admin_job_draft_state(null)').fetchone()[0]['draft']
    assert setup.execute('select count(*) from public.work_orders').fetchone()[0] == before_work
    complete = {**body, 'propertyAddress': 'Synthetic ready address', 'workType': 'INSPECTION',
                'dueDate': str(datetime.date.today()), 'assignedUserId': str(CONTRACTOR)}
    draft = setup.execute('select public.admin_save_job_draft(null,%s,%s,null,%s)',
                          (Jsonb(complete), uuid.UUID(draft['revision']), uuid.uuid4())).fetchone()[0]['draft']
    revision = uuid.UUID(draft['revision'])

def create(conn):
    return conn.execute('select j from public.admin_create_work_order_from_draft(%s) j', (revision,)).fetchone()[0]

created = race(create, create)
assert created['first'] == created['second'], created
with psycopg.connect(DSN) as check:
    claims(check)
    assert check.execute('select count(*) from public.work_orders').fetchone()[0] == before_work+1
    assert check.execute('select public.admin_job_draft_state(null)').fetchone()[0]['draft'] is None
print('PASS: new draft creation serializes; stale save PT409; concurrent explicit creation returns one job and consumes draft')
