"""Two actual tabs for one synthetic Admin draft, CI PostgreSQL only."""
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
    claims(setup)
    cfg = {'schema': 1, 'revision': str(uuid.uuid4()), 'total': {'enabled': False, 'minimum': 0}, 'items': []}
    wo = setup.execute('select (j->>\'work_order_id\')::uuid from public.admin_create_work_order_v4('
        'false,%s,%s,%s,%s,%s,%s,%s) j', ('DRAFT-RACE-'+str(uuid.uuid4()), 'Synthetic address',
        'INSPECTION', 'active original', datetime.date.today(), CONTRACTOR, Jsonb(cfg))).fetchone()[0]
    base = setup.execute('select updated_at from public.work_orders where id=%s', (wo,)).fetchone()[0]
    body = {'woNumber': '', 'propertyAddress': '', 'workType': '', 'instructions': 'first draft',
            'dueDate': '', 'assignedUserId': str(CONTRACTOR), 'requirements': cfg, 'expectedRevision': cfg['revision']}
ready, release, started = threading.Event(), threading.Event(), threading.Event()
results, errors, second_pid = {}, [], []

def run_first():
    try:
        with psycopg.connect(DSN) as conn:
            claims(conn)
            results['first'] = conn.execute('select public.admin_save_job_draft(%s,%s,null,%s,%s)',
                (wo, Jsonb(body), base, uuid.uuid4())).fetchone()[0]
            ready.set()
            assert release.wait(10), 'First draft transaction did not release'
    except BaseException as exc:
        errors.append(exc)
        ready.set()

def run_second():
    try:
        with psycopg.connect(DSN) as conn:
            second_pid.append(conn.info.backend_pid)
            claims(conn)
            started.set()
            try:
                conn.execute('select public.admin_save_job_draft(%s,%s,null,%s,%s)',
                    (wo, Jsonb({**body, 'instructions': 'stale tab'}), base, uuid.uuid4()))
                results['second'] = 'UNEXPECTED SUCCESS'
            except psycopg.Error as exc:
                results['second'] = exc.sqlstate
                conn.rollback()
    except BaseException as exc:
        errors.append(exc)
        started.set()

one, two = threading.Thread(target=run_first), threading.Thread(target=run_second)
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
    assert blocked, 'Second tab did not serialize the first draft creation'
finally:
    release.set()
    one.join(10)
    if two.ident is not None:
        two.join(10)
assert not one.is_alive() and not two.is_alive()
if errors:
    raise errors[0]
assert results['second'] == 'PT409', results
with psycopg.connect(DSN) as check:
    claims(check)
    draft = check.execute('select public.admin_job_draft_state(%s)', (wo,)).fetchone()[0]['draft']
    assert draft['payload']['instructions'] == 'first draft'
    assert check.execute('select instructions from public.work_orders where id=%s', (wo,)).fetchone()[0] == 'active original'
print('PASS: two real draft transactions serialize; second stale tab PT409; active job unchanged')
