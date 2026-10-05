package com.inandout.fieldphotoprep.team.internal;

/** One encrypted credential owner shared by the UI and WorkManager in this process. */
final class SessionCoordinator {
    interface Remote {
        SupabaseApi.AuthSession refreshSession(String token) throws Exception;
    }

    private final SecureSessionStore store;
    private final Remote remote;
    private final Object stateLock = new Object();
    private final Object refreshLock = new Object();

    SessionCoordinator(SecureSessionStore store, Remote remote) {
        this.store = store;
        this.remote = remote;
    }

    long generation() {
        synchronized (stateLock) {
            return store.generation();
        }
    }

    SupabaseApi.AuthSession load() {
        synchronized (stateLock) {
            return store.load();
        }
    }

    long beginLogin() {
        synchronized (stateLock) {
            store.clear();
            return store.generation();
        }
    }

    boolean install(long generation, SupabaseApi.AuthSession session) {
        synchronized (stateLock) {
            if (store.generation() != generation) return false;
            store.save(session);
            return true;
        }
    }

    SupabaseApi.AuthSession signOut() {
        synchronized (stateLock) {
            SupabaseApi.AuthSession old = store.load();
            store.clear();
            return old;
        }
    }

    boolean matches(long generation, String owner, String org) {
        synchronized (stateLock) {
            SupabaseApi.AuthSession s = store.load();
            return store.generation() == generation
                    && s != null
                    && s.userId.equals(owner)
                    && s.organizationId.equals(org);
        }
    }

    FieldAction create(
            CachedWorkOrderDao dao,
            long generation,
            SupabaseApi.AuthSession expected,
            String wo,
            String run,
            String kind,
            String time)
            throws Exception {
        synchronized (stateLock) {
            if (!matches(generation, expected.userId, expected.organizationId))
                throw new SessionChanged();
            // Sign Out cannot interleave the local authorization check and durable commit.
            return dao.createAction(store.load(), wo, run, kind, time);
        }
    }

    <T> T local(long generation, SupabaseApi.AuthSession expected, java.util.concurrent.Callable<T> work) throws Exception {
        synchronized(stateLock) {
            if (!matches(generation, expected.userId, expected.organizationId)) throw new SessionChanged();
            return work.call();
        }
    }

    boolean runIfCurrent(long generation, Runnable action) {
        synchronized (stateLock) {
            if (store.generation() != generation) return false;
            action.run();
            return true;
        }
    }

    boolean runIfSignedOutAfter(long generation, Runnable action) {
        synchronized (stateLock) {
            long current = store.generation();
            if (store.load() != null || (current != generation && current != generation + 1)) return false;
            action.run();
            return true;
        }
    }

    boolean reject(long generation) {
        synchronized (stateLock) {
            if (store.generation() != generation) return false;
            store.clear();
            return true;
        }
    }

    SupabaseApi.AuthSession authorized(
            long generation, String owner, String org, boolean forceRefresh) throws Exception {
        synchronized (refreshLock) {
            SupabaseApi.AuthSession s;
            synchronized (stateLock) {
                s = store.load();
                if (store.generation() != generation
                        || s == null
                        || !s.userId.equals(owner)
                        || !s.organizationId.equals(org)) throw new SessionChanged();
                if (!forceRefresh
                        && s.expiresAtEpochSeconds > System.currentTimeMillis() / 1000 + 60)
                    return s;
            }
            SupabaseApi.AuthSession refreshed;
            try {
                refreshed = remote.refreshSession(s.refreshToken);
            } catch (SupabaseApi.ApiException e) {
                if (e.isAuthenticationRejection()) reject(generation);
                throw e;
            }
            synchronized (stateLock) {
                if (store.generation() != generation) throw new SessionChanged();
                SupabaseApi.AuthSession latest = store.load();
                if (latest == null
                        || !latest.userId.equals(owner)
                        || !latest.organizationId.equals(org)) throw new SessionChanged();
                if (!refreshed.userId.equals(owner)
                        || !refreshed.organizationId.equals(org)
                        || !refreshed.role.equals(s.role)) {
                    store.clear();
                    throw new SupabaseApi.ApiException(
                            403,
                            "Account authorization changed. Sign in again; saved work is"
                                + " preserved.");
                }
                store.save(refreshed);
                return refreshed;
            }
        }
    }

    static final class SessionChanged extends Exception {
        SessionChanged() {
            super("Sign in again before continuing.");
        }
    }
}
