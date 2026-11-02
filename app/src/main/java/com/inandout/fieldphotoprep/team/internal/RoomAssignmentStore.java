package com.inandout.fieldphotoprep.team.internal;

import java.util.ArrayList;
import java.util.List;

final class RoomAssignmentStore implements AssignmentStore {
    private final CachedWorkOrderDao dao;

    RoomAssignmentStore(CachedWorkOrderDao dao) {
        this.dao = dao;
    }

    @Override
    public void replace(
            SupabaseApi.AuthSession session,
            List<SupabaseApi.WorkOrder> workOrders,
            long lastSuccessfulSyncEpochMs) {
        List<CachedWorkOrder> rows = new ArrayList<>();
        for (SupabaseApi.WorkOrder workOrder : workOrders) {
            CachedWorkOrder cached =
                    new CachedWorkOrder(
                            session.userId,
                            session.organizationId,
                            workOrder.id,
                            workOrder.currentRunId,
                            workOrder.currentRunSequence,
                            workOrder.assignedUserId,
                            workOrder.woNumber,
                            workOrder.propertyAddress,
                            workOrder.workType,
                            workOrder.instructions,
                            "[]",
                            workOrder.dueDate,
                            workOrder.requirementSnapshotJson,
                            workOrder.fieldStatus,
                            workOrder.assignmentReceivedAt,
                            workOrder.startedAt,
                            workOrder.fieldCompletedAt,
                            workOrder.pendingAssigneeUserId,
                            workOrder.reassignmentRequestedAt,
                            workOrder.serverUpdatedAt,
                            lastSuccessfulSyncEpochMs);
            cached.assignmentInstanceId = workOrder.assignmentInstanceId;
            cached.acknowledgmentReceivedAt = workOrder.acknowledgmentReceivedAt;
            cached.reopenReason = workOrder.reopenReason;
            rows.add(cached);
        }
        dao.replaceForOwner(session.userId, session.organizationId, rows);
    }

    @Override
    public List<SupabaseApi.WorkOrder> load(SupabaseApi.AuthSession session) {
        List<CachedWorkOrder> rows = dao.listForOwner(session.userId, session.organizationId);
        List<SupabaseApi.WorkOrder> result = new ArrayList<>();
        for (CachedWorkOrder row : rows) {
            SupabaseApi.WorkOrder workOrder =
                    new SupabaseApi.WorkOrder(
                            row.workOrderId,
                            row.organizationId,
                            row.runId,
                            row.runSequence,
                            row.woNumber,
                            row.propertyAddress,
                            row.workType,
                            row.instructions,
                            row.dueDate,
                            row.fieldStatus,
                            row.assignedUserId,
                            row.pendingAssigneeUserId,
                            row.reassignmentRequestedAt,
                            row.assignmentReceivedAt,
                            row.startedAt,
                            row.fieldCompletedAt,
                            row.serverUpdatedAt);
            workOrder.requirementSnapshotJson = row.requirementSnapshotJson;
            workOrder.assignmentInstanceId = row.assignmentInstanceId;
            workOrder.acknowledgmentReceivedAt = row.acknowledgmentReceivedAt;
            workOrder.reopenReason = row.reopenReason;
            workOrder.conflictReason = row.conflictReason;
            for (FieldAction a : dao.actions(session.userId, session.organizationId)) {
                if (a.workOrderId.equals(row.workOrderId)
                        && a.runId.equals(row.runId)
                        && a.assignmentInstanceId.equals(row.assignmentInstanceId)) {
                    if ("ACK".equals(a.kind) && "ACCEPTED".equals(a.state)
                            && workOrder.acknowledgmentReceivedAt.isEmpty())
                        workOrder.acknowledgmentReceivedAt = a.acceptedAt;
                    if (!"ACCEPTED".equals(a.state)) {
                        if ("CONFLICT".equals(a.state) || a.reason.startsWith("PROTOCOL"))
                            workOrder.conflictReason = a.reason;
                        else if ("ACK".equals(a.kind))
                            workOrder.acceptPending = true;
                        else if ("COMPLETE".equals(a.kind) || workOrder.pendingKind.isEmpty())
                            workOrder.pendingKind = a.kind;
                    }
                }
            }
            result.add(workOrder);
        }
        return result;
    }
}
