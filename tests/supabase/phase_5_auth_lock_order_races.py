"""Reproduce the logged Auth lock inversion in disposable native PostgreSQL only.

The control uses the original users->sessions pair in a temporary function.
The candidate uses the actual installed authority helper with sessions first.
No live credentials, Auth requests, account mutation or work writes occur.
"""
import os
import threading
import time

import psycopg

DSN = os.environ['FWH_TEST_DATABASE_URL']


def connect():
    connection = psycopg.connect(DSN)
    assert connection.info.host in ('localhost', '127.0.0.1')
    assert connection.execute('select current_database()').fetchone()[0] == 'fwh_test'
    connection.execute("set local statement_timeout='6s'")
    connection.execute("set local deadlock_timeout='100ms'")
    return connection


def race(original):
    failures = []
    worker_pid = []
    started = threading.Event()

    def work_request():
        try:
            with connect() as connection:
                worker_pid.append(connection.info.backend_pid)
                if original:
                    connection.execute("""
                        create function pg_temp.original_auth_lock_pair() returns void
                        language plpgsql as $function$
                        begin
                          lock table auth.users,auth.sessions in share mode;
                        end;
                        $function$;
                    """)
                started.set()
                connection.execute('select pg_temp.original_auth_lock_pair()'
                                   if original else 'select private.lock_legacy_work_authority()')
        except psycopg.Error as error:
            failures.append(error.sqlstate)
            started.set()
        except BaseException as error:
            failures.append(error)
            started.set()

    worker = threading.Thread(target=work_request)
    with connect() as auth_writer:
        auth_writer.execute('lock table auth.sessions in row exclusive mode')
        writer_pid = auth_writer.info.backend_pid
        worker.start()
        try:
            assert started.wait(5), 'Work request did not start'
            assert worker_pid, failures
            with connect() as observer:
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    blocked = observer.execute(
                        'select %s = any(pg_blocking_pids(%s))',
                        (writer_pid, worker_pid[0])).fetchone()[0]
                    if blocked:
                        break
                    time.sleep(.02)
                else:
                    raise AssertionError('Did not observe the actual Auth-session lock wait')
                holds_users = observer.execute("""
                    select exists(select 1 from pg_locks
                    where pid=%s and relation='auth.users'::regclass
                      and mode='ShareLock' and granted)
                """, (worker_pid[0],)).fetchone()[0]
                assert holds_users is original, 'Candidate must wait before locking Auth users'
            try:
                # The other half of the exact relation/mode cycle in live logs.
                auth_writer.execute('lock table auth.users in row exclusive mode')
            except psycopg.Error as error:
                failures.append(error.sqlstate)
                auth_writer.rollback()
        finally:
            # Always release the Auth locks, including a failed control case.
            auth_writer.rollback()
            worker.join(8)
    assert not worker.is_alive(), 'Disposable work request did not terminate'
    if original:
        assert failures == ['40P01'], failures
        print('PASS Auth lock-order control: original pair reproduces PostgreSQL deadlock 40P01')
    else:
        assert failures == [], failures
        print('PASS Auth lock-order repair: writer finishes; real authority helper resumes without deadlock')


with connect() as connection:
    metadata = connection.execute("""
        select prosecdef,proconfig,
          has_function_privilege('anon',oid,'EXECUTE'),
          has_function_privilege('authenticated',oid,'EXECUTE'),
          has_function_privilege('service_role',oid,'EXECUTE')
        from pg_proc where oid='private.lock_legacy_work_authority()'::regprocedure
    """).fetchone()
    assert metadata[0] is True
    assert 'lock_timeout=5s' in metadata[1]
    assert 'search_path=""' in metadata[1]
    assert metadata[2:] == (False, False, True)

race(original=True)
race(original=False)
print('PASS Auth lock-order grants, empty search path and bounded timeout preserved')
