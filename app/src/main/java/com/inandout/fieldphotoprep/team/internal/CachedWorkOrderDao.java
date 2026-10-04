package com.inandout.fieldphotoprep.team.internal;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Transaction;

import java.util.List;

@Dao
abstract class CachedWorkOrderDao {
    @Query(
            "SELECT * FROM cached_work_orders WHERE cache_owner_user_id = :cacheOwnerUserId AND"
                + " organization_id = :organizationId ORDER BY due_date ASC, wo_number ASC")
    abstract List<CachedWorkOrder> listForOwner(String cacheOwnerUserId, String organizationId);

    @Query(
            "DELETE FROM cached_work_orders WHERE cache_owner_user_id = :cacheOwnerUserId AND"
                + " organization_id = :organizationId")
    abstract void deleteForOwner(String cacheOwnerUserId, String organizationId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract void insertAll(List<CachedWorkOrder> rows);

    @Query(
            "SELECT * FROM cached_work_orders WHERE cache_owner_user_id=:owner AND"
                + " organization_id=:org AND work_order_id=:wo AND run_id=:run")
    abstract CachedWorkOrder find(String owner, String org, String wo, String run);

    @Query(
            "DELETE FROM cached_work_orders WHERE cache_owner_user_id=:owner AND"
                + " organization_id=:org AND work_order_id=:wo AND run_id=:run")
    abstract void delete(String owner, String org, String wo, String run);

    @Query(
            "SELECT * FROM field_actions WHERE ownerId=:owner AND organizationId=:org ORDER BY"
                + " sequence")
    abstract List<FieldAction> actions(String owner, String org);

    @Query("SELECT * FROM field_actions WHERE actionId=:id")
    abstract FieldAction action(String id);

    @Query("SELECT coalesce(max(sequence),0)+1 FROM field_actions")
    abstract long nextSequence();

    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract void insertAction(FieldAction action);

    @androidx.room.Update
    abstract void updateAction(FieldAction action);

    @Query(
            "UPDATE field_actions SET state='PENDING',claimId='',reason='INTERRUPTED' WHERE"
                + " ownerId=:owner AND organizationId=:org AND state='SYNCING'")
    abstract void recoverClaims(String owner, String org);

    @Query(
            "UPDATE cached_work_orders SET conflict_reason=:reason WHERE cache_owner_user_id=:owner"
                + " AND organization_id=:org AND work_order_id=:wo AND run_id=:run")
    abstract void conflictCache(String owner, String org, String wo, String run, String reason);

    @Query(
            "UPDATE cached_work_orders SET"
                + " field_status=:status,started_at=:started,field_completed_at=:completed,server_updated_at=:updated"
                + " WHERE cache_owner_user_id=:owner AND organization_id=:org AND work_order_id=:wo"
                + " AND run_id=:run AND assignment_instance_id=:instance")
    abstract void canonicalCache(
            String owner,
            String org,
            String wo,
            String run,
            String instance,
            String status,
            String started,
            String completed,
            String updated);

    boolean hasEvidence(CachedWorkOrder row, List<FieldAction> actions) {
        if (!row.startedAt.isEmpty()) return true;
        return hasLocalActions(row, actions) || !photos(row.cacheOwnerUserId, row.organizationId, row.workOrderId, row.runId).isEmpty();
    }

    private boolean hasLocalActions(CachedWorkOrder row, List<FieldAction> actions) {
        for (FieldAction a : actions)
            if (a.workOrderId.equals(row.workOrderId) && a.runId.equals(row.runId)) return true;
        return false;
    }

    @Transaction
    void replaceForOwner(String owner, String org, List<CachedWorkOrder> downloaded) {
        List<FieldAction> actions = actions(owner, org);
        List<CachedWorkOrder> existing = listForOwner(owner, org);
        java.util.Set<String> protectedWos = new java.util.HashSet<>();
        for (CachedWorkOrder old : existing) {
            CachedWorkOrder next = null;
            for (CachedWorkOrder row : downloaded)
                if (row.workOrderId.equals(old.workOrderId)) {
                    next = row;
                    break;
                }
            boolean evidence = hasEvidence(old, actions);
            if (next == null
                    || !next.runId.equals(old.runId)
                    || (evidence
                            && (!old.assignmentInstanceId.isEmpty() || hasLocalActions(old, actions))
                            && !next.assignmentInstanceId.equals(old.assignmentInstanceId))
                    || (evidence && "CANCELLED".equals(next.fieldStatus))) {
                if (evidence) {
                    markRunConflict(
                            owner, org, old.workOrderId, old.runId, "ASSIGNMENT_UNAVAILABLE");
                    protectedWos.add(old.workOrderId);
                } else delete(owner, org, old.workOrderId, old.runId);
            } else if (evidence && !sameRequirements(old.requirementSnapshotJson, next.requirementSnapshotJson)) {
                markRunConflict(owner, org, old.workOrderId, old.runId, "REQUIREMENTS_CHANGED");
                protectedWos.add(old.workOrderId);
            } else if (!old.conflictReason.isEmpty()) {
                protectedWos.add(old.workOrderId);
            } else if (evidence && isOlder(next.serverUpdatedAt, old.serverUpdatedAt)) {
                protectedWos.add(old.workOrderId);
            } else if (evidence && statusRank(next.fieldStatus) < statusRank(old.fieldStatus)) {
                markRunConflict(owner, org, old.workOrderId, old.runId, "STATE_CHANGED");
                protectedWos.add(old.workOrderId);
            }
        }
        for (CachedWorkOrder row : downloaded)
            if (!protectedWos.contains(row.workOrderId))
                insertAll(java.util.Collections.singletonList(row));
    }

    static boolean sameRequirements(String a, String b) {
        try { return new org.json.JSONObject(a).toString().equals(new org.json.JSONObject(b).toString())
                || (PhotoRequirements.parse(a).revision.equals(PhotoRequirements.parse(b).revision)
                && canonicalJson(new org.json.JSONObject(a)).equals(canonicalJson(new org.json.JSONObject(b)))); }
        catch(Exception e) { return false; }
    }

    private static String canonicalJson(Object value) throws org.json.JSONException {
        if (value instanceof org.json.JSONObject) {
            org.json.JSONObject j=(org.json.JSONObject)value; java.util.List<String> keys=new java.util.ArrayList<>();
            java.util.Iterator<String> iterator=j.keys(); while(iterator.hasNext()) keys.add(iterator.next());
            java.util.Collections.sort(keys); StringBuilder b=new StringBuilder("{");
            for(String key:keys) b.append(org.json.JSONObject.quote(key)).append(":").append(canonicalJson(j.get(key))).append(",");
            return b.append("}").toString();
        }
        if(value instanceof org.json.JSONArray) { org.json.JSONArray a=(org.json.JSONArray)value; StringBuilder b=new StringBuilder("[");
            for(int i=0;i<a.length();i++) b.append(canonicalJson(a.get(i))).append(","); return b.append("]").toString(); }
        return value instanceof String ? org.json.JSONObject.quote((String)value) : String.valueOf(value);
    }

    static boolean isOlder(String incoming, String current) {
        try {
            return java.time.Instant.parse(incoming).isBefore(java.time.Instant.parse(current));
        } catch (Exception e) {
            return !current.isEmpty();
        }
    }

    static int statusRank(String status) {
        return "FIELD_COMPLETE".equals(status) ? 2 : "IN_PROGRESS".equals(status) ? 1 : 0;
    }

    @Transaction
    void markRunConflict(String owner, String org, String wo, String run, String reason) {
        conflictCache(owner, org, wo, run, reason);
        for (FieldAction a : actions(owner, org))
            if (a.workOrderId.equals(wo) && a.runId.equals(run) && !"ACCEPTED".equals(a.state)) {
                a.state = "CONFLICT";
                a.reason = reason;
                a.claimId = "";
                updateAction(a);
            }
    }

    @Transaction
    FieldAction createAction(
            SupabaseApi.AuthSession session, String wo, String run, String kind, String eventTime) {
        CachedWorkOrder row = find(session.userId, session.organizationId, wo, run);
        if (row == null
                || !"CONTRACTOR".equals(session.role)
                || !row.assignedUserId.equals(session.userId)
                || row.assignmentInstanceId.isEmpty()
                || !row.conflictReason.isEmpty())
            throw new IllegalStateException(
                    "Refresh Assignments online before starting this work, or contact Admin if it"
                        + " needs review.");
        PhotoRequirements requirements = PhotoRequirements.parse(row.requirementSnapshotJson);
        java.time.Instant event = java.time.Instant.parse(eventTime);
        FieldAction start = null;
        for (FieldAction a : actions(session.userId, session.organizationId))
            if (a.workOrderId.equals(wo) && a.runId.equals(run)) {
                if ("CONFLICT".equals(a.state) || a.reason.startsWith("PROTOCOL"))
                    throw new IllegalStateException("Saved progress needs review. Contact Admin.");
                if (a.assignmentInstanceId.equals(row.assignmentInstanceId) && a.kind.equals(kind))
                    return a;
                if (a.kind.equals("START")) start = a;
            }
        if ("START".equals(kind)) {
            if (!"ASSIGNED".equals(row.fieldStatus))
                throw new IllegalStateException("This work cannot be started.");
        } else if ("COMPLETE".equals(kind)) {
            if (!"IN_PROGRESS".equals(row.fieldStatus) && start == null)
                throw new IllegalStateException("Start Work first.");
            String started = !row.startedAt.isEmpty() ? row.startedAt : start.eventTime;
            if (event.isBefore(java.time.Instant.parse(started)))
                throw new IllegalStateException(
                        "Phone time is earlier than the saved start. Correct the phone time before"
                            + " finishing.");
        } else throw new IllegalArgumentException("Unknown action");
        FieldAction a =
                new FieldAction(
                        java.util.UUID.randomUUID().toString(),
                        session.userId,
                        session.organizationId,
                        wo,
                        run,
                        row.assignmentInstanceId,
                        kind,
                        eventTime,
                        System.currentTimeMillis(),
                        nextSequence());
        a.requirementRevision = requirements.revision;
        if ("COMPLETE".equals(kind)) freezePhotos(row, requirements, a);
        insertAction(a);
        return a;
    }

    @Query("SELECT * FROM protected_photos WHERE ownerId=:owner AND organizationId=:org AND workOrderId=:wo AND runId=:run ORDER BY id")
    abstract List<ProtectedPhoto> photos(String owner, String org, String wo, String run);
    @Query("SELECT * FROM protected_photos ORDER BY id") abstract List<ProtectedPhoto> allPhotos();
    @Query("SELECT * FROM protected_photos WHERE id=:id") abstract ProtectedPhoto photo(String id);
    @Insert(onConflict=OnConflictStrategy.ABORT) abstract void insertPhoto(ProtectedPhoto p);
    @Query("UPDATE protected_photos SET state=:state,originalBytes=:bytes,problem=:problem WHERE id=:id AND state='CAPTURING'")
    abstract void publishCapture(String id,String state,long bytes,String problem);
    @Query("UPDATE protected_photos SET prepared=:prepared,problem=:problem WHERE id=:id AND state='WAITING'")
    abstract void photoPrepared(String id,boolean prepared,String problem);
    @Query("UPDATE protected_photos SET state='PROBLEM',problem=:problem WHERE id=:id AND state IN ('WAITING','CAPTURING')")
    abstract void photoProblem(String id,String problem);
    @Query("UPDATE protected_photos SET state='DISCARDING' WHERE id=:id AND finishSetId=''")
    abstract void discardPhoto(String id);
    @Query("UPDATE protected_photos SET state='DISCARDED',prepared=0,problem='' WHERE id=:id AND state='DISCARDING'")
    abstract void completeDiscard(String id);
    @Query("UPDATE protected_photos SET finishSetId=:setId WHERE id=:id AND finishSetId=''")
    abstract void freezePhoto(String id,String setId);

    private CachedWorkOrder captureRun(SupabaseApi.AuthSession session, String wo, String run) {
        CachedWorkOrder r=find(session.userId,session.organizationId,wo,run);
        if (r==null || !"CONTRACTOR".equals(session.role) || !r.assignedUserId.equals(session.userId)
                || r.assignmentInstanceId.isEmpty() || !r.conflictReason.isEmpty()
                || "FIELD_COMPLETE".equals(r.fieldStatus) || "CANCELLED".equals(r.fieldStatus))
            throw new IllegalStateException("This work is unavailable for capture. Contact Admin if it needs review.");
        boolean started=!r.startedAt.isEmpty();
        for (FieldAction a:actions(session.userId,session.organizationId)) if(a.workOrderId.equals(wo)&&a.runId.equals(run)) {
            if("COMPLETE".equals(a.kind)) throw new IllegalStateException("Finish has frozen these photos.");
            if("CONFLICT".equals(a.state)||a.reason.startsWith("PROTOCOL")) throw new IllegalStateException("Saved progress needs review.");
            if("START".equals(a.kind)&&a.assignmentInstanceId.equals(r.assignmentInstanceId)) started=true;
        }
        if(!started) throw new IllegalStateException("Start Work first.");
        PhotoRequirements.parse(r.requirementSnapshotJson);
        return r;
    }

    @Transaction
    ProtectedPhoto reservePhoto(SupabaseApi.AuthSession session, String wo, String run, String item,
            String time, String id, String original, String prepared) {
        CachedWorkOrder r=captureRun(session,wo,run); PhotoRequirements req=PhotoRequirements.parse(r.requirementSnapshotJson);
        if(!item.isEmpty() && req.enabledItem(item)==null) throw new IllegalStateException("Choose an enabled photo item or Extra.");
        for(ProtectedPhoto p:photos(session.userId,session.organizationId,wo,run))
            if("CAPTURING".equals(p.state)) throw new IllegalStateException("Wait for the current photo to save.");
        if (photos(session.userId,session.organizationId,wo,run).stream().filter(p -> !"DISCARDED".equals(p.state)).count()>=5000)
            throw new IllegalStateException("This run has reached the 5000 photo limit.");
        ProtectedPhoto p=new ProtectedPhoto(id,session.userId,session.organizationId,wo,run,r.assignmentInstanceId,
                req.revision,item,time,original,prepared);
        insertPhoto(p); return p;
    }

    @Transaction
    void finalizePhoto(String id, boolean valid, long bytes, String problem) {
        ProtectedPhoto p=photo(id); if(p==null || !"CAPTURING".equals(p.state)) return;
        publishCapture(id,valid?"WAITING":(bytes==0?"DISCARDED":"PROBLEM"),bytes,problem);
    }

    @Transaction
    ProtectedPhoto beginDiscard(SupabaseApi.AuthSession session, String id) {
        ProtectedPhoto p=photo(id);
        if(p==null || !p.ownerId.equals(session.userId)||!p.organizationId.equals(session.organizationId)) throw new IllegalStateException("Photo unavailable.");
        captureRun(session,p.workOrderId,p.runId);
        if(!p.finishSetId.isEmpty()||"CAPTURING".equals(p.state)||"DISCARDED".equals(p.state)) throw new IllegalStateException("Photo cannot be discarded.");
        discardPhoto(p.id); p.state="DISCARDING"; return p;
    }

    private void freezePhotos(CachedWorkOrder r, PhotoRequirements req, FieldAction a) {
        java.util.List<ProtectedPhoto> valid=new java.util.ArrayList<>();
        for(ProtectedPhoto p:photos(r.cacheOwnerUserId,r.organizationId,r.workOrderId,r.runId)) {
            if("DISCARDED".equals(p.state)) continue;
            if(!p.assignmentInstanceId.equals(r.assignmentInstanceId)||!p.requirementRevision.equals(req.revision)
                    ||!p.finishSetId.isEmpty()||!p.readable()) throw new IllegalStateException("A photo is still saving or needs recovery. Finish is paused.");
            if(java.time.Instant.parse(p.capturedAt).isAfter(java.time.Instant.parse(a.eventTime)))
                throw new IllegalStateException("Phone time is earlier than a saved photo. Correct it before Finish.");
            valid.add(p);
        }
        String missing=req.missing(valid); if(!missing.isEmpty()) throw new IllegalStateException("More photos needed:\n"+missing);
        if(!req.configured && valid.isEmpty()) return; // Legacy Phase 3 intent stays unchanged.
        a.finishSetId=java.util.UUID.randomUUID().toString(); org.json.JSONArray set=new org.json.JSONArray();
        try { for(ProtectedPhoto p:valid) {
            set.put(new org.json.JSONObject().put("id",p.id).put("item_id",p.itemId.isEmpty()?org.json.JSONObject.NULL:p.itemId).put("captured_at",p.capturedAt));
            freezePhoto(p.id,a.finishSetId);
        } } catch(org.json.JSONException e) { throw new IllegalStateException(e); }
        a.finishPhotosJson=set.toString();
        a.finishDigest=PhotoOwner.digest(a.finishPhotosJson);
    }

    @Transaction
    FieldAction claim(String id, String claim, long generation) {
        FieldAction a = action(id);
        if (a == null || !"PENDING".equals(a.state)) return null;
        a.state = "SYNCING";
        a.claimId = claim;
        a.claimGeneration = generation;
        a.attempts++;
        updateAction(a);
        return a;
    }

    @Transaction
    void accept(String id, String claim, long generation, FieldActionResult result) {
        FieldAction a = action(id);
        if (a == null
                || !a.claimId.equals(claim)
                || a.claimGeneration != generation
                || !"SYNCING".equals(a.state)) return;
        if (result.conflict) {
            markRunConflict(a.ownerId, a.organizationId, a.workOrderId, a.runId, result.reason);
            return;
        }
        a.state = "ACCEPTED";
        a.claimId = "";
        a.reason = "";
        a.canonicalStatus = result.status;
        a.canonicalStartedAt = result.startedAt;
        a.canonicalCompletedAt = result.completedAt;
        a.serverUpdatedAt = result.updatedAt;
        a.acceptedAt = result.acceptedAt;
        updateAction(a);
        canonicalCache(
                a.ownerId,
                a.organizationId,
                a.workOrderId,
                a.runId,
                a.assignmentInstanceId,
                result.status,
                result.startedAt,
                result.completedAt,
                result.updatedAt);
    }

    void release(String id, String claim, String reason) {
        release(id, claim, reason, 0);
    }

    @Transaction
    void release(String id, String claim, String reason, long retryNotBefore) {
        FieldAction a = action(id);
        if (a != null && a.claimId.equals(claim) && "SYNCING".equals(a.state)) {
            a.state = "PENDING";
            a.claimId = "";
            a.reason = reason;
            a.retryNotBefore = retryNotBefore;
            updateAction(a);
        }
    }
}
