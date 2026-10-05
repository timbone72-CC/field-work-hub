package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

@Database(
        entities = {CachedWorkOrder.class, FieldAction.class, ProtectedPhoto.class},
        version = 3,
        exportSchema = true)
abstract class TeamDatabase extends RoomDatabase {
    static final androidx.room.migration.Migration MIGRATION_1_2 =
            new androidx.room.migration.Migration(1, 2) {
                @Override
                public void migrate(androidx.sqlite.db.SupportSQLiteDatabase db) {
                    db.execSQL(
                            "ALTER TABLE cached_work_orders ADD COLUMN assignment_instance_id TEXT"
                                + " NOT NULL DEFAULT ''");
                    db.execSQL(
                            "ALTER TABLE cached_work_orders ADD COLUMN conflict_reason TEXT NOT"
                                + " NULL DEFAULT ''");
                    db.execSQL(
                            "CREATE TABLE IF NOT EXISTS field_actions (actionId TEXT NOT NULL"
                                + " PRIMARY KEY,ownerId TEXT NOT NULL,organizationId TEXT NOT"
                                + " NULL,workOrderId TEXT NOT NULL,runId TEXT NOT"
                                + " NULL,assignmentInstanceId TEXT NOT NULL,kind TEXT NOT"
                                + " NULL,eventTime TEXT NOT NULL,createdAt INTEGER NOT"
                                + " NULL,sequence INTEGER NOT NULL,state TEXT NOT NULL,attempts"
                                + " INTEGER NOT NULL,retryNotBefore INTEGER NOT NULL,reason TEXT"
                                + " NOT NULL,claimId TEXT NOT NULL,claimGeneration INTEGER NOT"
                                + " NULL,canonicalStatus TEXT NOT NULL,canonicalStartedAt TEXT NOT"
                                + " NULL,canonicalCompletedAt TEXT NOT NULL,serverUpdatedAt TEXT"
                                + " NOT NULL,acceptedAt TEXT NOT NULL)");
                    db.execSQL(
                            "CREATE UNIQUE INDEX IF NOT EXISTS"
                                + " index_field_actions_ownerId_organizationId_workOrderId_runId_assignmentInstanceId_kind"
                                + " ON field_actions(ownerId,organizationId,workOrderId,runId,assignmentInstanceId,kind)");
                    db.execSQL(
                            "CREATE INDEX IF NOT EXISTS"
                                + " index_field_actions_ownerId_organizationId_sequence ON"
                                + " field_actions(ownerId,organizationId,sequence)");
                }
            };
    static final androidx.room.migration.Migration MIGRATION_2_3 =
            new androidx.room.migration.Migration(2, 3) {
                @Override public void migrate(androidx.sqlite.db.SupportSQLiteDatabase db) {
                    db.execSQL("ALTER TABLE field_actions ADD COLUMN requirementRevision TEXT NOT NULL DEFAULT ''");
                    db.execSQL("ALTER TABLE field_actions ADD COLUMN finishSetId TEXT NOT NULL DEFAULT ''");
                    db.execSQL("ALTER TABLE field_actions ADD COLUMN finishPhotosJson TEXT NOT NULL DEFAULT ''");
                    db.execSQL("ALTER TABLE field_actions ADD COLUMN finishDigest TEXT NOT NULL DEFAULT ''");
                    db.execSQL("CREATE TABLE IF NOT EXISTS protected_photos (id TEXT NOT NULL PRIMARY KEY,ownerId TEXT NOT NULL,organizationId TEXT NOT NULL,workOrderId TEXT NOT NULL,runId TEXT NOT NULL,assignmentInstanceId TEXT NOT NULL,requirementRevision TEXT NOT NULL,itemId TEXT NOT NULL,capturedAt TEXT NOT NULL,originalPath TEXT NOT NULL,preparedPath TEXT NOT NULL,state TEXT NOT NULL,problem TEXT NOT NULL,finishSetId TEXT NOT NULL,originalBytes INTEGER NOT NULL,prepared INTEGER NOT NULL)");
                    db.execSQL("CREATE INDEX IF NOT EXISTS index_protected_photos_ownerId_organizationId_workOrderId_runId ON protected_photos(ownerId,organizationId,workOrderId,runId)");
                }
            };
    private static volatile TeamDatabase instance;

    abstract CachedWorkOrderDao cachedWorkOrderDao();

    static TeamDatabase getInstance(Context context) {
        TeamDatabase current = instance;
        if (current != null) {
            return current;
        }
        synchronized (TeamDatabase.class) {
            current = instance;
            if (current == null) {
                current =
                        Room.databaseBuilder(
                                        context.getApplicationContext(),
                                        TeamDatabase.class,
                                        "field-photo-prep-team.db")
                                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                                .build();
                instance = current;
            }
        }
        return current;
    }
}
