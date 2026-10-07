"""Two real PostgreSQL connections against migrated, disposable CI fixtures only."""
import os
import threading
import time
import uuid
import psycopg

DSN=os.environ['FWH_TEST_DATABASE_URL']
ORG='00000000-0000-0000-0000-000000000001'
ADMIN='00000000-0000-0000-0000-000000000010'
A='00000000-0000-0000-0000-000000000011'
B='00000000-0000-0000-0000-000000000012'

def context(c,user,role):
    import json
    c.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':user,'session_id':user,'role':'authenticated','app_metadata':{'role':role,'organization_id':ORG}}),))
    c.execute('set local role authenticated')

def run_race(first_kind,second_kind):
    wo=uuid.uuid4();name=f'FWH-CI-RACE-{wo}';action=uuid.uuid4()
    with psycopg.connect(DSN) as c:
        c.execute('insert into public.work_orders(id,organization_id,responsible_team_id,assigned_user_id,wo_number,property_address,work_type,due_date) values(%s,%s,%s,%s,%s,%s,%s,current_date)',(wo,ORG,'00000000-0000-0000-0000-000000000020',A,name,'CI TEST','TEST'))
        run,instance=c.execute('select w.current_run_id,a.id from public.work_orders w join public.work_order_assignments a on a.run_id=w.current_run_id where w.id=%s and a.assignment_ended_at is null',(wo,)).fetchone()
    ready=threading.Event();release=threading.Event();errors=[];results={}
    def mutate(c,kind):
        if kind=='action':
            context(c,A,'CONTRACTOR')
            return c.execute("select public.accept_field_action(%s,%s,%s,%s,'START',to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))",(action,wo,run,instance)).fetchone()[0]
        if kind=='reassign':
            context(c,ADMIN,'ADMIN')
            return c.execute('select * from public.admin_update_work_order(%s,%s,%s,%s,%s,current_date,%s)',(wo,name,'CI TEST','TEST','',B)).fetchone()
        # Cancellation is a fixture-owner operation, not new client authority.
        return c.execute("update public.work_orders set field_status='CANCELLED' where id=%s returning field_status",(wo,)).fetchone()
    def first():
        try:
            with psycopg.connect(DSN) as c:
                results['first']=mutate(c,first_kind);ready.set();assert release.wait(10)
        except BaseException as e:errors.append(e);ready.set()
    def second():
        try:
            with psycopg.connect(DSN) as c:results['second']=mutate(c,second_kind)
        except BaseException as e:errors.append(e)
    t1=threading.Thread(target=first);t1.start();assert ready.wait(10)
    t2=threading.Thread(target=second);t2.start()
    # Observe the second database backend waiting on the shared WO lock before release.
    blocked=False
    with psycopg.connect(DSN,autocommit=True) as observer:
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            blocked=observer.execute("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid())").fetchone()[0]
            if blocked:break
            time.sleep(.05)
    release.set();t1.join(10);t2.join(10)
    assert not t1.is_alive() and not t2.is_alive()
    if errors:raise errors[0]
    assert blocked,'Second mutation did not wait for the shared WO row lock'
    with psycopg.connect(DSN) as c:
        status,assignee,pending=c.execute('select field_status,assigned_user_id,pending_assignee_user_id from public.work_orders where id=%s',(wo,)).fetchone()
        count=c.execute('select count(*) from public.field_actions where work_order_id=%s',(wo,)).fetchone()[0]
        if first_kind=='action' and second_kind=='reassign':
            assert status=='IN_PROGRESS' and str(assignee)==A and str(pending)==B and count==1
        elif first_kind=='reassign':
            assert status=='ASSIGNED' and str(assignee)==B and count==0 and results['second']['outcome']=='CONFLICT'
        elif first_kind=='cancel':
            assert status=='CANCELLED' and count==0 and results['second']['reason']=='CANCELLED'
        else:
            assert status=='CANCELLED' and count==1
        c.execute('delete from public.field_actions where work_order_id=%s',(wo,))
        c.execute('delete from public.work_order_assignments where run_id=%s',(run,))
        c.execute('delete from public.work_order_runs where id=%s',(run,))
        c.execute('delete from public.work_orders where id=%s',(wo,))
    print(f'PASS {first_kind} then {second_kind}: observed real lock wait and atomic result')

for pair in [('action','reassign'),('reassign','action'),('action','cancel'),('cancel','action')]:
    run_race(*pair)
