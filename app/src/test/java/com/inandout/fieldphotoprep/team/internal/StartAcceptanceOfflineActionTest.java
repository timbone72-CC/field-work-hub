package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.room.Room;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class StartAcceptanceOfflineActionTest {
    private TeamDatabase db;
    private CachedWorkOrderDao dao;
    private SessionCoordinator sessions;
    private final SupabaseApi.AuthSession owner = OfflineActionTest.session("a", "org");
    private static final String TAP = "2026-10-03T12:00:00Z";
    private static final String RECEIPT = "2026-10-03T12:03:00Z";
    private static final String FILE = "start-accept-restart-test";

    @Before public void setup() {
        Context context = RuntimeEnvironment.getApplication();
        db = Room.inMemoryDatabaseBuilder(context, TeamDatabase.class)
                .allowMainThreadQueries().build();
        dao = db.cachedWorkOrderDao();
        seed();
        context.getSharedPreferences(SecureSessionStore.PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit().clear().commit();
        SecureSessionStore credentials = new SecureSessionStore(context, new SecureSessionStore.Crypto() {
            public byte[] encrypt(byte[] bytes) { return bytes; }
            public byte[] decrypt(byte[] bytes) { return bytes; }
        });
        sessions = new SessionCoordinator(credentials, token -> owner);
        sessions.install(sessions.beginLogin(), owner);
    }

    private void seed() {
        new RoomAssignmentStore(dao).replace(owner, List.of(
                OfflineActionTest.wo("1", "instance-1"),
                OfflineActionTest.wo("2", "instance-2")), 1);
    }

    @After public void close() {
        db.close();
        RuntimeEnvironment.getApplication().deleteDatabase(FILE);
    }

    private FieldAction start(String wo, String time) throws Exception {
        return sessions.create(dao, sessions.generation(), owner, wo, "run-" + wo, "START", time);
    }

    private List<FieldAction> actions(String wo) {
        List<FieldAction> result = new ArrayList<>();
        for (FieldAction action : dao.actions("a", "org"))
            if (action.workOrderId.equals(wo)) result.add(action);
        return result;
    }

    private FieldActionResult receipt(FieldAction action) throws Exception {
        if (!"ACK".equals(action.kind)) return OfflineActionTest.result(action, "IN_PROGRESS");
        return new FieldActionResult(action, new JSONObject()
                .put("action_id", action.actionId).put("outcome", "APPLIED")
                .put("field_status", "ASSIGNED")
                .put("acknowledgment_received_at", RECEIPT)
                .put("accepted_at", RECEIPT).put("server_updated_at", RECEIPT).toString());
    }

    @Test public void startTapSavesDistinctOrderedIntentsAndTruthfulPendingProjection() throws Exception {
        assertTrue(dao.actions("a", "org").isEmpty()); // Download alone never accepts.
        FieldAction started = start("1", TAP);
        List<FieldAction> pair = actions("1");
        assertEquals(2, pair.size());
        assertEquals("ACK", pair.get(0).kind);
        assertEquals("START", pair.get(1).kind);
        assertEquals(started.actionId, pair.get(1).actionId);
        assertNotEquals(pair.get(0).actionId, started.actionId);
        assertTrue(pair.get(0).sequence < started.sequence);
        for (FieldAction action : pair) {
            assertEquals(TAP, action.eventTime);
            assertEquals("instance-1", action.assignmentInstanceId);
            assertEquals("PENDING", action.state);
        }
        SupabaseApi.WorkOrder visible = new RoomAssignmentStore(dao).load(owner).get(0);
        assertTrue(visible.acceptPending);
        assertEquals("START", visible.pendingKind);
        assertEquals("", visible.acknowledgmentReceivedAt);
        assertEquals("ASSIGNED", visible.fieldStatus);
    }

    @Test public void duplicateAndConcurrentStartTapsKeepOnePairAndOriginalTimes() throws Exception {
        ExecutorService threads = Executors.newFixedThreadPool(2);
        try {
            Future<FieldAction> first = threads.submit(() -> start("1", TAP));
            Future<FieldAction> second = threads.submit(() -> start("1", "2026-10-03T12:01:00Z"));
            FieldAction one = first.get(5, TimeUnit.SECONDS), two = second.get(5, TimeUnit.SECONDS);
            assertEquals(one.actionId, two.actionId);
            assertEquals(one.eventTime, two.eventTime);
            assertEquals(2, actions("1").size());
            assertEquals(one.eventTime, actions("1").get(0).eventTime);
        } finally { threads.shutdownNow(); }
    }

    @Test public void earlierExplicitAcceptKeepsItsOwnIdentityAndTime() throws Exception {
        FieldAction ack = dao.createAction(owner, "1", "run-1", "ACK", "2026-10-03T11:59:00Z");
        start("1", TAP);
        assertEquals(2, actions("1").size());
        assertEquals(ack.actionId, actions("1").get(0).actionId);
        assertEquals("2026-10-03T11:59:00Z", actions("1").get(0).eventTime);
    }

    @Test public void confirmedAcceptDoesNotQueueAnotherAck() throws Exception {
        dao.confirmedAckCache("a", "org", "1", "run-1", "instance-1", RECEIPT);
        start("1", TAP);
        assertEquals(1, actions("1").size());
        assertEquals("START", actions("1").get(0).kind);
        assertEquals(RECEIPT, new RoomAssignmentStore(dao).load(owner).get(0).acknowledgmentReceivedAt);
    }

    @Test public void legacyStartReplayAndFinishDoNotBackfillAcceptance() throws Exception {
        FieldAction legacy = dao.createAction(owner, "1", "run-1", "START", TAP);
        assertEquals(legacy.actionId, start("1", "2026-10-03T12:01:00Z").actionId);
        sessions.create(dao, sessions.generation(), owner, "1", "run-1", "COMPLETE", "2026-10-03T12:02:00Z");
        assertEquals(2, actions("1").size());
        assertFalse(new RoomAssignmentStore(dao).load(owner).get(0).acceptPending);
        assertEquals("START", actions("1").get(0).kind);
    }

    @Test public void failedStartInsertRollsBackItsNewAcceptanceToo() {
        db.getOpenHelper().getWritableDatabase().execSQL(
                "CREATE TEMP TRIGGER reject_test_start BEFORE INSERT ON field_actions "
                + "WHEN NEW.kind='START' BEGIN SELECT RAISE(ABORT,'test start insert failure'); END");
        assertThrows(Exception.class, () -> start("1", TAP));
        assertTrue(actions("1").isEmpty());
        assertFalse(new RoomAssignmentStore(dao).load(owner).get(0).acceptPending);
    }

    @Test public void invalidStartPreservesEarlierAckAndDoesNotCreateHalfPair() throws Exception {
        FieldAction earlier = dao.createAction(owner, "1", "run-1", "ACK", TAP);
        db.getOpenHelper().getWritableDatabase().execSQL(
                "UPDATE cached_work_orders SET requirement_snapshot_json='broken' WHERE work_order_id='1'");
        assertThrows(Exception.class, () -> start("1", TAP));
        assertEquals(1, actions("1").size());
        assertEquals(earlier.actionId, actions("1").get(0).actionId);
        assertTrue(actions("2").isEmpty());
        start("2", TAP); // This isolated failure does not stop unrelated work.
        assertEquals(2, actions("2").size());
    }

    @Test public void freshPairSurvivesDatabaseReopenWithOriginalIds() throws Exception {
        db.close();
        Context context = RuntimeEnvironment.getApplication();
        context.deleteDatabase(FILE);
        db = Room.databaseBuilder(context, TeamDatabase.class, FILE).allowMainThreadQueries().build();
        dao = db.cachedWorkOrderDao();
        seed();
        FieldAction started = start("1", TAP);
        String ack = actions("1").get(0).actionId;
        db.close();
        db = Room.databaseBuilder(context, TeamDatabase.class, FILE).allowMainThreadQueries().build();
        dao = db.cachedWorkOrderDao();
        assertEquals(2, actions("1").size());
        assertEquals(ack, actions("1").get(0).actionId);
        assertEquals(started.actionId, start("1", "2026-10-03T12:01:00Z").actionId);
        assertTrue(new RoomAssignmentStore(dao).load(owner).get(0).acceptPending);
    }

    @Test public void staleSessionAndWrongOwnerCannotCreateEitherIntent() {
        long stale = sessions.generation();
        sessions.signOut();
        assertThrows(SessionCoordinator.SessionChanged.class,
                () -> sessions.create(dao, stale, owner, "1", "run-1", "START", TAP));
        assertThrows(IllegalStateException.class,
                () -> dao.startAndAccept(OfflineActionTest.session("b", "org"), "1", "run-1", TAP));
        assertTrue(dao.actions("a", "org").isEmpty());
        assertTrue(dao.actions("b", "org").isEmpty());
    }

    @Test public void reassignedPairStaysWithOldInstanceAndBlocksFurtherStart() throws Exception {
        start("1", TAP);
        new RoomAssignmentStore(dao).replace(owner,
                List.of(OfflineActionTest.wo("1", "replacement-instance")), 2);
        for (FieldAction action : actions("1")) {
            assertEquals("CONFLICT", action.state);
            assertEquals("instance-1", action.assignmentInstanceId);
        }
        assertThrows(IllegalStateException.class, () -> start("1", TAP));
        assertEquals(2, actions("1").size());
    }

    @Test public void lostAckResponseRetriesSameIdBeforeStartAndAllowsOtherJob() throws Exception {
        start("1", TAP);
        start("2", TAP);
        FieldAction ack = actions("1").get(0), started = actions("1").get(1);
        List<String> sent = new ArrayList<>();
        AtomicBoolean loseResponse = new AtomicBoolean(true);
        ActionSyncCoordinator sync = new ActionSyncCoordinator(dao, sessions, (token, action) -> {
            sent.add(action.actionId);
            if (action.actionId.equals(ack.actionId) && loseResponse.getAndSet(false))
                throw new java.io.IOException("ACK response lost");
            return receipt(action);
        });
        assertEquals(ActionSyncCoordinator.Outcome.RETRY, sync.drain("a", "org", () -> false));
        assertFalse(sent.contains(started.actionId));
        assertEquals("ACCEPTED", dao.action(actions("2").get(1).actionId).state);
        assertEquals(ActionSyncCoordinator.Outcome.DONE, sync.drain("a", "org", () -> false));
        assertEquals(2, Collections.frequency(sent, ack.actionId));
        assertEquals(1, Collections.frequency(sent, started.actionId));
        assertEquals(ack.actionId, sent.get(sent.size() - 2));
        assertEquals(started.actionId, sent.get(sent.size() - 1));
        assertEquals(RECEIPT, new RoomAssignmentStore(dao).load(owner).get(0).acknowledgmentReceivedAt);
        assertEquals("IN_PROGRESS", new RoomAssignmentStore(dao).load(owner).get(0).fieldStatus);
        int count = sent.size();
        assertEquals(ActionSyncCoordinator.Outcome.DONE, sync.drain("a", "org", () -> false));
        assertEquals(count, sent.size());
    }

    @Test public void rejectedAckBlocksDependentStartWithoutBlockingOtherJob() throws Exception {
        start("1", TAP);
        start("2", TAP);
        List<String> sent = new ArrayList<>();
        ActionSyncCoordinator sync = new ActionSyncCoordinator(dao, sessions, (token, action) -> {
            sent.add(action.actionId);
            return action.workOrderId.equals("1")
                    ? new FieldActionResult(action, new JSONObject().put("action_id", action.actionId)
                        .put("outcome", "CONFLICT").put("reason", "ASSIGNMENT_CHANGED").toString())
                    : receipt(action);
        });
        assertEquals(ActionSyncCoordinator.Outcome.DONE, sync.drain("a", "org", () -> false));
        assertFalse(sent.contains(actions("1").get(1).actionId));
        assertEquals("CONFLICT", actions("1").get(1).state);
        assertEquals("ACCEPTED", actions("2").get(1).state);
    }
}
