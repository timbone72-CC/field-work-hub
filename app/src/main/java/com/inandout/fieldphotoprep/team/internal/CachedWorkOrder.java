package com.inandout.fieldphotoprep.team.internal;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;

@Entity(
        tableName = "cached_work_orders",
        primaryKeys = {"cache_owner_user_id", "work_order_id", "run_id"},
        indices = {
            @Index(value = {"cache_owner_user_id", "organization_id"}),
            @Index(value = {"assigned_user_id"}),
            @Index(value = {"due_date"})
        })
final class CachedWorkOrder {
    @NonNull
    @ColumnInfo(name = "cache_owner_user_id")
    final String cacheOwnerUserId;

    @NonNull
    @ColumnInfo(name = "organization_id")
    final String organizationId;

    @NonNull
    @ColumnInfo(name = "work_order_id")
    final String workOrderId;

    @NonNull
    @ColumnInfo(name = "run_id")
    final String runId;

    @ColumnInfo(name = "run_sequence")
    final int runSequence;

    @NonNull
    @ColumnInfo(name = "assigned_user_id")
    final String assignedUserId;

    @NonNull
    @ColumnInfo(name = "wo_number")
    final String woNumber;

    @NonNull
    @ColumnInfo(name = "property_address")
    final String propertyAddress;

    @NonNull
    @ColumnInfo(name = "work_type")
    final String workType;

    @NonNull
    @ColumnInfo(name = "instructions")
    final String instructions;

    @NonNull
    @ColumnInfo(name = "admin_updates_json")
    final String adminUpdatesJson;

    @NonNull
    @ColumnInfo(name = "due_date")
    final String dueDate;

    @NonNull
    @ColumnInfo(name = "requirement_snapshot_json")
    final String requirementSnapshotJson;

    @NonNull
    @ColumnInfo(name = "field_status")
    final String fieldStatus;

    @NonNull
    @ColumnInfo(name = "assignment_received_at")
    final String assignmentReceivedAt;

    @NonNull
    @ColumnInfo(name = "started_at")
    final String startedAt;

    @NonNull
    @ColumnInfo(name = "field_completed_at")
    final String fieldCompletedAt;

    @NonNull
    @ColumnInfo(name = "pending_assignee_user_id")
    final String pendingAssigneeUserId;

    @NonNull
    @ColumnInfo(name = "reassignment_requested_at")
    final String reassignmentRequestedAt;

    @NonNull
    @ColumnInfo(name = "server_updated_at")
    final String serverUpdatedAt;

    @ColumnInfo(name = "last_successful_sync_epoch_ms")
    final long lastSuccessfulSyncEpochMs;

    @NonNull
    @ColumnInfo(name = "assignment_instance_id", defaultValue = "''")
    public String assignmentInstanceId = "";

    @NonNull
    @ColumnInfo(name = "conflict_reason", defaultValue = "''")
    public String conflictReason = "";

    @NonNull
    @ColumnInfo(name = "acknowledgment_received_at", defaultValue = "''")
    public String acknowledgmentReceivedAt = "";

    @NonNull
    @ColumnInfo(name = "reopen_reason", defaultValue = "''")
    public String reopenReason = "";

    CachedWorkOrder(
            @NonNull String cacheOwnerUserId,
            @NonNull String organizationId,
            @NonNull String workOrderId,
            @NonNull String runId,
            int runSequence,
            @NonNull String assignedUserId,
            @NonNull String woNumber,
            @NonNull String propertyAddress,
            @NonNull String workType,
            @NonNull String instructions,
            @NonNull String adminUpdatesJson,
            @NonNull String dueDate,
            @NonNull String requirementSnapshotJson,
            @NonNull String fieldStatus,
            @NonNull String assignmentReceivedAt,
            @NonNull String startedAt,
            @NonNull String fieldCompletedAt,
            @NonNull String pendingAssigneeUserId,
            @NonNull String reassignmentRequestedAt,
            @NonNull String serverUpdatedAt,
            long lastSuccessfulSyncEpochMs) {
        this.cacheOwnerUserId = cacheOwnerUserId;
        this.organizationId = organizationId;
        this.workOrderId = workOrderId;
        this.runId = runId;
        this.runSequence = runSequence;
        this.assignedUserId = assignedUserId;
        this.woNumber = woNumber;
        this.propertyAddress = propertyAddress;
        this.workType = workType;
        this.instructions = instructions;
        this.adminUpdatesJson = adminUpdatesJson;
        this.dueDate = dueDate;
        this.requirementSnapshotJson = requirementSnapshotJson;
        this.fieldStatus = fieldStatus;
        this.assignmentReceivedAt = assignmentReceivedAt;
        this.startedAt = startedAt;
        this.fieldCompletedAt = fieldCompletedAt;
        this.pendingAssigneeUserId = pendingAssigneeUserId;
        this.reassignmentRequestedAt = reassignmentRequestedAt;
        this.serverUpdatedAt = serverUpdatedAt;
        this.lastSuccessfulSyncEpochMs = lastSuccessfulSyncEpochMs;
    }
}
