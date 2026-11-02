package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import androidx.room.Room;

import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class OfflineActionTest {
    TeamDatabase db;
    CachedWorkOrderDao dao;
    RoomAssignmentStore store;
    final SupabaseApi.AuthSession a = session("a", "org"), b = session("b", "org");

    @Before
    public void setup() {
        db =
                Room.inMemoryDatabaseBuilder(
                                RuntimeEnvironment.getApplication(), TeamDatabase.class)
                        .allowMainThreadQueries()
                        .build();
        dao = db.cachedWorkOrderDao();
        store = new RoomAssignmentStore(dao);
        store.replace(a, List.of(wo("1", "instance-a"), wo("2", "instance-b")), 1);
    }

    @After
    public void close() {
        db.close();
    }

    @Test
    public void repeatTapsAndOrderingPreserveOriginalPayload() {
        FieldAction start = dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z");
        FieldAction repeated = dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:01:00Z");
        FieldAction finish = dao.createAction(a, "1", "run-1", "COMPLETE", "2026-10-03T12:02:00Z");
        assertEquals(start.actionId, repeated.actionId);
        assertEquals("2026-10-03T12:00:00Z", repeated.eventTime);
        assertTrue(start.sequence < finish.sequence);
        assertEquals(2, dao.actions("a", "org").size());
        assertEquals("COMPLETE", store.load(a).get(0).pendingKind);
        assertEquals(0, store.load(b).size());
    }

    @Test
    public void explicitAckIsOneDurableInstanceActionAndDoesNotPretendStart() throws Exception {
        FieldAction ack=dao.createAction(a,"1","run-1","ACK","2026-10-11T10:30:00Z");
        FieldAction repeat=dao.createAction(a,"1","run-1","ACK","2026-10-11T10:31:00Z");
        assertEquals(ack.actionId,repeat.actionId);
        assertEquals("2026-10-11T10:30:00Z",repeat.eventTime);
        assertEquals("ACK",ack.kind);
        assertEquals("",ack.requirementRevision);
        assertEquals("ASSIGNED",store.load(a).get(0).fieldStatus);
        assertTrue(store.load(a).get(0).acceptPending);
        assertEquals("",store.load(a).get(0).pendingKind);
        FieldAction start=dao.createAction(a,"1","run-1","START","2026-10-11T10:31:00Z");
        assertTrue(ack.sequence<start.sequence);
        dao.claim(ack.actionId,"ack-claim",7);
        FieldActionResult confirmed=new FieldActionResult(ack,new org.json.JSONObject()
            .put("action_id",ack.actionId).put("outcome","APPLIED")
            .put("field_status","ASSIGNED")
            .put("acknowledgment_received_at","2026-10-11T10:32:00Z")
            .put("accepted_at","2026-10-11T10:32:00Z")
            .put("server_updated_at","2026-10-11T10:32:00Z").toString());
        dao.accept(ack.actionId,"ack-claim",7,confirmed);
        assertEquals("ACCEPTED",dao.action(ack.actionId).state);
        assertEquals("2026-10-11T10:32:00Z",store.load(a).get(0).acknowledgmentReceivedAt);
        assertEquals("ASSIGNED",store.load(a).get(0).fieldStatus);
        assertFalse(store.load(a).get(0).acceptPending);
        assertEquals("START",store.load(a).get(0).pendingKind);
        assertEquals(0,store.load(b).size());
        // A stale server snapshot cannot erase this phone's confirmed ACK.
        store.replace(a,List.of(wo("1","instance-a"),wo("2","instance-b")),2);
        assertEquals("2026-10-11T10:32:00Z",store.load(a).get(0).acknowledgmentReceivedAt);
    }

    @Test
    public void offlineAckChangesRunOnlyAsProtectedConflictNotSilentRebind() {
        FieldAction ack=dao.createAction(a,"1","run-1","ACK","2026-10-11T10:30:00Z");
        store.replace(a,List.of(wo("1","new-instance"),wo("2","instance-b")),2);
        assertEquals("instance-a",store.load(a).get(0).assignmentInstanceId);
        assertEquals("CONFLICT",dao.action(ack.actionId).state);
        assertFalse(store.load(a).get(0).conflictReason.isEmpty());
        assertThrows(IllegalStateException.class,
            ()->dao.createAction(a,"1","run-1","ACK","2026-10-11T10:33:00Z"));
    }

    @Test
    public void unboundMigratedCacheAndWrongOwnerCannotCreateAction() {
        SupabaseApi.WorkOrder unbound = wo("1", "");
        store.replace(a, List.of(unbound), 1);
        assertThrows(
                IllegalStateException.class,
                () -> dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z"));
        assertThrows(
                IllegalStateException.class,
                () -> dao.createAction(b, "1", "run-1", "START", "2026-10-03T12:00:00Z"));
        assertEquals(0, dao.actions("a", "org").size());
    }

    @Test
    public void backwardClockDoesNotInventFinishTime() {
        dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z");
        assertThrows(
                IllegalStateException.class,
                () -> dao.createAction(a, "1", "run-1", "COMPLETE", "2026-10-03T11:59:59Z"));
        assertEquals(1, dao.actions("a", "org").size());
    }

    @Test
    public void refreshKeepsActionsAndEvictsOnlyUntouchedRows() {
        FieldAction action = dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z");
        store.replace(a, Collections.emptyList(), 2);
        assertEquals(1, store.load(a).size());
        assertFalse(store.load(a).get(0).conflictReason.isEmpty());
        assertEquals(action.actionId, dao.actions("a", "org").get(0).actionId);
        assertEquals("CONFLICT", dao.actions("a", "org").get(0).state);
    }

    @Test
    public void reassignBackCannotBindOldIntentToNewInstance() {
        dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z");
        store.replace(a, List.of(wo("1", "instance-returned"), wo("2", "instance-b")), 2);
        assertEquals("instance-a", store.load(a).get(0).assignmentInstanceId);
        assertFalse(store.load(a).get(0).conflictReason.isEmpty());
        assertThrows(
                IllegalStateException.class,
                () -> dao.createAction(a, "1", "run-1", "COMPLETE", "2026-10-03T12:01:00Z"));
    }

    @Test
    public void interruptedClaimsRecoverSameUuidAndPayload() {
        FieldAction a1 = dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z");
        dao.claim(a1.actionId, "claim", 7);
        dao.recoverClaims("a", "org");
        FieldAction recovered = dao.action(a1.actionId);
        assertEquals("PENDING", recovered.state);
        assertEquals(a1.eventTime, recovered.eventTime);
        assertEquals(1, recovered.attempts);
    }

    @Test
    public void staleSnapshotDoesNotRollBackAcceptedState() throws Exception {
        FieldAction start = dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z");
        dao.claim(start.actionId, "claim", 7);
        dao.accept(start.actionId, "claim", 7, result(start, "IN_PROGRESS"));
        store.replace(a, List.of(wo("1", "instance-a"), wo("2", "instance-b")), 3);
        assertEquals("IN_PROGRESS", store.load(a).get(0).fieldStatus);
        assertEquals("ACCEPTED", dao.action(start.actionId).state);
        assertEquals("", store.load(a).get(0).conflictReason);
    }

    @Test
    public void nonmatchingClaimCannotFinalizeAndConflictRetainsFinish() throws Exception {
        FieldAction start = dao.createAction(a, "1", "run-1", "START", "2026-10-03T12:00:00Z");
        FieldAction finish = dao.createAction(a, "1", "run-1", "COMPLETE", "2026-10-03T12:01:00Z");
        dao.claim(start.actionId, "claim", 7);
        dao.accept(start.actionId, "other", 7, result(start, "IN_PROGRESS"));
        assertEquals("SYNCING", dao.action(start.actionId).state);
        dao.accept(
                start.actionId,
                "claim",
                7,
                new FieldActionResult(
                        start,
                        "{\"action_id\":\""
                                + start.actionId
                                + "\",\"outcome\":\"CONFLICT\",\"reason\":\"ASSIGNMENT_CHANGED\"}"));
        assertEquals("CONFLICT", dao.action(finish.actionId).state);
        assertEquals(2, dao.actions("a", "org").size());
    }

    static FieldActionResult result(FieldAction action, String status) throws Exception {
        return new FieldActionResult(
                action,
                new org.json.JSONObject()
                        .put("action_id", action.actionId)
                        .put("outcome", "APPLIED")
                        .put("field_status", status)
                        .put("started_at", "2026-10-03T12:00:00Z")
                        .put(
                                "field_completed_at",
                                "FIELD_COMPLETE".equals(status) ? "2026-10-03T12:01:00Z" : "")
                        .put("server_updated_at", "2026-10-03T12:03:00Z")
                        .put("accepted_at", "2026-10-03T12:03:00Z")
                        .toString());
    }

    static SupabaseApi.AuthSession session(String user, String org) {
        return new SupabaseApi.AuthSession(
                "access",
                "refresh",
                user,
                "test@example.invalid",
                "CONTRACTOR",
                org,
                Long.MAX_VALUE);
    }

    static SupabaseApi.WorkOrder wo(String id, String instance) {
        SupabaseApi.WorkOrder w =
                new SupabaseApi.WorkOrder(
                        id,
                        "org",
                        "run-" + id,
                        1,
                        "WO-" + id,
                        "Test address",
                        "Inspection",
                        "",
                        "2026-10-03",
                        "ASSIGNED",
                        "a",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "2026-10-03T11:00:00Z");
        w.assignmentInstanceId = instance;
        return w;
    }
}
