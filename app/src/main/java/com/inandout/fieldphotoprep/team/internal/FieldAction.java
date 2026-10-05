package com.inandout.fieldphotoprep.team.internal;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/** Immutable intent fields; mutable delivery fields never redefine the original event. */
@Entity(
        tableName = "field_actions",
        indices = {
            @Index(
                    value = {
                        "ownerId",
                        "organizationId",
                        "workOrderId",
                        "runId",
                        "assignmentInstanceId",
                        "kind"
                    },
                    unique = true),
            @Index(value = {"ownerId", "organizationId", "sequence"})
        })
final class FieldAction {
    @PrimaryKey @NonNull public String actionId;
    @NonNull public String ownerId;
    @NonNull public String organizationId;
    @NonNull public String workOrderId;
    @NonNull public String runId;
    @NonNull public String assignmentInstanceId;
    @NonNull public String kind;
    @NonNull public String eventTime;
    public long createdAt;
    public long sequence;
    @NonNull public String state = "PENDING";
    public int attempts = 0;
    public long retryNotBefore = 0;
    @NonNull public String reason = "";
    @NonNull public String claimId = "";
    public long claimGeneration = 0;
    @NonNull public String canonicalStatus = "";
    @NonNull public String canonicalStartedAt = "";
    @NonNull public String canonicalCompletedAt = "";
    @NonNull public String serverUpdatedAt = "";
    @NonNull public String acceptedAt = "";

    @NonNull @androidx.room.ColumnInfo(defaultValue="''") public String requirementRevision = "";
    @NonNull @androidx.room.ColumnInfo(defaultValue="''") public String finishSetId = "";
    @NonNull @androidx.room.ColumnInfo(defaultValue="''") public String finishPhotosJson = "";
    @NonNull @androidx.room.ColumnInfo(defaultValue="''") public String finishDigest = "";

    FieldAction(
            @NonNull String actionId,
            @NonNull String ownerId,
            @NonNull String organizationId,
            @NonNull String workOrderId,
            @NonNull String runId,
            @NonNull String assignmentInstanceId,
            @NonNull String kind,
            @NonNull String eventTime,
            long createdAt,
            long sequence) {
        this.actionId = actionId;
        this.ownerId = ownerId;
        this.organizationId = organizationId;
        this.workOrderId = workOrderId;
        this.runId = runId;
        this.assignmentInstanceId = assignmentInstanceId;
        this.kind = kind;
        this.eventTime = eventTime;
        this.createdAt = createdAt;
        this.sequence = sequence;
    }
}
