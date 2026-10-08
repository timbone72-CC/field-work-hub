package com.inandout.fieldphotoprep.team.internal;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;
import androidx.room.Transaction;
import androidx.room.Update;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** One Room journal; transitions never mutate protected files, Finish intent or delivery state. */
@Dao
abstract class PhotoTransferDao {
    static final long MAX_PREPARED_BYTES = 32L * 1024 * 1024;
    @Query("SELECT * FROM photo_transfers WHERE photoId=:id") abstract PhotoTransfer find(String id);
    @Query("SELECT * FROM photo_transfers WHERE ownerId=:owner AND organizationId=:org ORDER BY photoId")
    abstract List<PhotoTransfer> list(String owner, String org);
    @Query("SELECT count(*) FROM photo_transfers WHERE ownerId=:owner AND organizationId=:org AND state<>'RECEIVED'")
    abstract int unresolved(String owner, String org);
    @Query("SELECT * FROM protected_photos WHERE id=:id") abstract ProtectedPhoto photo(String id);
    @Query("SELECT * FROM field_actions WHERE actionId=:id") abstract FieldAction action(String id);
    @Insert abstract void insert(PhotoTransfer row);
    @Update abstract void update(PhotoTransfer row);

    @Transaction
    PhotoTransfer stage(String owner, String org, String actionId, String photoId,
            String sha256, long size) {
        if (sha256 == null || !sha256.matches("[0-9a-f]{64}") || size < 4 || size > MAX_PREPARED_BYTES)
            throw new IllegalStateException("Prepared copy needs review; original is protected.");
        ProtectedPhoto p = photo(photoId); FieldAction a = action(actionId);
        if (p == null || a == null || !owner.equals(p.ownerId) || !org.equals(p.organizationId)
                || !"WAITING".equals(p.state) || !p.prepared || p.finishSetId.isEmpty()
                || !"ACCEPTED".equals(a.state) || !"COMPLETE".equals(a.kind)
                || !"FIELD_COMPLETE".equals(a.canonicalStatus) || a.acceptedAt.isEmpty())
            throw new IllegalStateException("Accepted Finish is required for private transfer.");
        PhotoTransfer row = find(photoId);
        if (row == null) row = new PhotoTransfer(p.id, p.ownerId, p.organizationId, p.workOrderId,
                p.runId, p.assignmentInstanceId, p.requirementRevision, p.itemId, p.capturedAt,
                a.actionId, a.finishSetId, sha256, size,
                UUID.randomUUID().toString(), UUID.randomUUID().toString());
        if (!row.matches(p, a) || !frozenMember(p, a)
                || !sha256.equals(row.preparedSha256) || size != row.preparedSize)
            throw new IllegalStateException("Frozen transfer binding changed; original is protected.");
        if (find(photoId) == null) insert(row);
        return row;
    }

    private static boolean frozenMember(ProtectedPhoto p, FieldAction a) {
        try {
            if (!PhotoOwner.digest(a.finishPhotosJson).equals(a.finishDigest)) return false;
            JSONArray manifest = new JSONArray(a.finishPhotosJson); int matches = 0;
            for (int n = 0; n < manifest.length(); n++) {
                JSONObject entry = manifest.getJSONObject(n);
                if (p.id.equals(entry.getString("id"))) {
                    if (!p.capturedAt.equals(entry.getString("captured_at"))
                            || !p.itemId.equals(entry.isNull("item_id") ? "" : entry.getString("item_id")))
                        return false;
                    matches++;
                }
            }
            return matches == 1;
        } catch (Exception error) { return false; }
    }

    private PhotoTransfer bound(String owner, String org, String id, String version) {
        PhotoTransfer row = find(id);
        if (row == null || !owner.equals(row.ownerId) || !org.equals(row.organizationId)
                || !version.equals(row.transferVersion))
            throw new IllegalStateException("Private transfer identity did not match.");
        return row;
    }

    @Transaction
    void registered(String owner, String org, String id, String version, String bucket,
            String key, String sha256, long size, String serverState) {
        PhotoTransfer row = find(id);
        if (row == null || !owner.equals(row.ownerId) || !org.equals(row.organizationId)
                || !uuid(version) || !"fwh-review-private".equals(bucket)
                || !uuid(row.organizationId) || !uuid(row.workOrderId) || !uuid(row.runId) || !uuid(row.photoId)
                || !key.equals(row.organizationId + "/" + row.workOrderId + "/" + row.runId + "/" + row.photoId + ".jpg")
                || !sha256.equals(row.preparedSha256) || size != row.preparedSize
                || !("WAITING".equals(serverState) || "RECEIVED".equals(serverState)))
            throw new IllegalStateException("Private registration did not match.");
        if (!row.transferVersion.isEmpty()) {
            if (!version.equals(row.transferVersion) || !bucket.equals(row.bucket) || !key.equals(row.objectKey))
                throw new IllegalStateException("Private registration cannot be rebound.");
            return; // Replay preserves offsets, uncertainty and historical receipt.
        }
        row.transferVersion = version; row.bucket = bucket; row.objectKey = key;
        // A registration is not proof that Storage is empty, or a local receipt.
        row.state = "RECEIVED".equals(serverState) ? "VERIFY_PENDING" : "UNCERTAIN";
        update(row);
    }

    @Transaction
    void confirmedAbsent(String owner, String org, String id, String version) {
        PhotoTransfer row = bound(owner, org, id, version);
        if (!"UNCERTAIN".equals(row.state)) throw new IllegalStateException("Reconciliation is required.");
        // Only the future exact authorized object-status RPC may call this, never HTTP 404/410.
        row.state = "TRANSFER_PENDING"; row.tusUrl = ""; row.confirmedOffset = 0;
        row.problem = ""; row.retryNotBefore = 0; update(row);
    }

    @Transaction
    void objectPresent(String owner, String org, String id, String version) {
        PhotoTransfer row = bound(owner, org, id, version);
        if ("RECEIVED".equals(row.state)) return;
        if (!"UNCERTAIN".equals(row.state) && !"VERIFY_PENDING".equals(row.state))
            throw new IllegalStateException("Present private object did not match reconciliation state.");
        row.state = "VERIFY_PENDING"; row.problem = ""; row.retryNotBefore = 0; update(row);
    }

    @Transaction
    void creating(String owner, String org, String id, String version) {
        PhotoTransfer row = bound(owner, org, id, version);
        if (!"TRANSFER_PENDING".equals(row.state)) throw new IllegalStateException("Object absence is required.");
        row.state = "CREATING"; update(row); // Commit before POST; lost response is uncertain.
    }

    @Transaction
    void sessionCreated(String owner, String org, String id, String version, String url) {
        PhotoTransfer row = bound(owner, org, id, version);
        if (!"CREATING".equals(row.state) || !safeTusUrl(url))
            throw new IllegalStateException("Resumable session did not match the configured storage origin.");
        row.tusUrl = url; row.state = "UPLOADING"; update(row);
    }

    @Transaction
    void offsetConfirmed(String owner, String org, String id, String version,
            String url, long expectedOffset, long newOffset) {
        PhotoTransfer row = bound(owner, org, id, version);
        if (!"UPLOADING".equals(row.state) || !url.equals(row.tusUrl)
                || expectedOffset != row.confirmedOffset || newOffset < expectedOffset
                || newOffset > row.preparedSize)
            throw new IllegalStateException("Resumable offset needs reconciliation.");
        row.confirmedOffset = newOffset;
        if (newOffset == row.preparedSize) row.state = "VERIFY_PENDING";
        update(row); // Sent bytes alone never advance this counter.
    }

    @Transaction
    void sessionReconciled(String owner, String org, String id, String version,
            String url, long serverLength, long serverOffset) {
        PhotoTransfer row = bound(owner, org, id, version);
        if (!"UNCERTAIN".equals(row.state) || row.tusUrl.isEmpty() || !url.equals(row.tusUrl)
                || !safeTusUrl(url) || serverLength != row.preparedSize
                || serverOffset < row.confirmedOffset || serverOffset > row.preparedSize)
            throw new IllegalStateException("Resumable session needs review.");
        row.confirmedOffset = serverOffset;
        row.state = serverOffset == row.preparedSize ? "VERIFY_PENDING" : "UPLOADING";
        row.problem = ""; row.retryNotBefore = 0; update(row);
    }

    @Transaction
    void uncertain(String owner, String org, String id, String version, long retryNotBefore) {
        PhotoTransfer row = bound(owner, org, id, version);
        if (row.transferVersion.isEmpty() || "RECEIVED".equals(row.state)) return;
        row.state = "UNCERTAIN"; row.problem = "REMOTE_RECONCILIATION_REQUIRED";
        row.retryNotBefore = Math.max(0, retryNotBefore); update(row);
    }

    @Query("UPDATE photo_transfers SET state='UNCERTAIN',problem='INTERRUPTED' WHERE ownerId=:owner AND organizationId=:org AND state IN ('CREATING','UPLOADING')")
    abstract void recoverInterrupted(String owner, String org);

    private void received(String owner, String org, String id, String version, String receipt, long savedAt) {
        PhotoTransfer row = bound(owner, org, id, version);
        if (version.isEmpty() || !uuid(receipt) || savedAt <= 0)
            throw new IllegalStateException("Verified receipt did not match.");
        if (!row.receiptId.isEmpty()) {
            if (!receipt.equals(row.receiptId)) throw new IllegalStateException("Receipt cannot be replaced.");
            return;
        }
        row.receiptId = receipt; row.receiptSavedAt = savedAt; row.state = "RECEIVED";
        row.problem = ""; row.retryNotBefore = 0; update(row);
    }

    @Transaction
    void verifiedResponse(String owner, String org, String id, String version, String response, long savedAt) {
        try {
            JSONObject result = new JSONObject(response);
            if (result.length() != 4 || !id.equals(result.getString("photo_id"))
                    || !version.equals(result.getString("transfer_version"))
                    || !"RECEIVED".equals(result.getString("state")))
                throw new IllegalStateException("Verified receipt did not match.");
            received(owner, org, id, version, result.getString("receipt_id"), savedAt);
        } catch (org.json.JSONException error) {
            throw new IllegalStateException("Verified receipt did not match.");
        }
    }

    static boolean uuid(String value) {
        return value != null && value.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }

    static boolean safeTusUrl(String value) {
        try {
            URI project = URI.create(SupabaseConfig.PROJECT_URL), url = URI.create(value);
            String host = project.getHost().replace(".supabase.co", ".storage.supabase.co");
            String path = url.getRawPath();
            return "https".equals(url.getScheme()) && host.equals(url.getHost())
                    && url.getPort() == -1 && url.getUserInfo() == null
                    && url.getRawQuery() == null && url.getRawFragment() == null
                    && path != null && path.startsWith("/storage/v1/upload/resumable/")
                    && path.length() > "/storage/v1/upload/resumable/".length()
                    && !path.contains("%") && !path.contains("//")
                    && !path.contains("/../") && !path.contains("/./")
                    && !path.endsWith("/..") && !path.endsWith("/.");
        } catch (Exception error) { return false; }
    }
}
