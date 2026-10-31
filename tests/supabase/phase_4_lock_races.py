"""Real two-connection Phase 4 races. Disposable CI database only, never hosted."""
import datetime
import hashlib
import json
import os
import threading
import time
import uuid
import psycopg
from psycopg.types.json import Jsonb

DSN = os.environ['FWH_TEST_DATABASE_URL']
ORG = '00000000-0000-0000-0000-000000000001'
ADMIN = '00000000-0000-0000-0000-000000000010'
ACTOR = '00000000-0000-0000-0000-000000000011'

def context(c, user, role):
    c.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': user, 'session_id': user, 'role': 'authenticated', 'app_metadata': {'role': role, 'organization_id': ORG}}),))
    c.execute('set local role authenticated')

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')

def race(first_kind, second_kind):
    wo = uuid.uuid4()
    config = {'schema': 1, 'revision': str(uuid.uuid4()), 'total': {'enabled': False, 'minimum': 0}, 'items': []}
    action = uuid.uuid4()
    set_id = uuid.uuid4()
    start_time = utc()
    with psycopg.connect(DSN) as c:
        c.execute('insert into public.work_orders(id,organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,due_date) values(%s,%s,%s,%s,%s,%s,%s,current_date)', (wo, ORG, '00000000-0000-0000-0000-000000000020', ACTOR, f'FWH-CI-P4-{wo}', 'CI TEST', 'TEST'))
        run, instance = c.execute('select w.current_run_id,a.id from public.work_orders w join public.work_order_assignments a on a.run_id=w.current_run_id where w.id=%s and a.assignment_ended_at is null', (wo,)).fetchone()
        context(c, ADMIN, 'ADMIN')
        snapshot = c.execute('select public.admin_set_photo_requirements(%s,null,%s)', (wo, Jsonb(config))).fetchone()[0]
        revision = snapshot['revision']
    photos = [{'id': str(uuid.uuid4()), 'item_id': None, 'captured_at': utc()}]
    payload = json.dumps(photos, separators=(',', ':'))
    digest = hashlib.sha256(payload.encode()).hexdigest()
    if 'finish' in (first_kind, second_kind):
        with psycopg.connect(DSN) as c:
            context(c, ACTOR, 'CONTRACTOR')
            assert c.execute("select public.accept_field_action_v4(%s,%s,%s,%s,'START',%s,%s,null,'')", (action, wo, run, instance, start_time, revision)).fetchone()[0]['outcome'] == 'APPLIED'
            assert c.execute('select public.register_photo_finish_set(%s,%s,%s,%s,%s,%s,%s,%s)', (set_id, wo, run, instance, revision, Jsonb(photos), digest, payload)).fetchone()[0]['outcome'] == 'APPLIED'
        action = uuid.uuid4()
    finish_time = utc()
    ready, release = threading.Event(), threading.Event()
    results, errors = {}, []
    def mutate(c, kind):
        if kind == 'edit':
            context(c, ADMIN, 'ADMIN')
            edited = dict(config, total={'enabled': True, 'minimum': 1})
            try:
                with c.transaction():
                    return c.execute('select public.admin_set_photo_requirements(%s,%s,%s)', (wo, revision, Jsonb(edited))).fetchone()[0]
            except psycopg.errors.InvalidParameterValue:
                return {'reason': 'FROZEN'}
        if kind in ('start', 'finish'):
            context(c, ACTOR, 'CONTRACTOR')
            return c.execute('select public.accept_field_action_v4(%s,%s,%s,%s,%s,%s,%s,%s,%s)', (action, wo, run, instance, 'START' if kind == 'start' else 'COMPLETE', start_time if kind == 'start' else finish_time, revision, None if kind == 'start' else set_id, '' if kind == 'start' else digest)).fetchone()[0]
        return c.execute("update public.work_orders set field_status='CANCELLED' where id=%s returning field_status", (wo,)).fetchone()
    def first():
        try:
            with psycopg.connect(DSN) as c:
                results['first'] = mutate(c, first_kind)
                ready.set()
                assert release.wait(10)
        except BaseException as error:
            errors.append(error)
            ready.set()
    def second():
        try:
            with psycopg.connect(DSN) as c:
                results['second'] = mutate(c, second_kind)
        except BaseException as error:
            errors.append(error)
    one = threading.Thread(target=first)
    one.start()
    assert ready.wait(10)
    two = threading.Thread(target=second)
    two.start()
    blocked = False
    with psycopg.connect(DSN, autocommit=True) as observer:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            blocked = observer.execute("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid())").fetchone()[0]
            if blocked:
                break
            time.sleep(.05)
    release.set()
    one.join(10)
    two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]
    assert blocked, 'Second mutation did not wait on the same WO lock'
    expected = {('start', 'edit'): 'FROZEN', ('edit', 'start'): 'REQUIREMENTS_CHANGED', ('cancel', 'finish'): 'CANCELLED'}
    if (first_kind, second_kind) in expected:
        assert results['second']['reason'] == expected[first_kind, second_kind], results
    with psycopg.connect(DSN) as c:
        if 'finish' in (first_kind, second_kind):
            assert c.execute('select count(*) from public.photos where work_order_id=%s', (wo,)).fetchone()[0] == 1
            assert c.execute('select count(*) from public.field_actions where work_order_id=%s', (wo,)).fetchone()[0] == (2 if first_kind == 'finish' else 1)
        c.execute('delete from public.field_actions where work_order_id=%s', (wo,))
        c.execute('delete from public.photos where work_order_id=%s', (wo,))
        c.execute('delete from public.photo_finish_sets where work_order_id=%s', (wo,))
        c.execute('delete from public.work_order_assignments where run_id=%s', (run,))
        c.execute('delete from public.work_order_runs where id=%s', (run,))
        c.execute('delete from public.work_orders where id=%s', (wo,))
    print(f'PASS Phase 4 {first_kind} then {second_kind}: real lock wait, preserved metadata and atomic outcome')

for pair in [('start', 'edit'), ('edit', 'start'), ('finish', 'cancel'), ('cancel', 'finish')]:
    race(*pair)
