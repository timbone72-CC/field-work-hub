package com.inandout.fieldphotoprep.team.internal;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.ForeignKey;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/** Private holding journal. RECEIVED is never final delivery or cleanup permission. */
@Entity(tableName = "photo_transfers", foreignKeys = {
        @ForeignKey(entity = ProtectedPhoto.class, parentColumns = "id", childColumns = "photoId"),
        @ForeignKey(entity = FieldAction.class, parentColumns = "actionId", childColumns = "finishActionId")
}, indices = {
        @Index(value = {"ownerId", "organizationId"}),
        @Index(value = "finishActionId")
})
final class PhotoTransfer {
    @PrimaryKey @NonNull public String photoId;
    @NonNull public String ownerId;
    @NonNull public String organizationId;
    @NonNull public String workOrderId;
    @NonNull public String runId;
    @NonNull public String assignmentInstanceId;
    @NonNull public String requirementRevision;
    @NonNull public String itemId;
    @NonNull public String capturedAt;
    @NonNull public String finishActionId;
    @NonNull public String finishSetId;
    @NonNull public String preparedSha256;
    public long preparedSize;
    @NonNull public String beginActionId;
    @NonNull public String verificationActionId;
    @NonNull public String state = "REGISTER_PENDING";
    @NonNull public String transferVersion = "";
    @NonNull public String bucket = "";
    @NonNull public String objectKey = "";
    @NonNull public String tusUrl = "";
    public long confirmedOffset = 0;
    public long retryNotBefore = 0;
    @NonNull public String problem = "";
    @NonNull public String receiptId = "";
    public long receiptSavedAt = 0;

    PhotoTransfer(@NonNull String photoId, @NonNull String ownerId,
            @NonNull String organizationId, @NonNull String workOrderId, @NonNull String runId,
            @NonNull String assignmentInstanceId, @NonNull String requirementRevision,
            @NonNull String itemId, @NonNull String capturedAt, @NonNull String finishActionId,
            @NonNull String finishSetId, @NonNull String preparedSha256, long preparedSize,
            @NonNull String beginActionId, @NonNull String verificationActionId) {
        this.photoId = photoId; this.ownerId = ownerId; this.organizationId = organizationId;
        this.workOrderId = workOrderId; this.runId = runId;
        this.assignmentInstanceId = assignmentInstanceId; this.requirementRevision = requirementRevision;
        this.itemId = itemId; this.capturedAt = capturedAt; this.finishActionId = finishActionId;
        this.finishSetId = finishSetId; this.preparedSha256 = preparedSha256;
        this.preparedSize = preparedSize; this.beginActionId = beginActionId;
        this.verificationActionId = verificationActionId;
    }

    boolean matches(ProtectedPhoto p, FieldAction a) {
        return p != null && a != null && photoId.equals(p.id) && ownerId.equals(p.ownerId)
                && organizationId.equals(p.organizationId) && workOrderId.equals(p.workOrderId)
                && runId.equals(p.runId) && assignmentInstanceId.equals(p.assignmentInstanceId)
                && requirementRevision.equals(p.requirementRevision) && itemId.equals(p.itemId)
                && capturedAt.equals(p.capturedAt) && finishSetId.equals(p.finishSetId)
                && finishActionId.equals(a.actionId) && finishSetId.equals(a.finishSetId)
                && ownerId.equals(a.ownerId) && organizationId.equals(a.organizationId)
                && workOrderId.equals(a.workOrderId) && runId.equals(a.runId)
                && assignmentInstanceId.equals(a.assignmentInstanceId)
                && requirementRevision.equals(a.requirementRevision);
    }
}
