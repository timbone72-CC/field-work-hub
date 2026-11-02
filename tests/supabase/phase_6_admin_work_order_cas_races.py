"""Two actual Admin transactions racing on one synthetic work order.
CI PostgreSQL only: never connect this test to hosted Supabase or Google.
"""
import datetime
import json
import os
import threading
import time
import uuid

import psycopg
from psycopg.types.json import Jsonb

DSN = os.environ["FWH_TEST_DATABASE_URL"]
ORG = uuid.UUID("00000000-0000-0000-0000-000000000001")
ADMIN_A = uuid.UUID("00000000-0000-0000-0000-000000000010")
CONTRACTOR = uuid.UUID("00000000-0000-0000-0000-000000000011")
TEAM = uuid.UUID("00000000-0000-0000-0000-000000000020")
ADMIN_B = uuid.uuid4()


def claims(conn, actor):
    payload = {
        "sub": str(actor), "session_id": str(actor),
        "role": "authenticated",
        "app_metadata": {"role": "ADMIN", "organization_id": str(ORG)},
    }
    conn.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(payload),))
    conn.execute("set local role authenticated")


with psycopg.connect(DSN) as setup:
    assert setup.info.dbname == "fwh_test" and setup.info.host in ("localhost", "127.0.0.1", "::1")
    setup.execute(
        "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) "
        "values(%s,%s,now(),%s::jsonb)",
        (ADMIN_B, str(ADMIN_B) + "@example.invalid",
         json.dumps({"role": "ADMIN", "organization_id": str(ORG)})),
    )
    setup.execute("insert into auth.sessions(id,user_id) values(%s,%s)", (ADMIN_B, ADMIN_B))
    setup.execute(
        "insert into private.account_work_access(organization_id,user_id,work_role,active) "
        "values(%s,%s,'ADMIN',true)", (ORG, ADMIN_B),
    )
    setup.execute(
        "insert into private.admin_team_memberships(organization_id,team_id,user_id,active) "
        "values(%s,%s,%s,true)", (ORG, TEAM, ADMIN_B),
    )
    cfg = {
        "schema": 1, "revision": str(uuid.uuid4()),
        "total": {"enabled": False, "minimum": 0}, "items": [],
    }
    claims(setup, ADMIN_A)
    wo = setup.execute(
        "select (j->>'work_order_id')::uuid from public.admin_create_work_order_v4("
        "false,%s,%s,%s,%s,%s,%s,%s) j",
        ("RACE-" + str(uuid.uuid4()), "CI synthetic address", "INSPECTION",
         "original", datetime.date.today(), CONTRACTOR, Jsonb(cfg)),
    ).fetchone()[0]
    starting_timestamp, requirements = setup.execute(
        "select w.updated_at,r.requirement_snapshot "
        "from public.work_orders w join public.work_order_runs r on r.id=w.current_run_id "
        "where w.id=%s", (wo,),
    ).fetchone()
    revision = uuid.UUID(requirements["revision"])

assert starting_timestamp is not None
ready, release, second_started = threading.Event(), threading.Event(), threading.Event()
results, errors, other_pid = {}, [], []

def edit(conn, instruction):
    return conn.execute(
        "select * from public.admin_update_work_order_v4("
        "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (wo, "RACE-" + str(wo), "CI synthetic address", "INSPECTION",
         instruction, datetime.date.today(), CONTRACTOR,
         revision, Jsonb(requirements), starting_timestamp),
    ).fetchone()


def first():
    try:
        with psycopg.connect(DSN) as conn:
            claims(conn, ADMIN_A)
            results["first"] = edit(conn, "Admin A accepted")
            ready.set()
            assert release.wait(10), "First transaction release timed out"
    except BaseException as exc:
        errors.append(exc)
        ready.set()


def second():
    try:
        with psycopg.connect(DSN) as conn:
            other_pid.append(conn.info.backend_pid)
            claims(conn, ADMIN_B)
            second_started.set()
            try:
                results["second"] = edit(conn, "Admin B stale")
            except psycopg.Error as exc:
                conn.rollback()
                results["second"] = exc.sqlstate
    except BaseException as exc:
        errors.append(exc)
        second_started.set()


one = threading.Thread(target=first)
two = threading.Thread(target=second)
one.start()
try:
    assert ready.wait(10), "First edit did not start"
    if errors:
        raise errors[0]
    two.start()
    assert second_started.wait(10), "Second Admin did not start"
    blocked = False
    with psycopg.connect(DSN, autocommit=True) as observer:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            blocked = observer.execute(
                "select exists(select 1 from pg_stat_activity "
                "where pid=%s and wait_event_type='Lock')",
                (other_pid[0],),
            ).fetchone()[0]
            if blocked:
                break
            time.sleep(0.02)
    assert blocked, "Second Admin did not wait on the same WO transaction"
finally:
    release.set()
    one.join(10)
    if two.ident is not None:
        two.join(10)

assert not one.is_alive() and not two.is_alive()
if errors:
    raise errors[0]
assert results["first"] is not None
assert results["second"] == "PT409", results
with psycopg.connect(DSN) as check:
    final, updated = check.execute(
        "select instructions,updated_at from public.work_orders where id=%s", (wo,)
    ).fetchone()
    assert final == "Admin A accepted", (final, results)
    assert updated != starting_timestamp, "Committed edit did not advance WO revision"
print("PASS Phase 6A: actual Admin A/B lock wait, first commit, second PT409, no overwrite")
