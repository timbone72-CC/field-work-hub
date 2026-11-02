"""Exact Phase 5D final-step failure fixture, disposable CI PostgreSQL only.
The real Google files, TEST package, database and original held permit are NEVER touched.
"""
import os
import uuid

import psycopg
from psycopg.types.json import Jsonb

from phase_5_package_dispatch_races import setup

DSN = os.environ["FWH_TEST_DATABASE_URL"]
PACKAGE = uuid.UUID("f42e05df-de7a-4d20-8dee-f55e09511d1f")
FOLDER = "196tHeV7eQB5DtKcpsBL1wWfrSg3C8z1_"
PHOTO = "1i9946peeZzZV6UsOduyy89HdGSr1VTnk"
MANIFEST = "13M3HTcYkZ6yHfN2TaX-2i15KkMMHJgWM"


def main():
    destination, (package, other) = setup(pinned_test_package=PACKAGE)
    assert package == PACKAGE
    worker, request, step, folder_plan = (uuid.uuid4() for _ in range(4))
    with psycopg.connect(DSN) as c:
        assert c.info.dbname == "fwh_test"
        assert c.info.host in ("localhost", "127.0.0.1", "::1")
        k = c.execute(
            "select organization_id,company_id,approved_sha256,approved_manifest"
            " from private.client_packages where id=%s", (PACKAGE,)
        ).fetchone()
        assert k
        org, company, sha, frozen = k
        photo_id = uuid.UUID(frozen["selected_photos"][0]["photo_id"])
        # The hosted TEST environment retains one protected legacy
        # singleton. Emulate ONLY that ledger fact in disposable CI, with
        # legacy cutover OFF during fixture insertion.
        c.execute("update private.client_delivery_package_dispatch_config"
                  " set enabled=false,legacy_worker_off_verified=false where singleton")
        c.execute("insert into private.client_delivery_dispatch_permit("
                  "singleton,request_id) values(true,%s) on conflict do nothing",
                  (uuid.uuid4(),))
        assert c.execute(
            "select count(*) from private.client_delivery_dispatch_permit"
        ).fetchone()[0] == 1
        c.execute("update private.client_delivery_package_dispatch_config"
                  " set enabled=true,legacy_worker_off_verified=true where singleton")
        c.execute("insert into private.client_delivery_package_dispatch_permits("
                  "package_id,organization_id,destination_id,worker_id,request_id,generation)"
                  " values(%s,%s,%s,%s,%s,1)",
                  (package, org, destination, worker, request))
        c.execute("update private.client_delivery_outbox set state='DELIVERING',"
                  " worker_id=%s,lease_generation=1,attempts=1,"
                  " lease_until=now()-interval '5 minutes'"
                  " where package_id=%s", (worker, package))
        c.execute("update private.client_packages set status='DELIVERING'"
                  " where id=%s", (package,))
        plans = [
            (folder_plan, "FOLDER", None, FOLDER, "CI_PARENT_FOLDER_123456",
             None, None, "application/vnd.google-apps.folder"),
            (uuid.uuid4(), "PHOTO", photo_id, PHOTO, FOLDER, "b" * 64, 279184, "image/jpeg"),
            (uuid.uuid4(), "MANIFEST", None, MANIFEST, FOLDER, sha, 1382, "application/json"),
        ]
        for item in plans:
            c.execute(
                "insert into private.client_delivery_file_plans("
                "id,package_id,kind,photo_id,drive_file_id,drive_parent_id,"
                "expected_sha256,expected_size,mime_type,state,verified_at,remote_evidence)"
                " values(%s,%s,%s,%s,%s,%s,%s,%s,%s,'VERIFIED',now(),%s)",
                (item[0], package, *item[1:], Jsonb({"synthetic": True})),
            )
        c.execute("insert into private.client_delivery_package_folder_attempts("
                  "file_plan_id,package_id,attempted_at,verified_at,remote_evidence)"
                  " values(%s,%s,now(),now(),%s)",
                  (folder_plan, package, Jsonb({"synthetic": True})))
        for n in range(6):
            c.execute(
                "insert into private.client_delivery_package_step_attempts("
                "step_id,package_id,worker_id,request_id,generation,verified_at,verified_outcome)"
                " values(%s,%s,%s,%s,1,now(),%s)",
                (uuid.uuid4(), package, worker, request,
                 "VERIFIED_METADATA_STEP" if n == 0 else "VERIFIED_PROVIDER_STEP"),
            )
        c.execute(
            "insert into private.client_delivery_package_step_attempts("
            "step_id,package_id,worker_id,request_id,generation,started_at)"
            " values(%s,%s,%s,%s,1,'2026-11-02 15:14:50+00'::timestamptz)",
            (step, package, worker, request),
        )
        # A genuine TEST control snapshot starts with its exact cutover gate OFF.
        c.execute("update private.client_delivery_package_dispatch_config"
                  " set enabled=false,legacy_worker_off_verified=true"
                  " where singleton")
    with psycopg.connect(DSN) as c:
        before = c.execute(
            "select state,worker_id,lease_generation,attempts"
            " from private.client_delivery_outbox where package_id=%s", (package,)
        ).fetchone()
        old_count = c.execute(
            "select count(*) from private.client_delivery_dispatch_permit"
        ).fetchone()[0]
        file_count = c.execute(
            "select count(*) from private.client_delivery_file_plans where package_id=%s",
            (package,),
        ).fetchone()[0]
        try:
            c.execute("select private.service_reconcile_exact_failed_final_step(%s,%s)",
                      (other, step))
        except psycopg.errors.InsufficientPrivilege:
            c.rollback()
        else:
            raise AssertionError("Wrong package must be denied")
        try:
            c.execute("select private.service_reconcile_exact_failed_final_step(%s,%s)",
                      (package, uuid.uuid4()))
        except psycopg.errors.InsufficientPrivilege:
            c.rollback()
        else:
            raise AssertionError("Wrong unfinished step must be denied")
        # Gate ON must deny remediation, without touching the pending marker.
        c.execute("savepoint gate_on_denial")
        c.execute("update private.client_delivery_package_dispatch_config"
                  " set enabled=true where singleton")
        try:
            c.execute("select private.service_reconcile_exact_failed_final_step(%s,%s)",
                      (package, step))
        except psycopg.errors.InsufficientPrivilege:
            c.execute("rollback to savepoint gate_on_denial")
        else:
            raise AssertionError("Gate ON permitted recovery")
        c.execute("release savepoint gate_on_denial")
        # Even in the exact owner scope, a pre-existing final receipt
        # must fail closed; the synthetic row is entirely rolled back.
        c.execute("savepoint receipt_denial")
        c.execute("insert into private.client_delivery_final_receipts("
                  "package_id,approved_sha256,destination_id,drive_folder_id,files)"
                  " values(%s,%s,%s,%s,%s)",
                  (package, sha, destination, FOLDER, Jsonb([])))
        try:
            c.execute("select private.service_reconcile_exact_failed_final_step(%s,%s)",
                      (package, step))
        except psycopg.errors.InsufficientPrivilege:
            c.execute("rollback to savepoint receipt_denial")
        else:
            raise AssertionError("Existing final receipt permitted recovery")
        c.execute("release savepoint receipt_denial")
        # CI-only visibility into every major guard boundary. All values are
        # booleans/fixture counts, never credentials or actual provider data.
        check = c.execute("""
          select
            cfg.enabled=false as gate_off,
            cfg.legacy_worker_off_verified as legacy_off,
            cfg.max_in_flight=2 as cap_two,
            k.status='DELIVERING' as package_delivering,
            o.state='DELIVERING' as outbox_delivering,
            o.attempts=1 as attempt_one,
            o.lease_generation=1 as generation_one,
            o.lease_until<clock_timestamp() as expired,
            o.worker_id=h.worker_id as worker_match,
            o.destination_id=h.destination_id as dest_match,
            k.destination_id=d.id as package_dest_match,
            k.organization_id=h.organization_id as org_match,
            k.organization_id=d.organization_id as dest_org_match,
            k.company_id=d.company_id as company_match,
            d.active and d.verified as dest_ready,
            d.root_folder_id='1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK' as exact_root,
            k.approved_manifest->>'package_id'=k.id::text as manifest_package,
            k.approved_manifest->>'destination_id'=d.id::text as manifest_dest,
            k.approved_manifest->>'destination_root'=d.root_folder_id as manifest_root,
            k.approved_manifest->>'destination_revision'=d.revision::text as manifest_rev,
            k.approved_manifest->>'folder_layout'='ADDRESS_WORK_ORDER' as layout,
            jsonb_array_length(k.approved_manifest->'selected_photos')=1 as one_photo,
            o.approved_sha256=k.approved_sha256 as outbox_hash,
            k.approved_sha256=encode(sha256(convert_to(k.approved_manifest::text,'UTF8')),'hex') as frozen_hash,
            s.worker_id=h.worker_id and s.request_id=h.request_id and s.generation=h.generation as step_owner,
            s.verified_at is null and s.verified_outcome is null as still_pending,
            s.started_at between '2026-11-02 15:12+00'::timestamptz and '2026-11-02 15:15+00'::timestamptz as failure_window,
            (select count(*) from private.client_delivery_dispatch_permit)=1 as original_one,
            (select count(*) from private.client_delivery_package_dispatch_permits)=1 as scoped_one,
            (select count(*) from private.client_delivery_package_step_attempts where package_id=k.id and verified_at is null)=1 as one_pending,
            (select count(*) from private.client_delivery_package_step_attempts where package_id=k.id and verified_outcome='VERIFIED_PROVIDER_STEP')=5 as provider_five,
            (select count(*) from private.client_delivery_package_step_attempts where package_id=k.id and verified_outcome='VERIFIED_METADATA_STEP')=1 as metadata_one,
            (select count(*) from private.client_delivery_package_step_attempts where package_id=k.id)=7 as seven_total,
            (select count(*) from private.client_delivery_final_receipts where package_id=k.id)=0 as no_final
          from private.client_packages k
          join private.client_delivery_outbox o on o.package_id=k.id
          join private.client_delivery_package_dispatch_permits h on h.package_id=k.id
          join private.client_delivery_destinations d on d.id=k.destination_id
          join private.client_delivery_package_step_attempts s on s.package_id=k.id and s.step_id=%s
          cross join private.client_delivery_package_dispatch_config cfg
          where k.id=%s
        """, (step, package))
        checks = check.fetchone()
        statuses = dict(zip([desc.name for desc in check.description], checks))
        assert all(value is True for value in statuses.values()), statuses
        response = c.execute(
            "select private.service_reconcile_exact_failed_final_step(%s,%s)",
            (package, step),
        ).fetchone()[0]
        assert response["reconciled"] is True and response["delivered"] is False
        assert response["step_id"] == str(step)
        row = c.execute(
            "select verified_at,verified_outcome from private.client_delivery_package_step_attempts"
            " where step_id=%s", (step,)
        ).fetchone()
        assert row[0] is not None and row[1] == "RECONCILED_FAILED_FINAL_NO_RECEIPT"
        audit = c.execute(
            "select worker_id,request_id,generation,failure_code,source_final_receipt_count"
            " from private.client_delivery_failed_final_step_reconciliations where step_id=%s",
            (step,),
        ).fetchone()
        assert audit == (worker, request, 1, "FROZEN_PACKAGE_DELIVERY_OWNER_MISMATCH", 0)
        assert c.execute(
            "select count(*) from private.client_delivery_final_receipts where package_id=%s",
            (package,),
        ).fetchone()[0] == 0
        assert c.execute(
            "select count(*) from private.client_delivery_file_plans where package_id=%s",
            (package,),
        ).fetchone()[0] == file_count == 3
        assert c.execute(
            "select state,worker_id,lease_generation,attempts"
            " from private.client_delivery_outbox where package_id=%s", (package,)
        ).fetchone() == before
        assert c.execute(
            "select count(*) from private.client_delivery_dispatch_permit"
        ).fetchone()[0] == old_count
        assert c.execute(
            "select status from private.client_packages where id=%s", (package,)
        ).fetchone()[0] == "DELIVERING"
        c.execute("savepoint duplicate_recovery")
        try:
            c.execute("select private.service_reconcile_exact_failed_final_step(%s,%s)",
                      (package, step))
        except psycopg.errors.InsufficientPrivilege:
            c.execute("rollback to savepoint duplicate_recovery")
        else:
            raise AssertionError("Second recovery must be denied")
        c.execute("release savepoint duplicate_recovery")
        assert c.execute(
            "select count(*) from private.client_delivery_failed_final_step_reconciliations"
            " where package_id=%s", (package,)
        ).fetchone()[0] == 1
    print("PASS: exact failed final marker reconciled as NOT DELIVERED,"
          " immutable audit retained, duplicate denied, same owner/files/permit")


if __name__ == "__main__":
    main()
