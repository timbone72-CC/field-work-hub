package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;

import androidx.room.Room;

import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.nio.charset.StandardCharsets;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class RoomMigrationTest {
    @Test
    public void realV1SchemaUpgradesPreservingTwoOwnersAndRestartedQueue() throws Exception {
        verifyUpgrade("ASSIGNED", "START");
    }

    @Test
    public void legacyStartedWorkAcquiresConfirmedIdentityAndCanFinishAfterUpgrade() throws Exception {
        verifyUpgrade("IN_PROGRESS", "COMPLETE");
    }

    @Test
    public void legacyCompletedWorkAcquiresIdentityWithoutInventingConflict() throws Exception {
        verifyUpgrade("FIELD_COMPLETE", null);
    }

    @Test public void realV2AcceptedActionsSurviveV3WithoutInventingPhotoIntent() throws Exception {
        Context context=RuntimeEnvironment.getApplication();String name="migration-v2-photos.db";context.deleteDatabase(name);
        java.io.InputStream resource=getClass().getResourceAsStream("/com.inandout.fieldphotoprep.team.internal.TeamDatabase/2.json");assertNotNull(resource);
        JSONObject schema=new JSONObject(new String(resource.readAllBytes(),StandardCharsets.UTF_8)).getJSONObject("database");
        try(SQLiteDatabase old=context.openOrCreateDatabase(name,Context.MODE_PRIVATE,null)) {
            JSONArray entities=schema.getJSONArray("entities");
            for(int n=0;n<entities.length();n++){
                JSONObject entity=entities.getJSONObject(n);String table=entity.getString("tableName");old.execSQL(entity.getString("createSql").replace("${TABLE_NAME}",table));
                JSONArray indices=entity.getJSONArray("indices");for(int i=0;i<indices.length();i++)old.execSQL(indices.getJSONObject(i).getString("createSql").replace("${TABLE_NAME}",table));
                if("field_actions".equals(table)){
                    android.content.ContentValues values=new android.content.ContentValues();JSONArray fields=entity.getJSONArray("fields");
                    for(int i=0;i<fields.length();i++){JSONObject field=fields.getJSONObject(i);if("INTEGER".equals(field.getString("affinity")))values.put(field.getString("columnName"),1);else values.put(field.getString("columnName"),"");}
                    values.put("actionId","accepted-v2");values.put("ownerId","a");values.put("organizationId","org");values.put("workOrderId","1");values.put("runId","run-1");values.put("assignmentInstanceId","instance");values.put("kind","START");values.put("state","ACCEPTED");values.put("eventTime","2026-10-03T12:00:00Z");
                    old.insertOrThrow(table,null,values);
                }
            }
            JSONArray setup=schema.getJSONArray("setupQueries");for(int n=0;n<setup.length();n++)old.execSQL(setup.getString(n));old.setVersion(2);
        }
        TeamDatabase upgraded=Room.databaseBuilder(context,TeamDatabase.class,name).addMigrations(TeamDatabase.MIGRATION_1_2,TeamDatabase.MIGRATION_2_3).allowMainThreadQueries().build();
        FieldAction accepted=upgraded.cachedWorkOrderDao().action("accepted-v2");assertEquals("ACCEPTED",accepted.state);assertEquals("2026-10-03T12:00:00Z",accepted.eventTime);
        assertEquals("",accepted.requirementRevision);assertEquals("",accepted.finishSetId);assertEquals("",accepted.finishDigest);assertTrue(upgraded.cachedWorkOrderDao().allPhotos().isEmpty());
        upgraded.close();context.deleteDatabase(name);
    }

    private void verifyUpgrade(String state, String actionKind) throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        String name = "migration-test.db";
        context.deleteDatabase(name);
        java.io.InputStream stream =
                getClass()
                        .getResourceAsStream(
                                "/com.inandout.fieldphotoprep.team.internal.TeamDatabase/1.json");
        assertNotNull(stream);
        JSONObject schema =
                new JSONObject(new String(stream.readAllBytes(), StandardCharsets.UTF_8))
                        .getJSONObject("database");
        try (SQLiteDatabase old = context.openOrCreateDatabase(name, Context.MODE_PRIVATE, null)) {
            JSONArray entities = schema.getJSONArray("entities");
            for (int i = 0; i < entities.length(); i++) {
                JSONObject entity = entities.getJSONObject(i);
                old.execSQL(
                        entity.getString("createSql")
                                .replace("${TABLE_NAME}", entity.getString("tableName")));
                JSONArray indices = entity.getJSONArray("indices");
                for (int j = 0; j < indices.length(); j++)
                    old.execSQL(
                            indices.getJSONObject(j)
                                    .getString("createSql")
                                    .replace("${TABLE_NAME}", entity.getString("tableName")));
            }
            JSONArray setup = schema.getJSONArray("setupQueries");
            for (int i = 0; i < setup.length(); i++) old.execSQL(setup.getString(i));
            for (String user : new String[] {"a", "b"}) {
                android.content.ContentValues row = new android.content.ContentValues();
                JSONArray fields = entities.getJSONObject(0).getJSONArray("fields");
                for (int i = 0; i < fields.length(); i++) {
                    JSONObject f = fields.getJSONObject(i);
                    if ("INTEGER".equals(f.getString("affinity")))
                        row.put(f.getString("columnName"), 1);
                    else row.put(f.getString("columnName"), "");
                }
                row.put("cache_owner_user_id", user);
                row.put("organization_id", "org");
                row.put("work_order_id", "1");
                row.put("run_id", "run-1");
                row.put("assigned_user_id", user);
                row.put("field_status", user.equals("a") ? state : "ASSIGNED");
                if (user.equals("a") && !state.equals("ASSIGNED")) {
                    row.put("started_at", "2026-10-03T11:00:00Z");
                    if (state.equals("FIELD_COMPLETE"))
                        row.put("field_completed_at", "2026-10-03T11:01:00Z");
                }
                row.put("wo_number", "WO-1");
                row.put("requirement_snapshot_json", "{}");
                old.insertOrThrow("cached_work_orders", null, row);
            }
            old.setVersion(1);
        }
        TeamDatabase upgraded =
                Room.databaseBuilder(context, TeamDatabase.class, name)
                        .addMigrations(TeamDatabase.MIGRATION_1_2, TeamDatabase.MIGRATION_2_3)
                        .allowMainThreadQueries()
                        .build();
        assertEquals(1, upgraded.cachedWorkOrderDao().listForOwner("a", "org").size());
        assertEquals(1, upgraded.cachedWorkOrderDao().listForOwner("b", "org").size());
        assertEquals(
                "",
                upgraded.cachedWorkOrderDao().find("a", "org", "1", "run-1").assignmentInstanceId);
        assertThrows(
                IllegalStateException.class,
                () ->
                        upgraded.cachedWorkOrderDao()
                                .createAction(
                                        OfflineActionTest.session("a", "org"),
                                        "1",
                                        "run-1",
                                        "START",
                                        "2026-10-03T12:00:00Z"));
        new RoomAssignmentStore(upgraded.cachedWorkOrderDao())
                .replace(
                        OfflineActionTest.session("a", "org"),
                        java.util.List.of(snapshot(state)),
                        1);
        CachedWorkOrder refreshed = upgraded.cachedWorkOrderDao().find("a", "org", "1", "run-1");
        assertEquals("instance", refreshed.assignmentInstanceId);
        assertEquals("", refreshed.conflictReason);
        assertEquals(state, refreshed.fieldStatus);
        FieldAction action = actionKind == null ? null : upgraded.cachedWorkOrderDao().createAction(
                OfflineActionTest.session("a", "org"), "1", "run-1", actionKind,
                "2026-10-03T12:00:00Z");
        upgraded.close();
        TeamDatabase reopened =
                Room.databaseBuilder(context, TeamDatabase.class, name)
                        .addMigrations(TeamDatabase.MIGRATION_1_2, TeamDatabase.MIGRATION_2_3)
                        .allowMainThreadQueries()
                        .build();
        assertEquals("", reopened.cachedWorkOrderDao().find("a", "org", "1", "run-1").conflictReason);
        if (action != null) {
            assertEquals(action.eventTime, reopened.cachedWorkOrderDao().action(action.actionId).eventTime);
            assertEquals("PENDING", reopened.cachedWorkOrderDao().action(action.actionId).state);
        } else assertEquals(0, reopened.cachedWorkOrderDao().actions("a", "org").size());
        assertEquals(1, reopened.cachedWorkOrderDao().listForOwner("b", "org").size());
        reopened.close();
        context.deleteDatabase(name);
    }

    private static SupabaseApi.WorkOrder snapshot(String state) {
        SupabaseApi.WorkOrder work = new SupabaseApi.WorkOrder(
                "1", "org", "run-1", 1, "WO-1", "Test address", "Inspection", "",
                "2026-10-03", state, "a", "", "", "",
                state.equals("ASSIGNED") ? "" : "2026-10-03T11:00:00Z",
                state.equals("FIELD_COMPLETE") ? "2026-10-03T11:01:00Z" : "",
                "2026-10-03T11:02:00Z");
        work.assignmentInstanceId = "instance";
        return work;
    }
}
