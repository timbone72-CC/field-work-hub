package com.inandout.fieldphotoprep.team.internal;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.ForeignKey;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/** Durable exact-identity evidence snapshot. HELD is not permission to delete files. */
@Entity(tableName="photo_cleanup_journal",
    foreignKeys=@ForeignKey(entity=ProtectedPhoto.class,parentColumns="id",childColumns="photoId"),
    indices={@Index(value={"ownerId","organizationId","workOrderId","runId"})})
final class PhotoCleanupJournal {
    @PrimaryKey @NonNull public String photoId;
    @NonNull public String ownerId;
    @NonNull public String organizationId;
    @NonNull public String workOrderId;
    @NonNull public String runId;
    @NonNull public String finishSetId;
    @NonNull public String finishDigest;
    @NonNull public String transferVersion;
    @NonNull public String privateReceiptId;
    @NonNull public String packageId;
    @NonNull public String serverProofJson;
    @NonNull public String state = "HELD";
    public long recordedAt;

    PhotoCleanupJournal(@NonNull String photoId,@NonNull String ownerId,
            @NonNull String organizationId,@NonNull String workOrderId,
            @NonNull String runId,@NonNull String finishSetId,
            @NonNull String finishDigest,@NonNull String transferVersion,
            @NonNull String privateReceiptId,@NonNull String packageId,
            @NonNull String serverProofJson,long recordedAt) {
        this.photoId=photoId; this.ownerId=ownerId;
        this.organizationId=organizationId; this.workOrderId=workOrderId;
        this.runId=runId; this.finishSetId=finishSetId;
        this.finishDigest=finishDigest; this.transferVersion=transferVersion;
        this.privateReceiptId=privateReceiptId; this.packageId=packageId;
        this.serverProofJson=serverProofJson; this.recordedAt=recordedAt;
    }
}
