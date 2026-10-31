"""Actual PostgREST 14.5 conflict responses against disposable local fixtures only."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid

import psycopg

DSN = os.environ['FWH_TEST_DATABASE_URL']
ADMIN = '00000000-0000-0000-0000-000000000010'
CONTRACTOR = '00000000-0000-0000-0000-000000000011'
ORG = '00000000-0000-0000-0000-000000000001'
BASE = 'http://127.0.0.1:3400'


def connect():
    settings = psycopg.conninfo.conninfo_to_dict(DSN)
    assert settings.get('host') in ('localhost', '127.0.0.1')
    assert settings.get('dbname') == 'fwh_test'
    connection = psycopg.connect(DSN)
    assert connection.info.host in ('localhost', '127.0.0.1')
    assert connection.execute('select current_database()').fetchone()[0] == 'fwh_test'
    return connection


claims = {'sub': ADMIN, 'session_id': ADMIN, 'role': 'authenticated',
          'app_metadata': {'role': 'ADMIN', 'organization_id': ORG},
          'exp': int(time.time()) + 300}
requirements = {'schema': 1, 'revision': str(uuid.uuid4()),
                'total': {'enabled': False, 'minimum': 0}, 'items': []}
with connect() as connection:
    connection.execute("select set_config('request.jwt.claims',%s,true)",
                       (json.dumps(claims),))
    connection.execute('set local role authenticated')
    result = connection.execute('''
        select public.admin_create_work_order_v4(false,%s,%s,%s,%s,current_date,%s,%s)
    ''', ('HTTP-' + str(uuid.uuid4()), 'Synthetic conflict fixture', 'INSPECT',
          'Disposable HTTP test', CONTRACTOR, json.dumps(requirements))).fetchone()[0]
    wo = result['work_order_id']


def snapshot():
    with connect() as connection:
        return connection.execute('''
            select to_jsonb(w),to_jsonb(r)
            from public.work_orders w join public.work_order_runs r on r.id=w.current_run_id
            where w.id=%s
        ''', (wo,)).fetchone()


before = snapshot()
secret = secrets.token_urlsafe(48)


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')


unsigned = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode(claims)
signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), unsigned, hashlib.sha256).digest()).rstrip(b'=')
token = (unsigned + b'.' + signature).decode()
environment = dict(os.environ, PGRST_DB_URI=DSN, PGRST_DB_SCHEMAS='public',
                   PGRST_DB_ANON_ROLE='anon', PGRST_JWT_SECRET=secret,
                   PGRST_SERVER_HOST='127.0.0.1', PGRST_SERVER_PORT='3400',
                   PGRST_DB_POOL='2', PGRST_DB_POOL_ACQUISITION_TIMEOUT='2')
container = 'fwh-conflict-http-' + uuid.uuid4().hex
started = False
try:
    command = ['docker', 'run', '--detach', '--rm', '--network', 'host', '--name', container]
    for name in ('PGRST_DB_URI', 'PGRST_DB_SCHEMAS', 'PGRST_DB_ANON_ROLE',
                 'PGRST_JWT_SECRET', 'PGRST_SERVER_HOST', 'PGRST_SERVER_PORT',
                 'PGRST_DB_POOL', 'PGRST_DB_POOL_ACQUISITION_TIMEOUT'):
        command += ['--env', name]
    command += ['postgrest/postgrest:v14.5']
    result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, 'Disposable PostgREST startup failed'
    started = True
    deadline = time.monotonic() + 20
    while True:
        try:
            with urllib.request.urlopen(BASE + '/', timeout=1) as response:
                assert response.status == 200
            break
        except (urllib.error.URLError, TimeoutError):
            if time.monotonic() >= deadline:
                raise AssertionError('Disposable PostgREST did not become ready') from None
            time.sleep(.1)

    def conflict(name, payload):
        request = urllib.request.Request(BASE + '/rpc/' + name,
                                        data=json.dumps(payload).encode(),
                                        headers={'Authorization': 'Bearer ' + token,
                                                 'Content-Type': 'application/json'})
        started_at = time.monotonic()
        try:
            urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            result = json.load(error)
            assert error.code == 409 and result['code'] == 'PT409', 'Wrong conflict response'
        else:
            raise AssertionError('Conflicting request unexpectedly succeeded')
        assert time.monotonic() - started_at < 5, 'Conflict entered retry loop'

    conflict('admin_correction_state', {'p_wo': str(wo)})
    conflict('admin_set_photo_requirements', {'p_work_order_id': str(wo),
                                             'p_expected_revision': str(uuid.uuid4()),
                                             'p_requirements': requirements})
    assert snapshot() == before, 'Conflict changed work or run facts'
    print('PASS PostgREST 14.5: correction eligibility and stale requirements return HTTP 409/PT409 promptly')
    print('PASS HTTP conflicts preserve exact work and run facts; no live Auth or hosted request')
finally:
    if started:
        subprocess.run(['docker', 'stop', container], capture_output=True, timeout=20, check=True)

with connect() as connection:
    # Exact-source parity for the legacy Run 1 compatibility function;
    # preserve the original PT409-to-40001 provenance check on requirements.
    for signature, expected, client_execute, undo_pt409 in (
        ('private.admin_correction_basis(uuid)', 'd51474ff0e5b600f7ebfa5aeed8e4f62', True, False),
        ('private.admin_set_photo_requirements_phase4_engine(uuid,uuid,jsonb)',
         'd91ff5f2b5eeda06129171ae057b715c', False, True),
    ):
        row = connection.execute('''
            select md5(case when %s then replace(prosrc,%s,%s) else prosrc end),
              prosecdef,proconfig,
              has_function_privilege('anon',oid,'EXECUTE'),
              has_function_privilege('authenticated',oid,'EXECUTE'),
              has_function_privilege('service_role',oid,'EXECUTE')
            from pg_proc where oid=%s::regprocedure
        ''', (undo_pt409, "'PT409'", "'40001'", signature)).fetchone()
        assert row[0] == expected and row[1] and 'search_path=""' in row[2]
        assert not row[3] and row[4] == client_execute and row[5]
print('PASS conflict repair preserves all predicates, source parity, private engine grants and security configuration')

