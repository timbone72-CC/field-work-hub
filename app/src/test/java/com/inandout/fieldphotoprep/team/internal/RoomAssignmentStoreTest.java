package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import androidx.room.Room;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public final class RoomAssignmentStoreTest {
    private final Context context = RuntimeEnvironment.getApplication();
    private final String databaseName = "room-assignment-" + UUID.randomUUID() + ".db";
    private TeamDatabase database;

    @After
    public void tearDown() {
        if (database != null) {
            database.close();
        }
        context.deleteDatabase(databaseName);
    }

    @Test
    public void multipleAssignmentsSurviveDatabaseCloseAndReopen() {
        SupabaseApi.AuthSession session = session("user-a", "org-a");
        openDatabase();
        RoomAssignmentStore store = new RoomAssignmentStore(database.cachedWorkOrderDao());
        store.replace(
                session,
                Arrays.asList(
                        workOrder("wo-1", "run-1", "WO-1", "user-a", "org-a"),
                        workOrder("wo-2", "run-2", "WO-2", "user-a", "org-a")),
                1234L);
        database.close();
        database = null;

        openDatabase();
        RoomAssignmentStore reopened = new RoomAssignmentStore(database.cachedWorkOrderDao());
        List<SupabaseApi.WorkOrder> loaded = reopened.load(session);

        assertEquals(2, loaded.size());
        assertEquals("wo-1", loaded.get(0).id);
        assertEquals("wo-2", loaded.get(1).id);
    }

    @Test
    public void cacheIsIsolatedByAuthenticatedOwnerAndOrganization() {
        SupabaseApi.AuthSession userA = session("user-a", "org-a");
        SupabaseApi.AuthSession userB = session("user-b", "org-a");
        openDatabase();
        RoomAssignmentStore store = new RoomAssignmentStore(database.cachedWorkOrderDao());

        store.replace(
                userA,
                Collections.singletonList(workOrder("wo-a", "run-a", "WO-A", "user-a", "org-a")),
                1L);
        store.replace(
                userB,
                Collections.singletonList(workOrder("wo-b", "run-b", "WO-B", "user-b", "org-a")),
                2L);

        assertEquals(1, store.load(userA).size());
        assertEquals("wo-a", store.load(userA).get(0).id);
        assertEquals(1, store.load(userB).size());
        assertEquals("wo-b", store.load(userB).get(0).id);
    }

    @Test
    public void replacingOneUsersSnapshotDoesNotEraseAnotherUsersCache() {
        SupabaseApi.AuthSession userA = session("user-a", "org-a");
        SupabaseApi.AuthSession userB = session("user-b", "org-a");
        openDatabase();
        RoomAssignmentStore store = new RoomAssignmentStore(database.cachedWorkOrderDao());

        store.replace(
                userA,
                Collections.singletonList(workOrder("wo-a", "run-a", "WO-A", "user-a", "org-a")),
                1L);
        store.replace(
                userB,
                Collections.singletonList(workOrder("wo-b", "run-b", "WO-B", "user-b", "org-a")),
                2L);
        store.replace(userA, Collections.emptyList(), 3L);

        assertEquals(0, store.load(userA).size());
        assertEquals(1, store.load(userB).size());
        assertEquals("wo-b", store.load(userB).get(0).id);
    }

    @Test
    public void completedRunWithProtectedPhotoDoesNotBlockFreshFollowUpAssignment() {
        SupabaseApi.AuthSession user = session("user-a", "org-a");
        openDatabase();
        RoomAssignmentStore store = new RoomAssignmentStore(database.cachedWorkOrderDao());

        SupabaseApi.WorkOrder original = new SupabaseApi.WorkOrder(
                "wo-1", "org-a", "run-1", 1, "TEST-0003-DASHBOARD",
                "300 Test Property Rd", "Inspection", "Original instructions",
                "2026-09-14", "FIELD_COMPLETE", "user-a", "", "",
                "2026-09-14T12:00:00Z", "2026-09-14T12:01:00Z",
                "2026-09-14T12:02:00Z", "2026-09-14T12:03:00Z");
        original.assignmentInstanceId = "original-instance";
        store.replace(user, Collections.singletonList(original), 1L);

        ProtectedPhoto savedPhoto = new ProtectedPhoto(
                "photo-original", "user-a", "org-a", "wo-1", "run-1",
                "original-instance", "", "", "2026-09-14T12:01:30Z",
                "/private/original.jpg", "/private/prepared.jpg");
        savedPhoto.state = "WAITING";
        database.cachedWorkOrderDao().insertPhoto(savedPhoto);

        SupabaseApi.WorkOrder followUp = new SupabaseApi.WorkOrder(
                "wo-1", "org-a", "run-2", 2, "TEST-0003-DASHBOARD",
                "300 Test Property Rd", "Inspection", "Take one new photo",
                "2026-10-16", "ASSIGNED", "user-a", "", "",
                "2026-10-14T16:10:00Z", "", "", "2026-10-14T16:10:00Z");
        followUp.assignmentInstanceId = "fresh-instance";
        followUp.requirementSnapshotJson = "{\"schema\":1,\"revision\":\"11111111-1111-4111-8111-111111111111\","
                + "\"total\":{\"enabled\":true,\"minimum\":1},\"items\":[]}";

        store.replace(user, Collections.singletonList(followUp), 2L);
        List<SupabaseApi.WorkOrder> firstRefresh = store.load(user);
        assertEquals(2, firstRefresh.size());
        SupabaseApi.WorkOrder prior = firstRefresh.stream()
                .filter(row -> "run-1".equals(row.currentRunId)).findFirst().orElseThrow();
        SupabaseApi.WorkOrder current = firstRefresh.stream()
                .filter(row -> "run-2".equals(row.currentRunId)).findFirst().orElseThrow();
        assertEquals("original-instance", prior.assignmentInstanceId);
        assertEquals("FIELD_COMPLETE", prior.fieldStatus);
        assertEquals("ASSIGNMENT_UNAVAILABLE", prior.conflictReason);
        assertEquals("fresh-instance", current.assignmentInstanceId);
        assertEquals("ASSIGNED", current.fieldStatus);
        assertEquals("2026-10-16", current.dueDate);
        assertEquals("", current.conflictReason);
        assertEquals(1, PhotoRequirements.parse(current.requirementSnapshotJson).minimumUnique);
        assertEquals(1, database.cachedWorkOrderDao()
                .photos("user-a", "org-a", "wo-1", "run-1").size());
        assertEquals(0, database.cachedWorkOrderDao()
                .photos("user-a", "org-a", "wo-1", "run-2").size());

        FieldAction accepted = database.cachedWorkOrderDao()
                .createAction(user, "wo-1", "run-2", "ACK", "2026-10-14T16:15:00Z");
        assertEquals("fresh-instance", accepted.assignmentInstanceId);
        store.replace(user, Collections.singletonList(followUp), 3L);
        assertEquals(2, store.load(user).size());
        assertEquals("PENDING", database.cachedWorkOrderDao().action(accepted.actionId).state);
        database.close();
        database = null;

        openDatabase();
        assertEquals(2, new RoomAssignmentStore(database.cachedWorkOrderDao())
                .load(user).size());
        assertEquals(1, database.cachedWorkOrderDao()
                .photos("user-a", "org-a", "wo-1", "run-1").size());
    }

    private void openDatabase() {
        database = Room.databaseBuilder(context, TeamDatabase.class, databaseName)
                .allowMainThreadQueries()
                .build();
    }

    private static SupabaseApi.AuthSession session(String userId, String organizationId) {
        return new SupabaseApi.AuthSession(
                "access",
                "refresh",
                userId,
                userId + "@example.invalid",
                "CONTRACTOR",
                organizationId,
                0L);
    }

    private static SupabaseApi.WorkOrder workOrder(
            String workOrderId,
            String runId,
            String woNumber,
            String assignedUserId,
            String organizationId) {
        return new SupabaseApi.WorkOrder(
                workOrderId,
                organizationId,
                runId,
                1,
                woNumber,
                "100 Test Rd",
                "Inspection",
                "Test instructions",
                "2026-09-16",
                "ASSIGNED",
                assignedUserId,
                "",
                "",
                "2026-09-15T12:00:00Z",
                "",
                "",
                "2026-09-15T12:00:00Z");
    }
}
