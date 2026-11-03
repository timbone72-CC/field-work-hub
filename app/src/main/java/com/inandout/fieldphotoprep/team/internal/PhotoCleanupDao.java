package com.inandout.fieldphotoprep.team.internal;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Transaction;
import org.json.JSONObject;
import java.util.UUID;

/**
 * Passive Room journal; deliberately no CLEANING/CLEANED transition and NO
 * file deletion. An eligible server snapshot must never bypass local evidence.
 */
@Dao
abstract class PhotoCleanupDao {
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
        PhotoTransfer t=transfer(id);
        FieldAction a=t==null?null:action(t.finishActionId);
        if(p==null||t==null||a==null
            ||!owner.equals(p.ownerId)||!org.equals(p.organizationId)
            ||!t.matches(p,a)||!"WAITING".equals(p.state)
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
        PhotoCleanupJournal old=find(id);
        if(old!=null) {
            if(!old.ownerId.equals(owner)||!old.organizationId.equals(org)
              ||!old.packageId.equals(packageId)||!old.transferVersion.equals(t.transferVersion)
              ||!old.finishDigest.equals(a.finishDigest)||!old.serverProofJson.equals(response))
                throw new IllegalStateException("Immutable cleanup evidence changed");
            return;
        }
        insert(new PhotoCleanupJournal(id,owner,org,p.workOrderId,p.runId,
              p.finishSetId,a.finishDigest,t.transferVersion,t.receiptId,
              packageId,response,System.currentTimeMillis()));
        // No READY, CLEANING or file deletion. Future release must separately
        // confirm pending actions, local closure, crash recovery and pilot gate.
    }
}
