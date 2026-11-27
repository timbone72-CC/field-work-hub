package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;

import androidx.work.*;

import java.util.concurrent.TimeUnit;

/** Identity-only, one-time requests. Queue evidence never lives in WorkManager input/output. */
final class ActionScheduler {
    static final String TAG = "fwh-field-actions";
    static final String READINESS_TAG = "fwh-cleanup-readiness";
    static final String CLEANUP_TAG = "fwh-original-cleanup";
    private final Context context;
    private final CachedWorkOrderDao dao;
    private final PhotoTransferDao transfers;

    ActionScheduler(Context context, CachedWorkOrderDao dao, PhotoTransferDao transfers) {
        this.context = context.getApplicationContext();
        this.dao = dao;
        this.transfers = transfers;
    }

    static String workName(String owner, String org) {
        return "fwh-field-actions/" + owner + "/" + org;
    }

    static String readinessWorkName(String owner, String org) {
        return "fwh-cleanup-readiness/" + owner + "/" + org;
    }

    static String cleanupWorkName(String owner,String org) {
        return "fwh-original-cleanup/" + owner + "/" + org;
    }

    static PeriodicWorkRequest readinessRequest(String owner, String org) {
        return new PeriodicWorkRequest.Builder(FieldActionWorker.class,
                BuildConfig.AUTOMATIC_CLEANUP_ENABLED ? 15 : 24,
                BuildConfig.AUTOMATIC_CLEANUP_ENABLED ? TimeUnit.MINUTES : TimeUnit.HOURS)
                .setInputData(new Data.Builder()
                        .putString("owner", owner).putString("org", org)
                        .putBoolean("readiness_only", true).build())
                .setConstraints(new Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED).build())
                .addTag(READINESS_TAG)
                .build();
    }

    /** Independent, strictly read-only schedule. Never wakes delivery or file cleanup. */
    private void ensureReadiness(SupabaseApi.AuthSession session) {
        if ((!BuildConfig.CLEANUP_READINESS_POLLING_ENABLED
                && !BuildConfig.AUTOMATIC_CLEANUP_ENABLED)
                || !"CONTRACTOR".equals(session.role)) return;
        try {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    readinessWorkName(session.userId, session.organizationId),
                    BuildConfig.AUTOMATIC_CLEANUP_ENABLED
                            ? ExistingPeriodicWorkPolicy.UPDATE : ExistingPeriodicWorkPolicy.KEEP,
                    readinessRequest(session.userId, session.organizationId))
                    .getResult().get(10, TimeUnit.SECONDS);
        } catch (Exception error) {
            context.getSharedPreferences("fwh_sync_diagnostics", Context.MODE_PRIVATE)
                    .edit().putString("readiness_schedule_error",
                            "READINESS_SCHEDULING_UNAVAILABLE").apply();
            // A cleanup-readiness scheduling failure must not block fieldwork.
        }
    }

    /**
     * Separate periodic original-owner cleanup, enabled ONLY by the explicit
     * automatic-cleanup build switch. A read-only readiness worker must never
     * acquire this mode; no provider or field-action work is dispatched here.
     */
    static PeriodicWorkRequest cleanupRequest(String owner,String org) {
        return new PeriodicWorkRequest.Builder(FieldActionWorker.class,15,TimeUnit.MINUTES)
                .setInputData(new Data.Builder()
                        .putString("owner",owner).putString("org",org)
                        .putBoolean("cleanup_only",true).build())
                .setConstraints(new Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED).build())
                .addTag(CLEANUP_TAG)
                .build();
    }

    private void ensureCleanup(SupabaseApi.AuthSession session) {
        if(!BuildConfig.AUTOMATIC_CLEANUP_ENABLED
                || !"CONTRACTOR".equals(session.role)) return;
        try {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    cleanupWorkName(session.userId,session.organizationId),
                    ExistingPeriodicWorkPolicy.KEEP,
                    cleanupRequest(session.userId,session.organizationId))
                    .getResult().get(10,TimeUnit.SECONDS);
        } catch(Exception blocked) {
            context.getSharedPreferences("fwh_sync_diagnostics",Context.MODE_PRIVATE)
                    .edit().putString("cleanup_schedule_error",
                            "CLEANUP_SCHEDULING_UNAVAILABLE").apply();
            // Failed cleanup scheduling never blocks fieldwork or touches files.
        }
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
        ensureReadiness(session);
        ensureCleanup(session);
        boolean pending = false;
        for (FieldAction a : dao.actions(session.userId, session.organizationId))
            if (("PENDING".equals(a.state) || "SYNCING".equals(a.state))
                    && !a.reason.startsWith("PROTOCOL")) {
                pending = true;
                break;
            }
        if (!pending
                && dao.unstagedAcceptedPhotos(session.userId, session.organizationId) == 0
                && transfers.unresolved(session.userId, session.organizationId) == 0) return true;
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
        WorkManager.getInstance(context).cancelUniqueWork(readinessWorkName(owner, org));
        WorkManager.getInstance(context).cancelUniqueWork(cleanupWorkName(owner, org));
    }
}
