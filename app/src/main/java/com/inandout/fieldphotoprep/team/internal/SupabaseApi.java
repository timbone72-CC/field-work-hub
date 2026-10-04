package com.inandout.fieldphotoprep.team.internal;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class SupabaseApi
        implements AssignmentRepository.Remote,
                SessionCoordinator.Remote,
                ActionSyncCoordinator.Remote {
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 20_000;

    static final class AuthSession {
        final String accessToken;
        final String refreshToken;
        final String userId;
        final String email;
        final String role;
        final String organizationId;
        final long expiresAtEpochSeconds;

        AuthSession(
                String accessToken,
                String refreshToken,
                String userId,
                String email,
                String role,
                String organizationId,
                long expiresAtEpochSeconds) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.userId = userId;
            this.email = email;
            this.role = role;
            this.organizationId = organizationId;
            this.expiresAtEpochSeconds = expiresAtEpochSeconds;
        }
    }

    static final class WorkOrder {
        final String id;
        final String organizationId;
        final String currentRunId;
        final int currentRunSequence;
        final String woNumber;
        final String propertyAddress;
        final String workType;
        final String instructions;
        final String dueDate;
        final String fieldStatus;
        final String assignedUserId;
        final String pendingAssigneeUserId;
        final String reassignmentRequestedAt;
        final String assignmentReceivedAt;
        final String startedAt;
        final String fieldCompletedAt;
        final String serverUpdatedAt;

        String assignmentInstanceId = "";
        String conflictReason = "";
        String pendingKind = "";
        String requirementSnapshotJson = "{}";

        WorkOrder(
                String id,
                String organizationId,
                String currentRunId,
                int currentRunSequence,
                String woNumber,
                String propertyAddress,
                String workType,
                String instructions,
                String dueDate,
                String fieldStatus,
                String assignedUserId,
                String pendingAssigneeUserId,
                String reassignmentRequestedAt,
                String assignmentReceivedAt,
                String startedAt,
                String fieldCompletedAt,
                String serverUpdatedAt) {
            this.id = id;
            this.organizationId = organizationId;
            this.currentRunId = currentRunId;
            this.currentRunSequence = currentRunSequence;
            this.woNumber = woNumber;
            this.propertyAddress = propertyAddress;
            this.workType = workType;
            this.instructions = instructions;
            this.dueDate = dueDate;
            this.fieldStatus = fieldStatus;
            this.assignedUserId = assignedUserId;
            this.pendingAssigneeUserId = pendingAssigneeUserId;
            this.reassignmentRequestedAt = reassignmentRequestedAt;
            this.assignmentReceivedAt = assignmentReceivedAt;
            this.startedAt = startedAt;
            this.fieldCompletedAt = fieldCompletedAt;
            this.serverUpdatedAt = serverUpdatedAt;
        }
    }

    AuthSession signIn(String email, String password)
            throws IOException, JSONException, ApiException {
        JSONObject request = new JSONObject();
        request.put("email", email);
        request.put("password", password);
        return tokenRequest("password", request, email);
    }

    @Override
    public AuthSession refreshSession(String refreshToken)
            throws IOException, JSONException, ApiException {
        if (refreshToken == null || refreshToken.trim().isEmpty()) {
            throw new ApiException(401, "No reusable Team session is available.");
        }
        JSONObject request = new JSONObject();
        request.put("refresh_token", refreshToken);
        return tokenRequest("refresh_token", request, "");
    }

    private AuthSession tokenRequest(String grantType, JSONObject request, String fallbackEmail)
            throws IOException, JSONException, ApiException {
        URL url = new URL(SupabaseConfig.PROJECT_URL + "/auth/v1/token?grant_type=" + grantType);
        HttpURLConnection connection = open(url);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("apikey", SupabaseConfig.PUBLISHABLE_KEY);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");

        byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload);
        }

        int status = connection.getResponseCode();
        String body = readBody(connection, status);
        connection.disconnect();
        if (status < 200 || status >= 300) {
            throw new ApiException(status, extractErrorMessage(status, body));
        }

        JSONObject response = new JSONObject(body);
        String accessToken = response.getString("access_token");
        String refreshToken = response.getString("refresh_token");
        JSONObject user = response.getJSONObject("user");
        String userId = user.getString("id");
        String signedInEmail = user.optString("email", fallbackEmail);
        JSONObject appMetadata = user.optJSONObject("app_metadata");
        String role = appMetadata == null ? "" : appMetadata.optString("role", "");
        String organizationId =
                appMetadata == null ? "" : appMetadata.optString("organization_id", "");
        long expiresAt = response.optLong("expires_at", 0L);
        if (expiresAt <= 0L) {
            long expiresIn = response.optLong("expires_in", 0L);
            expiresAt = expiresIn <= 0L ? 0L : (System.currentTimeMillis() / 1000L) + expiresIn;
        }

        if (userId.isEmpty() || role.isEmpty() || organizationId.isEmpty()) {
            throw new ApiException(403, "Team authorization metadata is incomplete.");
        }

        return new AuthSession(
                accessToken, refreshToken, userId, signedInEmail, role, organizationId, expiresAt);
    }

    @Override
    public List<WorkOrder> fetchWorkOrders(String accessToken)
            throws IOException, JSONException, ApiException {
        String body = postRpc(accessToken, "field_assignments", new JSONObject());

        JSONArray rows = new JSONArray(body);
        List<WorkOrder> workOrders = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            WorkOrder workOrder =
                    new WorkOrder(
                            row.getString("id"),
                            row.optString("organization_id", ""),
                            nullableString(row, "current_run_id"),
                            row.optInt("current_run_sequence", 0),
                            row.optString("wo_number", ""),
                            row.optString("property_address", ""),
                            row.optString("work_type", ""),
                            nullableString(row, "instructions"),
                            row.optString("due_date", ""),
                            row.optString("field_status", ""),
                            nullableString(row, "assigned_user_id"),
                            nullableString(row, "pending_assignee_user_id"),
                            nullableString(row, "reassignment_requested_at"),
                            nullableString(row, "assignment_received_at"),
                            nullableString(row, "started_at"),
                            nullableString(row, "field_completed_at"),
                            nullableString(row, "updated_at"));
            workOrder.assignmentInstanceId = nullableString(row, "assignment_instance_id");
            workOrder.requirementSnapshotJson = row.has("requirement_snapshot") ? row.getJSONObject("requirement_snapshot").toString() : "{}";
            workOrders.add(workOrder);
        }
        return workOrders;
    }

    @Override
    public void acknowledgeAssignmentReceived(String accessToken, String workOrderId)
            throws IOException, JSONException, ApiException {
        JSONObject request = new JSONObject();
        request.put("p_work_order_id", workOrderId);
        postRpc(accessToken, "acknowledge_assignment_received", request);
    }

    void respondReassignment(String accessToken, String workOrderId, boolean accept)
            throws IOException, JSONException, ApiException {
        JSONObject request = new JSONObject();
        request.put("p_work_order_id", workOrderId);
        request.put("p_accept", accept);
        postRpc(accessToken, "respond_reassignment", request);
    }

    @Override
    public FieldActionResult submit(String accessToken, FieldAction action) throws Exception {
        JSONObject request = new JSONObject();
        request.put("p_action_id", action.actionId);
        request.put("p_work_order_id", action.workOrderId);
        request.put("p_run_id", action.runId);
        request.put("p_assignment_instance_id", action.assignmentInstanceId);
        request.put("p_action_kind", action.kind);
        request.put("p_event_time", action.eventTime);
        if (!action.finishSetId.isEmpty()) {
            JSONObject metadata = new JSONObject();
            metadata.put("p_set_id", action.finishSetId); metadata.put("p_work_order_id", action.workOrderId);
            metadata.put("p_run_id", action.runId); metadata.put("p_assignment_instance_id", action.assignmentInstanceId);
            metadata.put("p_requirement_revision", action.requirementRevision.isEmpty()?JSONObject.NULL:action.requirementRevision);
            metadata.put("p_photos", new JSONArray(action.finishPhotosJson));
            metadata.put("p_digest",action.finishDigest); metadata.put("p_payload",action.finishPhotosJson);
            JSONObject result = new JSONObject(postRpc(accessToken,"register_photo_finish_set",metadata));
            if ("CONFLICT".equals(result.optString("outcome"))) {
                result.put("action_id",action.actionId); return new FieldActionResult(action,result.toString());
            }
            if (!java.util.Arrays.asList("APPLIED","ALREADY_APPLIED").contains(result.optString("outcome"))
                    || !action.finishSetId.equals(result.optString("set_id"))) throw new IllegalStateException("Invalid photo metadata response");
        }
        if (!action.requirementRevision.isEmpty() || !action.finishSetId.isEmpty()) {
            request.put("p_requirement_revision",action.requirementRevision.isEmpty()?JSONObject.NULL:action.requirementRevision);
            request.put("p_finish_set_id",action.finishSetId.isEmpty()?JSONObject.NULL:action.finishSetId);
            request.put("p_finish_digest",action.finishDigest);
            return new FieldActionResult(action, postRpc(accessToken,"accept_field_action_v4",request));
        }
        return new FieldActionResult(action, postRpc(accessToken, "accept_field_action", request));
    }

    private String postRpc(String accessToken, String functionName, JSONObject request)
            throws IOException, ApiException {
        URL url = new URL(SupabaseConfig.PROJECT_URL + "/rest/v1/rpc/" + functionName);
        HttpURLConnection connection = open(url);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        addAuthHeaders(connection, accessToken);
        connection.setRequestProperty("Content-Type", "application/json");
        boolean snapshot = "field_assignments".equals(functionName);
        if (snapshot) connection.setRequestProperty("Prefer", "count=exact");
        byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload);
        }

        int status = connection.getResponseCode();
        String body = readBody(connection, status);
        String contentRange = connection.getHeaderField("Content-Range");
        long retryAfter = retryDelay(connection.getHeaderField("Retry-After"));
        connection.disconnect();
        if (status < 200 || status >= 300) {
            throw new ApiException(status, extractErrorMessage(status, body), retryAfter);
        }
        if (snapshot) validateCompleteSnapshot(body, contentRange);
        return body;
    }

    static long retryDelay(String header) {
        if (header == null) return 0;
        try {
            return Math.max(0, Long.parseLong(header.trim())) * 1000;
        } catch (Exception ignored) {
            try {
                return Math.max(
                        0,
                        java.time.ZonedDateTime.parse(
                                                header,
                                                java.time.format.DateTimeFormatter
                                                        .RFC_1123_DATE_TIME)
                                        .toInstant()
                                        .toEpochMilli()
                                - System.currentTimeMillis());
            } catch (Exception invalid) {
                return 0;
            }
        }
    }

    static void validateCompleteSnapshot(String body, String contentRange) throws IOException {
        try {
            int received = new JSONArray(body).length();
            if (contentRange == null || !contentRange.contains("/"))
                throw new IllegalStateException();
            String[] parts = contentRange.split("/", -1);
            long total = Long.parseLong(parts[1]);
            if (total != received) throw new IllegalStateException();
            if (received > 0 && !parts[0].equals("0-" + (received - 1)))
                throw new IllegalStateException();
        } catch (Exception error) {
            throw new IOException("Assignment download was incomplete. Saved work is preserved.");
        }
    }

    private static void addAuthHeaders(HttpURLConnection connection, String accessToken) {
        connection.setRequestProperty("apikey", SupabaseConfig.PUBLISHABLE_KEY);
        connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        connection.setRequestProperty("Accept", "application/json");
    }

    private static String nullableString(JSONObject row, String key) {
        return row.isNull(key) ? "" : row.optString(key, "");
    }

    private static HttpURLConnection open(URL url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        return connection;
    }

    private static String readBody(HttpURLConnection connection, int status) throws IOException {
        InputStream stream =
                status >= 200 && status < 400
                        ? connection.getInputStream()
                        : connection.getErrorStream();
        if (stream == null) {
            return "";
        }
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                result.append(line);
            }
        }
        return result.toString();
    }

    private static String extractErrorMessage(int status, String body) {
        if (body != null && !body.isEmpty()) {
            try {
                JSONObject json = new JSONObject(body);
                String[] keys = {"msg", "message", "error_description", "error"};
                for (String key : keys) {
                    String value = json.optString(key, "").trim();
                    if (!value.isEmpty()) {
                        return value;
                    }
                }
            } catch (JSONException ignored) {
                // Fall through to a generic message. Never display raw response bodies.
            }
        }
        return "Request failed (HTTP " + status + ")";
    }

    static final class ApiException extends Exception {
        final int statusCode;
        final long retryAfterMs;

        ApiException(int statusCode, String message) {
            this(statusCode, message, 0);
        }

        ApiException(int statusCode, String message, long retryAfterMs) {
            super(message);
            this.statusCode = statusCode;
            this.retryAfterMs = retryAfterMs;
        }

        boolean isAuthenticationRejection() {
            return statusCode == 400 || statusCode == 401 || statusCode == 403;
        }
    }
}
