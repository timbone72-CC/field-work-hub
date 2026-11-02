package com.inandout.fieldphotoprep.team.internal;

import org.json.JSONObject;

final class FieldActionResult {
    final boolean conflict;
    final String reason, status, startedAt, completedAt, updatedAt, acceptedAt;
    final String acknowledgmentReceivedAt;

    FieldActionResult(FieldAction action, String body) throws Exception {
        JSONObject r = new JSONObject(body);
        String outcome = r.getString("outcome");
        if (!action.actionId.equals(r.getString("action_id")))
            throw new IllegalStateException("Action response identity did not match.");
        conflict = "CONFLICT".equals(outcome);
        if (!conflict && !"APPLIED".equals(outcome) && !"ALREADY_APPLIED".equals(outcome))
            throw new IllegalStateException("Unknown action response.");
        reason = r.optString("reason", "");
        if (reason.length() > 64) throw new IllegalStateException("Invalid action response.");
        status = r.optString("field_status", "");
        startedAt = value(r, "started_at");
        completedAt = value(r, "field_completed_at");
        updatedAt = value(r, "server_updated_at");
        acceptedAt = value(r, "accepted_at");
        acknowledgmentReceivedAt = value(r, "acknowledgment_received_at");
        if (!conflict && "ACK".equals(action.kind)) {
            if (!"ASSIGNED".equals(status) && !"IN_PROGRESS".equals(status)
                    && !"FIELD_COMPLETE".equals(status))
                throw new IllegalStateException("Invalid ACK work state.");
            java.time.Instant.parse(acknowledgmentReceivedAt);
            java.time.Instant.parse(acceptedAt);
            if (!acknowledgmentReceivedAt.equals(acceptedAt))
                throw new IllegalStateException("ACK server receipt did not match.");
        } else if (!conflict) {
            if (!"IN_PROGRESS".equals(status) && !"FIELD_COMPLETE".equals(status))
                throw new IllegalStateException("Invalid canonical state.");
            java.time.Instant.parse(startedAt);
            java.time.Instant.parse(updatedAt);
            java.time.Instant.parse(acceptedAt);
            if ("FIELD_COMPLETE".equals(status)) java.time.Instant.parse(completedAt);
            if ("COMPLETE".equals(action.kind) && !"FIELD_COMPLETE".equals(status))
                throw new IllegalStateException("Finish was not confirmed.");
        } else if (reason.isEmpty()) throw new IllegalStateException("Missing conflict reason.");
    }

    private static String value(JSONObject r, String key) {
        return r.isNull(key) ? "" : r.optString(key, "");
    }
}
