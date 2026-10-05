package com.inandout.fieldphotoprep.team.internal;

import androidx.annotation.NonNull;
import androidx.room.*;

/** Permanent capture identity. Neither retry nor a late callback changes its binding. */
@Entity(tableName="protected_photos", indices={@Index(value={"ownerId","organizationId","workOrderId","runId"})})
final class ProtectedPhoto {
    @PrimaryKey @NonNull public String id;
    @NonNull public String ownerId;
    @NonNull public String organizationId;
    @NonNull public String workOrderId;
    @NonNull public String runId;
    @NonNull public String assignmentInstanceId;
    @NonNull public String requirementRevision;
    @NonNull public String itemId;
    @NonNull public String capturedAt;
    @NonNull public String originalPath;
    @NonNull public String preparedPath;
    @NonNull public String state = "CAPTURING";
    @NonNull public String problem = "";
    @NonNull public String finishSetId = "";
    public long originalBytes;
    public boolean prepared;
    ProtectedPhoto(@NonNull String id,@NonNull String ownerId,@NonNull String organizationId,
            @NonNull String workOrderId,@NonNull String runId,@NonNull String assignmentInstanceId,
            @NonNull String requirementRevision,@NonNull String itemId,@NonNull String capturedAt,
            @NonNull String originalPath,@NonNull String preparedPath) {
        this.id=id; this.ownerId=ownerId; this.organizationId=organizationId; this.workOrderId=workOrderId;
        this.runId=runId; this.assignmentInstanceId=assignmentInstanceId; this.requirementRevision=requirementRevision;
        this.itemId=itemId; this.capturedAt=capturedAt; this.originalPath=originalPath; this.preparedPath=preparedPath;
    }
    boolean readable() {
        java.io.File f=new java.io.File(originalPath);
        return "WAITING".equals(state) && f.isFile() && f.canRead() && f.length()>0 && f.length()==originalBytes;
    }
}
