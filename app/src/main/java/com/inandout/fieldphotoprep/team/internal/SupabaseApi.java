package com.inandout.fieldphotoprep.team.internal;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.TimeUnit;

final class SupabaseApi
        implements AssignmentRepository.Remote,
                SessionCoordinator.Remote,
                ActionSyncCoordinator.Remote,
                PhotoTransferCoordinator.Remote {
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    private static final String TUS_VERSION = "1.0.0";
    private static final String TUS_PATH = "/storage/v1/upload/resumable";
    private final okhttp3.OkHttpClient tusClient =
            new okhttp3.OkHttpClient.Builder()
                    .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                    .readTimeout(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                    .writeTimeout(60_000, TimeUnit.MILLISECONDS)
                    .followRedirects(false)
                    .followSslRedirects(false)
                    .retryOnConnectionFailure(false)
                    .build();

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

    @Override
    public PhotoTransferCoordinator.Registration register(String accessToken, PhotoTransfer row)
            throws Exception {
        JSONObject request = new JSONObject();
        request.put("p_action", row.beginActionId);
        request.put("p_photo", row.photoId);
        request.put("p_prepared_sha256", row.preparedSha256);
        request.put("p_prepared_size", row.preparedSize);
        JSONObject result = new JSONObject(postRpc(accessToken, "begin_photo_transfer", request));
        if (result.length() != 7)
            throw new IllegalStateException("Private registration response was not exact.");
        return new PhotoTransferCoordinator.Registration(
                result.getString("photo_id"),
                result.getString("transfer_version"),
                result.getString("bucket"),
                result.getString("object_key"),
                result.getString("prepared_sha256"),
                result.getLong("prepared_size"),
                result.getString("state"));
    }

    @Override
    public PhotoTransferCoordinator.Status status(String accessToken, PhotoTransfer row)
            throws Exception {
        JSONObject request = new JSONObject();
        request.put("p_photo", row.photoId);
        request.put("p_transfer_version", row.transferVersion);
        String body = postRpc(accessToken, "photo_transfer_status", request);
        JSONObject result = new JSONObject(body);
        String state = result.getString("state");
        int expected = "RECEIVED".equals(state) ? 4 : 3;
        if (result.length() != expected)
            throw new IllegalStateException("Private transfer status response was not exact.");
        return new PhotoTransferCoordinator.Status(
                result.getString("photo_id"),
                result.getString("transfer_version"),
                state,
                "RECEIVED".equals(state) ? body : "");
    }

    @Override
    public String createSession(String accessToken, PhotoTransfer row) throws Exception {
        if (!"fwh-review-private".equals(row.bucket) || row.objectKey.isEmpty()
                || row.preparedSize <= 0 || row.preparedSize > PhotoTransferDao.MAX_PREPARED_BYTES)
            throw new IllegalStateException("Private TUS creation binding is incomplete.");
        String endpoint = storageOrigin() + TUS_PATH;
        String metadata = tusMetadata("bucketName", row.bucket)
                + "," + tusMetadata("objectName", row.objectKey)
                + "," + tusMetadata("contentType", "image/jpeg")
                + "," + tusMetadata("cacheControl", "3600");
        okhttp3.Request request = new okhttp3.Request.Builder()
                .url(endpoint)
                .header("apikey", SupabaseConfig.PUBLISHABLE_KEY)
                .header("Authorization", "Bearer " + accessToken)
                .header("Tus-Resumable", TUS_VERSION)
                .header("Upload-Length", Long.toString(row.preparedSize))
                .header("Upload-Metadata", metadata)
                .post(okhttp3.RequestBody.create(new byte[0]))
                .build();
        try (okhttp3.Response response = tusClient.newCall(request).execute()) {
            if (response.code() != 201)
                throw apiException(response, "Resumable session creation failed.");
            String location = response.header("Location", "");
            if (location.isEmpty()) throw new IOException("Resumable session omitted Location.");
            String resolved = new URL(new URL(endpoint), location).toString();
            if (!PhotoTransferDao.safeTusUrl(resolved))
                throw new IOException("Resumable session returned an untrusted location.");
            return resolved;
        }
    }

    @Override
    public PhotoTransferCoordinator.Head head(String accessToken, PhotoTransfer row)
            throws Exception {
        if (!PhotoTransferDao.safeTusUrl(row.tusUrl))
            throw new IOException("Saved resumable session URL is not trusted.");
        okhttp3.Request request = tusRequest(row.tusUrl, accessToken).head().build();
        try (okhttp3.Response response = tusClient.newCall(request).execute()) {
            if (response.code() == 404 || response.code() == 410)
                return PhotoTransferCoordinator.Head.missing();
            if (response.code() != 200)
                throw apiException(response, "Resumable session reconciliation failed.");
            long offset = requiredLongHeader(response, "Upload-Offset");
            long length = requiredLongHeader(response, "Upload-Length");
            if (offset < 0 || length < 0 || offset > length)
                throw new IOException("Resumable session returned invalid progress.");
            return PhotoTransferCoordinator.Head.present(length, offset);
        }
    }

    @Override
    public long patch(String accessToken, PhotoTransfer row, File prepared, int maxBytes)
            throws Exception {
        if (!PhotoTransferDao.safeTusUrl(row.tusUrl) || maxBytes != PhotoTransferCoordinator.TUS_CHUNK_BYTES)
            throw new IOException("Resumable upload parameters are not trusted.");
        long remaining = row.preparedSize - row.confirmedOffset;
        if (remaining <= 0) return row.confirmedOffset;
        int count = (int) Math.min((long) maxBytes, remaining);
        okhttp3.RequestBody body = new PreparedChunkBody(
                prepared, row.confirmedOffset, count, row.preparedSize);
        okhttp3.Request request = tusRequest(row.tusUrl, accessToken)
                .header("Upload-Offset", Long.toString(row.confirmedOffset))
                .patch(body)
                .build();
        try (okhttp3.Response response = tusClient.newCall(request).execute()) {
            if (response.code() != 204)
                throw apiException(response, "Resumable photo chunk was not confirmed.");
            long offset = requiredLongHeader(response, "Upload-Offset");
            if (offset < row.confirmedOffset || offset > row.preparedSize)
                throw new IOException("Resumable upload returned invalid progress.");
            return offset;
        }
    }

    @Override
    public String verify(String accessToken, PhotoTransfer row) throws Exception {
        JSONObject request = new JSONObject();
        request.put("action_id", row.verificationActionId);
        request.put("photo_id", row.photoId);
        request.put("transfer_version", row.transferVersion);
        return postEdge(accessToken, "verify-private-photo", request);
    }

    private String postEdge(String accessToken, String functionName, JSONObject request)
            throws IOException, ApiException {
        URL url = new URL(SupabaseConfig.PROJECT_URL + "/functions/v1/" + functionName);
        HttpURLConnection connection = open(url);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        addAuthHeaders(connection, accessToken);
        connection.setRequestProperty("Content-Type", "application/json");
        byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload);
        }
        int status = connection.getResponseCode();
        String body = readBody(connection, status);
        long retryAfter = retryDelay(connection.getHeaderField("Retry-After"));
        connection.disconnect();
        if (status < 200 || status >= 300)
            throw new ApiException(status, extractErrorMessage(status, body), retryAfter);
        return body;
    }

    private okhttp3.Request.Builder tusRequest(String url, String accessToken) {
        return new okhttp3.Request.Builder()
                .url(url)
                .header("apikey", SupabaseConfig.PUBLISHABLE_KEY)
                .header("Authorization", "Bearer " + accessToken)
                .header("Tus-Resumable", TUS_VERSION);
    }

    private static String storageOrigin() throws IOException {
        URL project = new URL(SupabaseConfig.PROJECT_URL);
        String host = project.getHost();
        if (!"https".equals(project.getProtocol()) || !host.endsWith(".supabase.co"))
            throw new IOException("Configured Supabase origin is invalid.");
        return "https://" + host.substring(0, host.length() - ".supabase.co".length())
                + ".storage.supabase.co";
    }

    private static String tusMetadata(String key, String value) {
        return key + " " + Base64.getEncoder().encodeToString(
                value.getBytes(StandardCharsets.UTF_8));
    }

    private static long requiredLongHeader(okhttp3.Response response, String name)
            throws IOException {
        String value = response.header(name);
        if (value == null) throw new IOException("Resumable response omitted " + name + ".");
        try { return Long.parseLong(value); }
        catch (NumberFormatException error) {
            throw new IOException("Resumable response had invalid " + name + ".", error);
        }
    }

    private static ApiException apiException(okhttp3.Response response, String fallback)
            throws IOException {
        String body = response.body() == null ? "" : response.body().string();
        String message = extractErrorMessage(response.code(), body);
        if (message.startsWith("Request failed")) message = fallback;
        return new ApiException(response.code(), message,
                retryDelay(response.header("Retry-After")));
    }

    private static final class PreparedChunkBody extends okhttp3.RequestBody {
        private static final okhttp3.MediaType TYPE =
                okhttp3.MediaType.get("application/offset+octet-stream");
        private final File file;
        private final long offset, expectedSize;
        private final int count;

        PreparedChunkBody(File file, long offset, int count, long expectedSize) {
            this.file = file; this.offset = offset; this.count = count;
            this.expectedSize = expectedSize;
        }

        @Override public okhttp3.MediaType contentType() { return TYPE; }
        @Override public long contentLength() { return count; }
        @Override public boolean isOneShot() { return true; }

        @Override public void writeTo(okio.BufferedSink sink) throws IOException {
            if (!file.isFile() || file.length() != expectedSize)
                throw new IOException("Prepared photo changed before upload.");
            try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
                input.seek(offset);
                byte[] buffer = new byte[64 * 1024];
                int remaining = count;
                while (remaining > 0) {
                    int read = input.read(buffer, 0, Math.min(buffer.length, remaining));
                    if (read < 0) throw new IOException("Prepared photo ended during upload.");
                    sink.write(buffer, 0, read);
                    remaining -= read;
                }
            }
            if (file.length() != expectedSize)
                throw new IOException("Prepared photo changed during upload.");
        }
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
