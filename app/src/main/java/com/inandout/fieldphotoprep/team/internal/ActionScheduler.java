package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;

import androidx.work.*;

import java.util.concurrent.TimeUnit;

/** Identity-only, one-time requests. Queue evidence never lives in WorkManager input/output. */
final class ActionScheduler {
    static final String TAG = "fwh-field-actions";
    private final Context context;
    private final CachedWorkOrderDao dao;

    ActionScheduler(Context context, CachedWorkOrderDao dao) {
        this.context = context.getApplicationContext();
        this.dao = dao;
    }

    static String workName(String owner, String org) {
        return "fwh-field-actions/" + owner + "/" + org;
    }

    static OneTimeWorkRequest request(String owner, String org) {
        return new OneTimeWorkRequest.Builder(FieldActionWorker.class)
                .setInputData(
                        new Data.Builder().putString("owner", owner).putString("org", org).build())
                .setConstraints(
                        new Constraints.Builder()
                                .setRequiredNetworkType(NetworkType.CONNECTED)
                                .build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(TAG)
                .build();
    }

    boolean ensure(SupabaseApi.AuthSession session) {
        if (!BuildConfig.FIELD_SYNC_ENABLED) {
            cancel(session.userId, session.organizationId);
            return true;
        }
        boolean pending = false;
        for (FieldAction a : dao.actions(session.userId, session.organizationId))
            if (("PENDING".equals(a.state) || "SYNCING".equals(a.state))
                    && !a.reason.startsWith("PROTOCOL")) {
                pending = true;
                break;
            }
        if (!pending && dao.unstagedAcceptedPhotos(session.userId, session.organizationId) == 0) return true;
        try {
            WorkManager.getInstance(context)
                    .enqueueUniqueWork(
                            workName(session.userId, session.organizationId),
                            ExistingWorkPolicy.APPEND_OR_REPLACE,
                            request(session.userId, session.organizationId))
                    .getResult()
                    .get(10, TimeUnit.SECONDS);
            return true;
        } catch (Exception error) {
            // Commit precedes enqueue. A future app/login/refresh trigger recovers this gap.
            context.getSharedPreferences("fwh_sync_diagnostics", Context.MODE_PRIVATE)
                    .edit()
                    .putString("schedule_error", "SCHEDULING_UNAVAILABLE")
                    .apply();
            return false;
        }
    }

    void cancel(String owner, String org) {
        WorkManager.getInstance(context).cancelUniqueWork(workName(owner, org));
    }
}
