package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;

import java.util.List;

/** Application-scoped owners. UI callbacks cannot own or rotate worker credentials. */
final class TeamRuntime {
    private static volatile TeamRuntime instance;
    final SupabaseApi api = new SupabaseApi();
    final SessionCoordinator sessions;
    final CachedWorkOrderDao dao;
    final AssignmentRepository assignments;
    final ActionSyncCoordinator sync;
    final PhotoOwner photos;
    final PhotoCleanupCoordinator cleanupReadiness;
    final PhotoCleanupReadinessPoller cleanupPoller;
    final PhotoCleanupDao cleanupDao;
    final PhotoTransferCoordinator transfers;
    final ActionScheduler scheduler;
    private final Object actionCreationLock = new Object();

    private TeamRuntime(Context context) {
        dao = TeamDatabase.getInstance(context).cachedWorkOrderDao();
        sessions = new SessionCoordinator(new SecureSessionStore(context), api);
        assignments = new AssignmentRepository(api, new RoomAssignmentStore(dao));
        cleanupDao = TeamDatabase.getInstance(context).photoCleanupDao();
        photos = new PhotoOwner(context, dao, cleanupDao, sessions);
        cleanupReadiness = new PhotoCleanupCoordinator(
                cleanupDao, sessions, api::fieldPhotoCleanupReadiness);
        sync = new ActionSyncCoordinator(dao, sessions, (token, action) -> { photos.ensureFrozenReadable(action); return api.submit(token, action); });
        PhotoTransferDao transferDao = TeamDatabase.getInstance(context).photoTransferDao();
        transfers = new PhotoTransferCoordinator(dao, transferDao, photos, sessions, api,
                sync.drainLock, BuildConfig.FIELD_SYNC_ENABLED);
        scheduler = new ActionScheduler(context, dao, transferDao);
    }

    static TeamRuntime get(Context context) {
        if (instance == null)
            synchronized (TeamRuntime.class) {
                if (instance == null) instance = new TeamRuntime(context.getApplicationContext());
            }
        return instance;
    }

    List<SupabaseApi.WorkOrder> refresh(SupabaseApi.AuthSession expected, long generation) throws Exception {
        if (!BuildConfig.FIELD_SYNC_ENABLED) {
            if (!sessions.matches(generation, expected.userId, expected.organizationId)) throw new SessionCoordinator.SessionChanged();
            return assignments.loadCached(expected);
        }
        synchronized (sync.drainLock) {
            SupabaseApi.AuthSession s =
                    sessions.authorized(generation, expected.userId, expected.organizationId, true);
            if (BuildConfig.FIELD_SYNC_ENABLED) {
                sync.drain(s.userId, s.organizationId, () -> false);
                transfers.stageAccepted(s.userId, s.organizationId, () -> false);
                // App refresh only wakes the durable worker; byte transfer never blocks the UI.
                scheduler.ensure(s);
            }
            return reconcile(s, generation);
        }
    }

    List<SupabaseApi.WorkOrder> reconcile(SupabaseApi.AuthSession expected, long generation)
            throws Exception {
        AssignmentRepository guarded =
                new AssignmentRepository(
                        new AssignmentRepository.Remote() {
                            private String token() throws Exception {
                                return sessions.authorized(
                                                generation,
                                                expected.userId,
                                                expected.organizationId,
                                                false)
                                        .accessToken;
                            }

                            @Override
                            public List<SupabaseApi.WorkOrder> fetchWorkOrders(String ignored)
                                    throws Exception {
                                return api.fetchWorkOrders(token());
                            }

                            @Override
                            public void acknowledgeAssignmentReceived(String ignored, String wo)
                                    throws Exception {
                                api.acknowledgeAssignmentReceived(token(), wo);
                            }
                        },
                        new RoomAssignmentStore(dao));
        List<SupabaseApi.WorkOrder> rows = guarded.refresh(expected);
        SupabaseApi.AuthSession current = sessions.authorized(
                generation, expected.userId, expected.organizationId, false);
        if ("CONTRACTOR".equals(current.role))
            api.attachPendingTeamHandoffConsents(current.accessToken, rows);
        return rows;
    }

    FieldAction create(SupabaseApi.AuthSession expected, long gen, String wo, String run, String kind)
            throws Exception {
        synchronized (actionCreationLock) {
            if (!sessions.matches(gen, expected.userId, expected.organizationId))
                throw new SessionCoordinator.SessionChanged();
            if (!BuildConfig.FIELD_SYNC_ENABLED)
                throw new IllegalStateException(
                        "Recovery mode preserves saved work. Field sync is paused.");
            FieldAction action =
                    sessions.create(
                            dao, gen, expected, wo, run, kind, java.time.Instant.now().toString());
            scheduler.ensure(expected);
            return action;
        }
    }

    void handoff(SupabaseApi.AuthSession expected, long gen, String wo, boolean accept) throws Exception {
        if (!BuildConfig.FIELD_SYNC_ENABLED) throw new IllegalStateException("Recovery mode is read only.");
        synchronized (sync.drainLock) {
            synchronized (actionCreationLock) {
                if (accept) sync.requireHandoffReady(expected.userId, expected.organizationId, wo);
                SupabaseApi.AuthSession s =
                        sessions.authorized(gen, expected.userId, expected.organizationId, true);
                if (!sessions.matches(gen, expected.userId, expected.organizationId))
                    throw new SessionCoordinator.SessionChanged();
                api.respondReassignment(s.accessToken, wo, accept);
            }
        }
    }

    void respondTeamHandoffConsent(SupabaseApi.AuthSession expected, long gen,
            String workOrderId, String requestId, boolean accept) throws Exception {
        if (!BuildConfig.FIELD_SYNC_ENABLED)
            throw new IllegalStateException("Recovery mode is read only.");
        synchronized (sync.drainLock) {
            synchronized (actionCreationLock) {
                // Consent is online only; never send an approval while local
                // actions or protected photo evidence are not fully settled.
                if (accept) sync.requireHandoffReady(expected.userId,
                        expected.organizationId, workOrderId);
                SupabaseApi.AuthSession s = sessions.authorized(
                        gen, expected.userId, expected.organizationId, true);
                if (!"CONTRACTOR".equals(s.role)
                        || !sessions.matches(gen, expected.userId, expected.organizationId))
                    throw new SessionCoordinator.SessionChanged();
                api.respondTeamHandoffConsent(s.accessToken, requestId, accept);
            }
        }
    }

    /**
     * Future explicit cleanup dispatch owner. The existing action/transfer
     * locks serialize the exact local evidence check with future offline work.
     * Returns false in every currently distributed/test APK (switch OFF).
     */
    boolean cleanupVerified(SupabaseApi.AuthSession expected,long generation,String photoId)
            throws Exception {
        if(!BuildConfig.AUTOMATIC_CLEANUP_ENABLED) return false;
        synchronized(sync.drainLock) {
            synchronized(actionCreationLock) {
                if(!sessions.matches(generation,expected.userId,expected.organizationId))
                    throw new SessionCoordinator.SessionChanged();
                // Always recheck the owner-scoped server closure NOW. A cached
                // proof can predate a correction, new package or changed grant.
                // Network/auth failure => no new deletion, even during restart.
                if(!cleanupReadiness.recordServerReadiness(
                        expected.userId,expected.organizationId,photoId))
                    return false;
                java.util.concurrent.Future<Boolean> result=photos.io.submit(
                    ()->photos.cleanupVerified(expected,generation,photoId));
                try { return result.get(); }
                catch(java.util.concurrent.ExecutionException failure) {
                    Throwable cause=failure.getCause();
                    if(cause instanceof Exception) throw (Exception)cause;
                    throw new IllegalStateException("Cleanup owner failed",cause);
                }
            }
        }
    }

    int resumeInterruptedCleanup(SupabaseApi.AuthSession expected,long generation)
            throws Exception {
        if(!BuildConfig.AUTOMATIC_CLEANUP_ENABLED) return 0;
        // Each interrupted photo independently obtains a fresh server read.
        // A single offline/conflicted job never deletes anything nor blocks
        // unrelated fully verified jobs from being checked.
        int done=0;Exception failure=null;
        java.util.List<PhotoCleanupJournal> pending=sessions.local(generation,expected,
                ()->cleanupDao.pending(expected.userId,expected.organizationId));
        for(PhotoCleanupJournal j:pending) {
            try { if(cleanupVerified(expected,generation,j.photoId)) done++; }
            catch(SessionCoordinator.SessionChanged changed) { throw changed; }
            catch(Exception blocked) {
                if(failure==null) failure=blocked;
                else failure.addSuppressed(blocked);
            }
        }
        if(failure!=null) throw failure;
        return done;
    }

    void signOut() {
        SupabaseApi.AuthSession old = sessions.signOut();
        if (old != null) scheduler.cancel(old.userId, old.organizationId);
    }
}
