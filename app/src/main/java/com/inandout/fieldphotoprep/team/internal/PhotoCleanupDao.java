package com.inandout.fieldphotoprep.team.internal;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Transaction;
import org.json.JSONObject;
import java.util.UUID;
import java.util.List;
import org.json.JSONArray;

/** Durable local cleanup decisions. Never deletes bytes; PhotoOwner is the sole file owner. */
@Dao
abstract class PhotoCleanupDao {
    /**
     * Stable keyset scan for an original owner's privately received photos.
     * Exclude every existing cleanup journal: periodic discovery must never
     * refresh an immutable HELD proof or act on READY/CLEANING evidence.
     */
    @Query("SELECT p.id FROM protected_photos p " +
           "JOIN photo_transfers t ON t.photoId=p.id " +
           "LEFT JOIN photo_cleanup_journal j ON j.photoId=p.id " +
           "WHERE p.ownerId=:owner AND p.organizationId=:org " +
           "AND t.ownerId=:owner AND t.organizationId=:org " +
           "AND p.state='WAITING' AND t.state='RECEIVED' " +
           "AND t.receiptId<>'' AND t.receiptSavedAt>0 " +
           "AND j.photoId IS NULL AND p.id>:after " +
           "ORDER BY p.id LIMIT :limit")
    abstract List<String> readinessCandidates(String owner, String org, String after, int limit);

    @Query("SELECT * FROM photo_cleanup_journal WHERE photoId=:id")
    abstract PhotoCleanupJournal find(String id);
    @Query("SELECT * FROM protected_photos WHERE id=:id")
    abstract ProtectedPhoto photo(String id);
    @Query("SELECT * FROM photo_transfers WHERE photoId=:id")
    abstract PhotoTransfer transfer(String id);
    @Query("SELECT * FROM field_actions WHERE actionId=:id")
    abstract FieldAction action(String id);
    @Insert(onConflict=OnConflictStrategy.ABORT)
    abstract void insert(PhotoCleanupJournal row);
    @Query("SELECT * FROM field_actions WHERE ownerId=:owner AND organizationId=:org AND workOrderId=:wo")
    abstract List<FieldAction> workActions(String owner,String org,String wo);
    @Query("SELECT * FROM protected_photos WHERE ownerId=:owner AND organizationId=:org AND workOrderId=:wo")
    abstract List<ProtectedPhoto> workPhotos(String owner,String org,String wo);
    @Query("SELECT * FROM cached_work_orders WHERE cache_owner_user_id=:owner AND organization_id=:org AND work_order_id=:wo")
    abstract List<CachedWorkOrder> workCaches(String owner,String org,String wo);
    @Query("SELECT * FROM photo_cleanup_journal WHERE ownerId=:owner AND organizationId=:org AND state IN ('READY','CLEANING') ORDER BY recordedAt,photoId")
    abstract List<PhotoCleanupJournal> pending(String owner,String org);
    @Query("UPDATE photo_cleanup_journal SET state=:next WHERE photoId=:id AND ownerId=:owner AND organizationId=:org AND state=:expected")
    abstract int changeJournal(String id,String owner,String org,String expected,String next);
    @Query("UPDATE protected_photos SET state=:next WHERE id=:id AND ownerId=:owner AND organizationId=:org AND state=:expected")
    abstract int changePhoto(String id,String owner,String org,String expected,String next);
    @Query("UPDATE protected_photos SET prepared=0,problem='' WHERE id=:id AND ownerId=:owner AND organizationId=:org AND state='CLEANED'")
    abstract int finishPhotoMetadata(String id,String owner,String org);

    /** Preserve the exact final-delivery snapshot; does not enable cleanup. */
    @Transaction
    void recordVerifiedReadiness(String owner,String org,String id,String response) {
        if(owner==null||org==null||id==null||response==null)
            throw new IllegalArgumentException("Exact photo identity required");
        JSONObject proof;
        try { proof=new JSONObject(response); }
        catch(org.json.JSONException e) {
            throw new IllegalArgumentException("Malformed server readiness proof",e);
        }
        ProtectedPhoto p=photo(id);
        PhotoCleanupJournal previous=find(id);
        // An interrupted CLEANING photo no longer has state WAITING.
        // Only a previously durable matching CLEANING intent may refresh its
        // server authorization; never manufacture a cleanup state from scratch.
        boolean interrupted=previous!=null && "CLEANING".equals(previous.state);
        PhotoTransfer t=transfer(id);
        FieldAction a=t==null?null:action(t.finishActionId);
        if(p==null||t==null||a==null
            ||!owner.equals(p.ownerId)||!org.equals(p.organizationId)
            ||!t.matches(p,a)
            ||!(("WAITING".equals(p.state)&&!interrupted)
                ||("CLEANING".equals(p.state)&&interrupted))
            ||!"RECEIVED".equals(t.state)||t.receiptId.isEmpty()
            ||t.receiptSavedAt<=0||!"COMPLETE".equals(a.kind)
            ||!"ACCEPTED".equals(a.state)
            ||a.finishDigest.isEmpty()
            ||proof.optBoolean("eligible",false)!=true
            ||!proof.optBoolean("server_readiness_only",false)
            ||!proof.optBoolean("private_receipt_verified",false)
            ||!proof.optBoolean("retained_privately",false)
            ||!id.equals(proof.optString("photo_id"))
            ||!p.runId.equals(proof.optString("run_id"))
            ||!p.finishSetId.equals(proof.optString("finish_set_id"))
            ||!a.finishDigest.equals(proof.optString("finish_digest"))
            ||!t.transferVersion.equals(proof.optString("transfer_version")))
            throw new IllegalStateException("Exact final receipt and accepted local Finish required");
        String packageId=proof.optString("package_id","");
        try { if(!UUID.fromString(packageId).toString().equals(packageId))
             throw new IllegalStateException("Invalid package identity"); }
        catch(IllegalArgumentException ex) {
            throw new IllegalStateException("Invalid package identity",ex);
        }
        PhotoCleanupJournal old=previous;
        if(old!=null) {
            if(!old.ownerId.equals(owner)||!old.organizationId.equals(org)
              ||!old.packageId.equals(packageId)||!old.transferVersion.equals(t.transferVersion)
              ||!old.finishDigest.equals(a.finishDigest)
              ||!(("CLEANING".equals(old.state)&&"CLEANING".equals(p.state))
                 ||(!"CLEANING".equals(old.state)&&"WAITING".equals(p.state)))
              ||!old.serverProofJson.equals(response))
                throw new IllegalStateException("Immutable cleanup evidence changed");
            return;
        }
        insert(new PhotoCleanupJournal(id,owner,org,p.workOrderId,p.runId,
              p.finishSetId,a.finishDigest,t.transferVersion,t.receiptId,
              packageId,response,System.currentTimeMillis()));
        // HELD is retained until an explicit enabled owner decision passes
        // the complete same-WO local safety gate. No file is touched here.
    }
    /** Re-evaluate the exact immutable server attestation before each local transition. */
    private static void requireServerSnapshot(PhotoCleanupJournal j) {
        try {
            JSONObject proof=new JSONObject(j.serverProofJson);
            if(!proof.optBoolean("eligible",false)
                ||!proof.optBoolean("server_readiness_only",false)
                ||!proof.optBoolean("private_receipt_verified",false)
                ||!proof.optBoolean("retained_privately",false)
                ||!proof.has("included_in_client_package")
                ||!j.photoId.equals(proof.optString("photo_id"))
                ||!j.runId.equals(proof.optString("run_id"))
                ||!j.finishSetId.equals(proof.optString("finish_set_id"))
                ||!j.finishDigest.equals(proof.optString("finish_digest"))
                ||!j.transferVersion.equals(proof.optString("transfer_version"))
                ||!j.packageId.equals(proof.optString("package_id")))
                throw new IllegalStateException("Exact server delivery/retention attestation missing");
        } catch(org.json.JSONException malformed) {
            throw new IllegalStateException("Server cleanup snapshot unreadable",malformed);
        }
    }

    /** Fail closed if ANY work on the same WO may still need stored originals. */
    private void safeWholeWorkOrder(PhotoCleanupJournal j,ProtectedPhoto target,
            boolean resuming) {
        String owner=j.ownerId,org=j.organizationId,wo=j.workOrderId;
        requireServerSnapshot(j);
        if(!owner.equals(target.ownerId)||!org.equals(target.organizationId)
                ||!wo.equals(target.workOrderId)||!j.runId.equals(target.runId)
                ||!j.finishSetId.equals(target.finishSetId)||j.finishDigest.isEmpty()
                ||!target.id.equals(j.photoId)||!target.state.equals(resuming?"CLEANING":"WAITING"))
            throw new IllegalStateException("Original capture identity changed; cleanup held");
        PhotoTransfer current=transfer(j.photoId);
        FieldAction finish=current==null?null:action(current.finishActionId);
        if(!verifiedReceipt(target,current,finish)
                ||!current.transferVersion.equals(j.transferVersion)
                ||!current.receiptId.equals(j.privateReceiptId)
                ||!finish.finishDigest.equals(j.finishDigest)
                ||!PhotoOwner.digest(finish.finishPhotosJson).equals(finish.finishDigest)
                ||!"COMPLETE".equals(finish.kind)
                ||!"FIELD_COMPLETE".equals(finish.canonicalStatus))
            throw new IllegalStateException("Private receipt/accepted Finish changed; cleanup held");
        for(CachedWorkOrder c:workCaches(owner,org,wo))
            if(!c.conflictReason.isEmpty()||!c.pendingAssigneeUserId.isEmpty())
                throw new IllegalStateException("Assignment conflict/handoff needs recovery");
        for(FieldAction a:workActions(owner,org,wo)) {
            if(!"ACCEPTED".equals(a.state)||a.reason.startsWith("PROTOCOL")
                ||"CONFLICT".equals(a.state))
                throw new IllegalStateException("Offline field action still unresolved");
            if("COMPLETE".equals(a.kind) && !a.finishSetId.isEmpty()) {
                if(!PhotoOwner.digest(a.finishPhotosJson).equals(a.finishDigest))
                    throw new IllegalStateException("Frozen Finish metadata changed");
                // A frozen photo not present locally still needs recovery.
                try {
                    JSONArray manifest=new JSONArray(a.finishPhotosJson);
                    for(int n=0;n<manifest.length();n++) {
                        String photoId=manifest.getJSONObject(n).getString("id");
                        ProtectedPhoto p=photo(photoId);
                        if(p==null||!owner.equals(p.ownerId)||!org.equals(p.organizationId)
                                ||!wo.equals(p.workOrderId)||!a.runId.equals(p.runId)
                                ||!a.finishSetId.equals(p.finishSetId))
                            throw new IllegalStateException("Unresolved frozen photo evidence");
                    }
                } catch(org.json.JSONException problem) {
                    throw new IllegalStateException("Frozen Finish unreadable",problem);
                }
            }
        }
        for(ProtectedPhoto p:workPhotos(owner,org,wo)) {
            if("DISCARDED".equals(p.state)) continue;
            if("CLEANED".equals(p.state)) {
                PhotoCleanupJournal closed=find(p.id);
                if(closed==null||!"CLEANED".equals(closed.state))
                    throw new IllegalStateException("Prior photo closure needs reconciliation");
                continue;
            }
            if(resuming && p.id.equals(target.id) && "CLEANING".equals(p.state)) continue;
            if(!"WAITING".equals(p.state))
                throw new IllegalStateException("Another captured photo needs recovery");
            PhotoTransfer transfer=transfer(p.id);
            FieldAction accepted=transfer==null?null:action(transfer.finishActionId);
            if(!verifiedReceipt(p,transfer,accepted))
                throw new IllegalStateException("Other photo private retention is not verified");
            if(!j.runId.equals(p.runId)) {
                // A separately accepted correction/other run cannot borrow
                // this run's client-delivery proof. All its originals remain
                // protected until that distinct run is also closed.
                PhotoCleanupJournal other=find(p.id);
                if(other==null||!owner.equals(other.ownerId)||!org.equals(other.organizationId)
                    ||!p.runId.equals(other.runId)||!p.finishSetId.equals(other.finishSetId))
                    throw new IllegalStateException("Different run has no final delivery closure");
                requireServerSnapshot(other);
            }
        }
    }

    private static boolean verifiedReceipt(ProtectedPhoto p,PhotoTransfer t,FieldAction a) {
        return p!=null&&t!=null&&a!=null&&t.matches(p,a)
                &&"RECEIVED".equals(t.state)&&!t.receiptId.isEmpty()
                &&t.receiptSavedAt>0&&!t.transferVersion.isEmpty()
                &&"ACCEPTED".equals(a.state)&&!a.acceptedAt.isEmpty()
                &&"COMPLETE".equals(a.kind)&&"FIELD_COMPLETE".equals(a.canonicalStatus)
                &&!a.finishDigest.isEmpty();
    }

    /** Durable HELD → READY, no file mutation. */
    @Transaction
    void arm(String owner,String org,String id) {
        PhotoCleanupJournal j=find(id);
        if(j==null||!owner.equals(j.ownerId)||!org.equals(j.organizationId)
                ||!"HELD".equals(j.state))
            throw new IllegalStateException("Original owner readiness not journaled");
        safeWholeWorkOrder(j,photo(id),false);
        if(changeJournal(id,owner,org,"HELD","READY")!=1)
            throw new IllegalStateException("Cleanup readiness changed");
    }

    /**
     * Durable READY → CLEANING plus protected-photo state, one transaction.
     * A restarted CLEANING is not a new provider operation or file transfer.
     */
    @Transaction
    ProtectedPhoto beginOrResume(String owner,String org,String id) {
        PhotoCleanupJournal j=find(id);
        if(j==null||!owner.equals(j.ownerId)||!org.equals(j.organizationId))
            throw new IllegalStateException("Original photo owner mismatch");
        ProtectedPhoto p=photo(id);
        if(p==null) throw new IllegalStateException("Original photo record missing");
        if("CLEANING".equals(j.state)) {
            safeWholeWorkOrder(j,p,true);
            return p;
        }
        if(!"READY".equals(j.state))
            throw new IllegalStateException("No durable READY cleanup decision");
        safeWholeWorkOrder(j,p,false);
        if(changeJournal(id,owner,org,"READY","CLEANING")!=1
                ||changePhoto(id,owner,org,"WAITING","CLEANING")!=1)
            throw new IllegalStateException("Cleanup transition changed");
        return photo(id);
    }

    /** Called only AFTER all exact local files are absent. Preserve receipt metadata. */
    @Transaction
    void markCleaned(String owner,String org,String id) {
        PhotoCleanupJournal j=find(id);
        ProtectedPhoto p=photo(id);
        if(j==null||p==null||!owner.equals(j.ownerId)||!org.equals(j.organizationId)
                ||!"CLEANING".equals(j.state)||!"CLEANING".equals(p.state))
            throw new IllegalStateException("No matching CLEANING snapshot");
        safeWholeWorkOrder(j,p,true);
        if(changePhoto(id,owner,org,"CLEANING","CLEANED")!=1
                ||finishPhotoMetadata(id,owner,org)!=1
                ||changeJournal(id,owner,org,"CLEANING","CLEANED")!=1)
            throw new IllegalStateException("Terminal cleanup changed");
    }

}
