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
DRIVE = "disposable_ci_shared_drive_123456"
HASH = "a" * 64


def new_id():
    return uuid.uuid4()


def query(sql, args=()):
    with psycopg.connect(DSN) as c:
        c.execute("set local role service_role")
        return c.execute(sql, args).fetchone()[0]


def setup(pinned_test_package=None):
    root = ROOT if pinned_test_package is None else '1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK'
    actor_email = ('dispatch-race@example.invalid' if pinned_test_package is None
                   else 'dispatch-race-final@example.invalid')
    provider_email = ('disposable@example.invalid' if pinned_test_package is None
                      else 'disposable-final@example.invalid')
    org, company, admin, dest = [new_id() for _ in range(4)]
    packages = []
    with psycopg.connect(DSN) as c:
        assert c.info.dbname == "fwh_test"
        assert c.info.host in ("localhost", "127.0.0.1", "::1")
        c.execute("insert into public.organizations(id,name) values(%s,'DISPOSABLE DISPATCH RACE')", (org,))
        c.execute("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)"
                  " values(%s,%s,now(),%s)",
                  (admin, actor_email, Jsonb({"role": "ADMIN", "organization_id": str(org)})))
        c.execute("insert into private.client_companies(id,organization_id,name)"
                  " values(%s,%s,'DISPOSABLE CLIENT')", (company, org))
        c.execute("insert into private.client_delivery_destinations("
                  "id,organization_id,company_id,provider,provider_identity,"
                  "root_folder_id,verified,verified_at,verification_receipt,active)"
                  " values(%s,%s,%s,'GOOGLE_DRIVE',%s,%s,true,now(),'{}'::jsonb,true)",
                  (dest, org, company, provider_email, root))
        rev = c.execute("select revision from private.client_delivery_destinations "
                        "where id=%s", (dest,)).fetchone()[0]
        # Root proof is synthetic and confined to the destroyed CI database.
        # It is never used as Google evidence outside this SQL race fixture.
        preflight_id, reserve_action, proof_action = [new_id() for _ in range(3)]
        proof_id = ('disposable_ci_remote_proof_123456789' if pinned_test_package is None
                    else 'disposable_ci_final_proof_123456789')
        c.execute("insert into private.client_delivery_destination_preflights("
                  "action_id,destination_id,organization_id,company_id,"
                  "expected_revision,provider_identity,root_folder_id,shared_drive_id)"
                  " values(%s,%s,%s,%s,%s,%s,%s,%s)",
                  (preflight_id, dest, org, company, rev, provider_email, root, DRIVE))
        c.execute("insert into private.client_destination_provider_proof_reservations("
                  "destination_id,action_id,preflight_action_id,organization_id,company_id,"
                  "expected_revision,provider_identity,root_folder_id,drive_id,"
                  "proof_folder_id,proof_folder_name) values("
                  "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                  (dest, reserve_action, preflight_id, org, company, rev, provider_email, root, DRIVE,
                   proof_id, "FWH DISPOSABLE CLIENT PROOF 1234567890ab"))
        c.execute("insert into private.client_destination_provider_proof_receipts("
                  "destination_id,action_id,proof_folder_id,proof_drive_id)"
                  " values(%s,%s,%s,%s)", (dest, proof_action, proof_id, DRIVE))
        c.execute("insert into private.client_delivery_runtime("
                  "organization_id,worker_ready,last_verified_at,worker_identity)"
                  " values(%s,true,now()-interval '72 hours','DISPOSABLE_CI')", (org,))
        for n in (1, 2):
            wo, pkg, action = [new_id() for _ in range(3)]
            if n == 1 and pinned_test_package is not None:
                pkg = pinned_test_package
            c.execute("insert into public.work_orders("
                      "id,organization_id,wo_number,property_address,work_type,"
                      "due_date,client_company_id) values("
                      "%s,%s,%s,%s,'INSPECTION',current_date,%s)",
                      (wo, org, f'CI-DISPATCH-{wo}', f'{n} TEST CI Lane', company))
            run_row = c.execute("select current_run_id from public.work_orders where id=%s",
                                (wo,)).fetchone()
            assert run_row and run_row[0], "Work-order run trigger missing"
            manifest = {"package_id": str(pkg), "destination_id": str(dest),
                        "destination_root": root, "destination_revision": str(rev),
                        "folder_layout": "ADDRESS_WORK_ORDER",
                        "selected_photos": [{"photo_id": str(new_id())}]}
            if n == 1 and pinned_test_package is None:
                # The same-owner lease renewal now proves a real two-photo
                # frozen manifest on disposable PostgreSQL, without Google.
                manifest["selected_photos"].append({"photo_id": str(new_id())})
            # The fixed-ID failed-final-step fixture must also have frozen
            # byte-accurate photo and manifest identities. Ordinary race
            # fixtures keep their original lean synthetic shape.
            approved_hash = HASH
            if n == 1 and pinned_test_package is not None:
                manifest["selected_photos"][0].update({
                    "observed_sha256": "b" * 64, "observed_size": 279184
                })
                manifest["fixture_padding"] = ""
                current_size = c.execute(
                    "select octet_length(%s::jsonb::text)", (Jsonb(manifest),)
                ).fetchone()[0]
                assert current_size < 1382
                manifest["fixture_padding"] = "x" * (1382 - current_size)
                assert c.execute(
                    "select octet_length(%s::jsonb::text)", (Jsonb(manifest),)
                ).fetchone()[0] == 1382
                approved_hash = c.execute(
                    "select encode(sha256(convert_to(%s::jsonb::text,'UTF8')),'hex')",
                    (Jsonb(manifest),)
                ).fetchone()[0]
            c.execute("insert into private.client_packages("
                      "id,organization_id,work_order_id,run_id,company_id,notes,"
                      "status,approved_manifest,approved_sha256,approved_by,"
                      "approved_at,destination_id)"
                      " values(%s,%s,%s,%s,%s,'CI ROLLBACK PROBE','QUEUED',%s,%s,%s,now(),%s)",
                      (pkg, org, wo, run_row[0], company, Jsonb(manifest), approved_hash, admin, dest))
            c.execute("insert into private.client_package_actions("
                      "action_id,package_id,actor_user_id,action_kind,request_fingerprint,result)"
                      " values(%s,%s,%s,'SEND',%s,'{}'::jsonb)",
                      (action, pkg, admin, "b" * 64))
            c.execute("insert into private.client_delivery_outbox("
                      "package_id,action_id,approved_sha256,destination_id)"
                      " values(%s,%s,%s,%s)", (pkg, action, approved_hash, dest))
            packages.append(pkg)
        c.execute("update private.client_delivery_package_dispatch_config set "
                  "enabled=true,legacy_worker_off_verified=true where singleton")
        # A fresh package-specific synthetic receipt is mandatory before claim.
        # The production worker obtains equivalent evidence from READ-ONLY
        # Google about/files GETs, never this CI database fixture path.
        for pkg in packages:
            proof = c.execute(
                "select private.service_record_pinned_package_provider_check("
                "%s,%s,%s,%s,%s,%s,now(),%s)",
                (pkg, dest, root, provider_email, DRIVE, "synthetic_permission_id_001", new_id())
            ).fetchone()[0]
            assert proof["verified"] is True and proof["package_id"] == str(pkg)

    return dest, packages


def run():
    dest, (pkg_a, pkg_b) = setup()
    # A speculative first claim is rolled back in this disposable CI database.
    # It cannot consume a real slot or alter the concurrent-claim race below.
    with psycopg.connect(DSN) as ci_tx:
        ci_tx.execute("set local role service_role")
        first = ci_tx.execute(
            "select public.service_select_next_delivery_package()"
        ).fetchone()[0]
        assert first["available"] is True and first["package_id"] == str(pkg_a), first
        speculative = ci_tx.execute(
            "select public.service_claim_package_and_acquire_dispatch(%s,%s,%s,%s,%s)",
            (pkg_a, dest, ROOT, new_id(), new_id())
        ).fetchone()[0]
        assert speculative["claimed"] is True, speculative
        independent = ci_tx.execute(
            "select public.service_select_next_delivery_package()"
        ).fetchone()[0]
        assert independent["available"] is True, independent
        assert independent["package_id"] == str(pkg_b), (
            "Free second slot must serve independent queued package", independent)
        ci_tx.rollback()
    worker_a, worker_b, request_a, request_b = [new_id() for _ in range(4)]
    def claim(args):
        pkg, worker, request = args
        return query("select public.service_claim_package_and_acquire_dispatch("
                     "%s,%s,%s,%s,%s)", (pkg, dest, ROOT, worker, request))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a, b = list(pool.map(claim, [
            (pkg_a, worker_a, request_a), (pkg_b, worker_b, request_b)]))
    assert a["claimed"] is True and b["claimed"] is True, (a, b)
    assert len(a["manifest"]["selected_photos"]) == 2
    assert len(b["manifest"]["selected_photos"]) == 1
    assert a["generation"] == 1 and b["generation"] == 1
    # Same package, two genuinely simultaneous database clients.
    def begin(step):
        return query("select public.service_begin_package_dispatch_step("
                     "%s,%s,%s,1,%s)", (pkg_a, worker_a, request_a, step))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(begin, [new_id(), new_id()]))
    admitted = [r for r in (first, second) if r["acquired"]]
    assert len(admitted) == 1 and sum(not r["acquired"] for r in (first, second)) == 1
    # Confirm exactly one parent/provider step, before expiring the saved
    # lease to test real same-permit continuation. No Google calls are made.
    verified_step = admitted[0]["step_id"]
    assert query("select public.service_complete_package_dispatch_step("
                 "%s,%s,%s,1,%s,'VERIFIED_PROVIDER_STEP')",
                 (pkg_a, worker_a, request_a, verified_step))["completed"]
    # A newly verified step moves A behind the still-safe B: repeated
    # wakes cannot keep selecting the oldest package forever.
    next_safe = query("select public.service_select_next_delivery_package()")
    assert next_safe["package_id"] == str(pkg_b), next_safe
    # An unrelated package is not held hostage by the unfinished step.
    step_b = new_id()
    assert query("select public.service_begin_package_dispatch_step(%s,%s,%s,1,%s)",
                 (pkg_b, worker_b, request_b, step_b))["acquired"]
    assert query("select public.service_complete_package_dispatch_step("
                 "%s,%s,%s,1,%s,'VERIFIED_METADATA_STEP')",
                 (pkg_b, worker_b, request_b, step_b))["completed"]
    # After both have verified progress, oldest verified step takes its
    # turn (A). No new owner/permit or provider identity is invented.
    next_safe = query("select public.service_select_next_delivery_package()")
    assert next_safe["package_id"] == str(pkg_a), next_safe
    assert query("select public.service_begin_package_dispatch_step(%s,%s,%s,1,%s)",
                 (pkg_b, worker_b, request_b, new_id()))["acquired"]
    # An unverified step freezes only B, not A.
    next_safe = query("select public.service_select_next_delivery_package()")
    assert next_safe["package_id"] == str(pkg_a), next_safe
    # Fixture-only 10-second expiry (not hosted); exact worker/generation
    # and previous verified provider step are unchanged.
    with psycopg.connect(DSN) as c:
        c.execute("update private.client_delivery_outbox "
                  "set lease_until=now()-interval '10 seconds' "
                  "where package_id=%s and worker_id=%s and lease_generation=1",
                  (pkg_a, worker_a))
    descriptor=query("select public.service_read_pinned_package_dispatch(%s,%s,%s)",
                     (pkg_a,dest,ROOT))
    assert descriptor["resumable"] is True and descriptor["active"] is False, descriptor
    assert descriptor["worker_id"] == str(worker_a)
    assert descriptor["request_id"] == str(request_a)
    assert descriptor["generation"] == 1
    # A wrong saved worker/request may not renew the existing owner.
    for wrong_worker,wrong_request in [(new_id(),request_a),(worker_a,new_id())]:
        try:
            query("select public.service_resume_pinned_package_dispatch("
                  "%s,%s,%s,%s,%s,1,'disposable@example.invalid',%s,%s,now(),%s)",
                  (pkg_a,dest,ROOT,wrong_worker,wrong_request,DRIVE,
                   "synthetic_permission_id_001",new_id()))
        except psycopg.errors.InsufficientPrivilege:
            pass
        else:
            raise AssertionError("Mismatched package lease owner renewed")
    # The other package's previously unfinished step must deny continuation,
    # without suppressing this independently verified package.
    with psycopg.connect(DSN) as c:
        c.execute("update private.client_delivery_outbox "
                  "set lease_until=now()-interval '10 seconds' "
                  "where package_id=%s and worker_id=%s and lease_generation=1",
                  (pkg_b,worker_b))
    held=query("select public.service_read_pinned_package_dispatch(%s,%s,%s)",
               (pkg_b,dest,ROOT))
    assert held=={"present":True,"active":False},held
    # Real two-connection race: one can renew the SAME permit and the second
    # must be rejected after the first makes the lease current.
    def resume(proof_id):
        try:
            return query("select public.service_resume_pinned_package_dispatch("
                         "%s,%s,%s,%s,%s,1,'disposable@example.invalid',%s,%s,now(),%s)",
                         (pkg_a,dest,ROOT,worker_a,request_a,DRIVE,
                          "synthetic_permission_id_001",proof_id))
        except psycopg.errors.InsufficientPrivilege:
            return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(resume,[new_id(),new_id()]))
    assert sum(r is not None and r.get("resumed") is True for r in results)==1,results
    renewed=next(r for r in results if r is not None)
    assert renewed["worker_id"]==str(worker_a)
    assert renewed["request_id"]==str(request_a)
    assert renewed["generation"]==1
    assert len(renewed["manifest"]["selected_photos"]) == 2
    assert query("select public.service_read_package_dispatch_owner(%s,%s,%s,1)",
                 (pkg_a,worker_a,request_a))["active"]
    with psycopg.connect(DSN) as c:
        assert c.execute("select count(*) from private.client_delivery_package_step_attempts "
                         "where package_id=%s and verified_at is null",
                         (pkg_b,)).fetchone()[0] == 1
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
                         " where verified_at is null").fetchone()[0] == 1
        # A finished metadata step does not invent a final receipt.
        assert c.execute("select count(*) from private.client_delivery_final_receipts"
                         ).fetchone()[0] == 0
        c.execute("update private.client_delivery_package_dispatch_config set "
                  "enabled=false,legacy_worker_off_verified=false where singleton")
    print("PASS package claims, exact expired-lease renewal race, untouched "
          "uncertain unrelated step and no synthetic final receipt")


if __name__ == "__main__":
    run()
