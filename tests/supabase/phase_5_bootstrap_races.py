"""Real connection races for initial setup. Disposable CI database only."""
import os
import threading
import time
import uuid

import psycopg
from psycopg.types.json import Jsonb

DSN = os.environ['FWH_TEST_DATABASE_URL']
CALL = 'select private.bootstrap_initial_team_access(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)'


def race(kind):
    org, admin, contractor, owner, team, action, wo = [uuid.uuid4() for _ in range(7)]
    with psycopg.connect(DSN) as c:
        c.execute("insert into public.organizations(id,name) values(%s,'BOOTSTRAP RACE TEST')", (org,))
        for actor, role in [(admin, 'ADMIN'), (contractor, 'CONTRACTOR'), (owner, None)]:
            metadata = {'organization_id': str(org), 'role': role} if role else {}
            c.execute('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(%s,%s,now(),%s)',
                      (actor, 'race@example.invalid', Jsonb(metadata)))
        c.execute("insert into public.work_orders(id,organization_id,assigned_user_id,wo_number,property_address,work_type,due_date) values(%s,%s,%s,%s,'TEST','TEST',current_date)",
                  (wo, org, contractor, f'BOOTSTRAP-RACE-{wo}'))
        snapshot = c.execute('select private.initial_team_work_snapshot(%s)', (org,)).fetchone()[0]
    args = (action, org, admin, owner, team, 'Initial TEST', [contractor], Jsonb(snapshot), 'TEST', 'Reviewed CI fixture')
    ready, release, second_ready = threading.Event(), threading.Event(), threading.Event()
    results, errors, second_pid = {}, [], []

    def first():
        try:
            with psycopg.connect(DSN) as c:
                if kind == 'wo-change':
                    c.execute("update public.work_orders set instructions='Changed after review' where id=%s", (wo,))
                elif kind == 'role-change':
                    c.execute("update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','\"SUPERVISOR\"') where id=%s", (contractor,))
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
                c.execute('set local role service_role')
                second_ready.set()
                second_args = (uuid.uuid4(),) + args[1:] if kind == 'competing-action' else args
                try:
                    results['second'] = c.execute(CALL, second_args).fetchone()[0]
                except psycopg.errors.SerializationFailure:
                    results['second'] = '40001'
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
                blocked = observer.execute("select exists(select 1 from pg_stat_activity where pid=%s and wait_event_type='Lock')", (second_pid[0],)).fetchone()[0]
                if blocked:
                    break
                time.sleep(.02)
        assert blocked, 'Second connection did not wait on the inventory/setup lock'
    finally:
        release.set()
        one.join(10)
        if two.ident is not None:
            two.join(10)
    assert not one.is_alive() and not two.is_alive()
    if errors:
        raise errors[0]
    if kind == 'same-action':
        assert results['first'] == results['second'], results
    else:
        assert results['second'] == '40001', results
    with psycopg.connect(DSN) as c:
        count = c.execute('select count(*) from private.initial_access_bootstrap where organization_id=%s', (org,)).fetchone()[0]
        expected = 1 if kind in ('same-action', 'competing-action') else 0
        assert count == expected
        assert c.execute('select count(*) from private.account_work_access where organization_id=%s', (org,)).fetchone()[0] == expected * 2
        assert c.execute('select responsible_team_id from public.work_orders where id=%s', (wo,)).fetchone()[0] == (team if expected else None)
        # Root-only cleanup of this disposable fixture; no hosted cleanup path.
        c.execute('delete from private.initial_access_bootstrap where organization_id=%s', (org,))
        c.execute('delete from private.admin_team_memberships where organization_id=%s', (org,))
        c.execute('delete from private.contractor_team_memberships where organization_id=%s', (org,))
        c.execute('delete from private.account_work_access where organization_id=%s', (org,))
        c.execute('delete from private.org_work_settings where organization_id=%s', (org,))
        c.execute('delete from private.platform_owner_capabilities where user_id=%s', (owner,))
        c.execute('delete from public.work_order_assignments where run_id in (select id from public.work_order_runs where work_order_id=%s)', (wo,))
        c.execute('delete from public.work_order_runs where work_order_id=%s', (wo,))
        c.execute('delete from public.work_orders where id=%s', (wo,))
        c.execute('delete from public.admin_teams where organization_id=%s', (org,))
        c.execute('delete from auth.users where id=any(%s)', ([admin, contractor, owner],))
        c.execute('delete from public.organizations where id=%s', (org,))
    print(f'PASS Phase 5 bootstrap {kind}: real lock wait, atomic mapping, no stale inventory activation')


for case in ['same-action', 'competing-action', 'wo-change', 'role-change']:
    race(case)
