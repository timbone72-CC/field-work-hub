"""Two real PostgreSQL connections. Disposable localhost CI fwh_test ONLY.
Creates synthetic approved packages; no provider, actual client, hosted data or secrets.
"""
import concurrent.futures
import os
import uuid

import psycopg
from psycopg.types.json import Jsonb

DSN = os.environ["FWH_TEST_DATABASE_URL"]
ROOT = "disposable_ci_drive_root_1234567890"
HASH = "a" * 64


def new_id():
    return uuid.uuid4()


def query(sql, args=()):
    with psycopg.connect(DSN) as c:
        c.execute("set local role service_role")
        return c.execute(sql, args).fetchone()[0]


def setup():
    org, company, admin, dest = [new_id() for _ in range(4)]
    packages = []
    with psycopg.connect(DSN) as c:
        assert c.info.dbname == "fwh_test"
        assert c.info.host in ("localhost", "127.0.0.1", "::1")
        c.execute("insert into public.organizations(id,name) values(%s,'DISPOSABLE DISPATCH RACE')", (org,))
        c.execute("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)"
                  " values(%s,'dispatch-race@example.invalid',now(),%s)",
                  (admin, Jsonb({"role": "ADMIN", "organization_id": str(org)})))
        c.execute("insert into private.client_companies(id,organization_id,name)"
                  " values(%s,%s,'DISPOSABLE CLIENT')", (company, org))
        c.execute("insert into private.client_delivery_destinations("
                  "id,organization_id,company_id,provider,provider_identity,"
                  "root_folder_id,verified,verified_at,active)"
                  " values(%s,%s,%s,'GOOGLE_DRIVE','disposable@example.invalid',%s,true,now(),true)",
                  (dest, org, company, ROOT))
        rev = c.execute("select revision from private.client_delivery_destinations "
                        "where id=%s", (dest,)).fetchone()[0]
        c.execute("insert into private.client_delivery_runtime("
                  "organization_id,worker_ready,last_verified_at,worker_identity)"
                  " values(%s,true,now(),'DISPOSABLE_CI')", (org,))
        for n in (1, 2):
            wo, pkg, action = [new_id() for _ in range(3)]
            c.execute("insert into public.work_orders("
                      "id,organization_id,wo_number,property_address,work_type,"
                      "due_date,client_company_id) values("
                      "%s,%s,%s,%s,'INSPECTION',current_date,%s)",
                      (wo, org, f'CI-DISPATCH-{wo}', f'{n} TEST CI Lane', company))
            run_row = c.execute("select current_run_id from public.work_orders where id=%s",
                                (wo,)).fetchone()
            assert run_row and run_row[0], "Work-order run trigger missing"
            manifest = {"package_id": str(pkg), "destination_id": str(dest),
                        "destination_root": ROOT, "destination_revision": str(rev),
                        "folder_layout": "ADDRESS_WORK_ORDER",
                        "selected_photos": [{"photo_id": str(new_id())}]}
            c.execute("insert into private.client_packages("
                      "id,organization_id,work_order_id,run_id,company_id,notes,"
                      "status,approved_manifest,approved_sha256,approved_by,"
                      "approved_at,destination_id)"
                      " values(%s,%s,%s,%s,%s,'CI ROLLBACK PROBE','QUEUED',%s,%s,%s,now(),%s)",
                      (pkg, org, wo, run_row[0], company, Jsonb(manifest), HASH, admin, dest))
            c.execute("insert into private.client_package_actions("
                      "action_id,package_id,actor_user_id,action_kind,request_fingerprint,result)"
                      " values(%s,%s,%s,'SEND',%s,'{}'::jsonb)",
                      (action, pkg, admin, "b" * 64))
            c.execute("insert into private.client_delivery_outbox("
                      "package_id,action_id,approved_sha256,destination_id)"
                      " values(%s,%s,%s,%s)", (pkg, action, HASH, dest))
            packages.append(pkg)
        c.execute("update private.client_delivery_package_dispatch_config set "
                  "enabled=true,legacy_worker_off_verified=true where singleton")
    return dest, packages


def run():
    dest, (pkg_a, pkg_b) = setup()
    worker_a, worker_b, request_a, request_b = [new_id() for _ in range(4)]
    def claim(args):
        pkg, worker, request = args
        return query("select public.service_claim_package_and_acquire_dispatch("
                     "%s,%s,%s,%s,%s)", (pkg, dest, ROOT, worker, request))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a, b = list(pool.map(claim, [
            (pkg_a, worker_a, request_a), (pkg_b, worker_b, request_b)]))
    assert a["claimed"] is True and b["claimed"] is True, (a, b)
    assert a["generation"] == 1 and b["generation"] == 1
    # Same package, two genuinely simultaneous database clients.
    def begin(step):
        return query("select public.service_begin_package_dispatch_step("
                     "%s,%s,%s,1,%s)", (pkg_a, worker_a, request_a, step))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(begin, [new_id(), new_id()]))
    admitted = [r for r in (first, second) if r["acquired"]]
    assert len(admitted) == 1 and sum(not r["acquired"] for r in (first, second)) == 1
    # An unrelated package is not held hostage by the unfinished step.
    step_b = new_id()
    assert query("select public.service_begin_package_dispatch_step(%s,%s,%s,1,%s)",
                 (pkg_b, worker_b, request_b, step_b))["acquired"]
    assert query("select public.service_complete_package_dispatch_step("
                 "%s,%s,%s,1,%s,'VERIFIED_METADATA_STEP')",
                 (pkg_b, worker_b, request_b, step_b))["completed"]
    assert query("select public.service_begin_package_dispatch_step(%s,%s,%s,1,%s)",
                 (pkg_b, worker_b, request_b, new_id()))["acquired"]
    try:
        query("select public.service_release_package_dispatch(%s,%s,%s,1)",
              (pkg_a, worker_a, request_a))
    except psycopg.errors.InsufficientPrivilege:
        pass
    else:
        raise AssertionError("Held uncertain package was prematurely released")
    with psycopg.connect(DSN) as c:
        assert c.execute("select count(*) from private.client_delivery_package_dispatch_permits"
                         ).fetchone()[0] == 2
        assert c.execute("select count(*) from private.client_delivery_package_step_attempts"
                         " where verified_at is null").fetchone()[0] == 2
        # A finished metadata step does not invent a final receipt.
        assert c.execute("select count(*) from private.client_delivery_final_receipts"
                         ).fetchone()[0] == 0
        c.execute("update private.client_delivery_package_dispatch_config set "
                  "enabled=false,legacy_worker_off_verified=false where singleton")
    print("PASS package-scoped two-connection claims, duplicate step fence, "
          "independent recovery and no synthetic final receipt")


if __name__ == "__main__":
    run()
