package com.inandout.fieldphotoprep.team.internal;

import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** Single drain owner: a stopped worker releases the lock before another drain recovers claims. */
final class ActionSyncCoordinator {
    interface Remote {
        FieldActionResult submit(String accessToken, FieldAction action) throws Exception;
    }

    enum Outcome {
        DONE,
        RETRY,
        PAUSED,
        DEFECT
    }

    private final CachedWorkOrderDao dao;
    private final SessionCoordinator sessions;
    private final Remote remote;
    private final boolean enabled;
    final Object drainLock = new Object();

    ActionSyncCoordinator(CachedWorkOrderDao dao, SessionCoordinator sessions, Remote remote) {
        this(dao, sessions, remote, BuildConfig.FIELD_SYNC_ENABLED);
    }

    ActionSyncCoordinator(
            CachedWorkOrderDao dao, SessionCoordinator sessions, Remote remote, boolean enabled) {
        this.dao = dao;
        this.sessions = sessions;
        this.remote = remote;
        this.enabled = enabled;
    }

    Outcome drain(String owner, String org, BooleanSupplier stopped) {
        synchronized (drainLock) {
            if (!enabled) return Outcome.PAUSED;
            long generation = sessions.generation();
            if (!sessions.matches(generation, owner, org)) return Outcome.PAUSED;
            dao.recoverClaims(owner, org);
            boolean retry = false, defect = false;
            Set<String> blocked = new HashSet<>();
            // Snapshot bounds one attempt. New commits enqueue a successor; Room remains the source
            // of truth.
            for (FieldAction candidate : dao.actions(owner, org)) {
                if (stopped.getAsBoolean()
                        || Thread.currentThread().isInterrupted()
                        || !sessions.matches(generation, owner, org)) return Outcome.PAUSED;
                String key = candidate.workOrderId + "/" + candidate.runId;
                if (blocked.contains(key) || !"PENDING".equals(candidate.state)) continue;
                if (candidate.retryNotBefore > System.currentTimeMillis()) {
                    retry = true;
                    blocked.add(key);
                    continue;
                }
                if (candidate.reason.startsWith("PROTOCOL")) {
                    defect = true;
                    blocked.add(key);
                    continue;
                }
                String claim = UUID.randomUUID().toString();
                FieldAction action = null;
                try {
                    SupabaseApi.AuthSession s = sessions.authorized(generation, owner, org, false);
                    if (stopped.getAsBoolean() || !sessions.matches(generation, owner, org))
                        return Outcome.PAUSED;
                    action = dao.claim(candidate.actionId, claim, generation);
                    if (action == null) continue;
                    // A COMPLETE cannot pass an unresolved earlier START, including transport
                    // failure.
                    if (!sessions.matches(generation, owner, org) || stopped.getAsBoolean()) {
                        dao.release(action.actionId, claim, "INTERRUPTED");
                        return Outcome.PAUSED;
                    }
                    FieldActionResult result = remote.submit(s.accessToken, action);
                    // A verified response belongs to this original claim even after Sign Out.
                    dao.accept(action.actionId, claim, generation, result);
                    if (result.conflict) blocked.add(key);
                } catch (SessionCoordinator.SessionChanged e) {
                    if (action != null) dao.release(action.actionId, claim, "SESSION_PAUSED");
                    return Outcome.PAUSED;
                } catch (SupabaseApi.ApiException e) {
                    boolean transientFailure =
                            e.statusCode == 408 || e.statusCode == 429 || e.statusCode >= 500;
                    if (action != null)
                        dao.release(
                                action.actionId,
                                claim,
                                transientFailure || e.statusCode == 401 || e.statusCode == 403
                                        ? "HTTP_" + e.statusCode
                                        : "PROTOCOL_HTTP",
                                transientFailure ? System.currentTimeMillis() + e.retryAfterMs : 0);
                    if (e.statusCode == 401 || e.statusCode == 403) {
                        sessions.reject(generation);
                        return Outcome.PAUSED;
                    }
                    if (e.statusCode == 408 || e.statusCode == 429 || e.statusCode >= 500)
                        retry = true;
                    else {
                        defect = true;
                    }
                    blocked.add(key);
                } catch (IOException e) {
                    if (action != null) dao.release(action.actionId, claim, "TRANSPORT_RETRY");
                    retry = true;
                    blocked.add(key);
                } catch (Exception e) {
                    if (action != null) dao.release(action.actionId, claim, "PROTOCOL_REVIEW");
                    defect = true;
                    blocked.add(key);
                }
            }
            return retry ? Outcome.RETRY : defect ? Outcome.DEFECT : Outcome.DONE;
        }
    }

    void requireHandoffReady(String owner, String org, String wo) {
        if (hasUnresolved(owner, org, wo))
            throw new IllegalStateException(
                    "Saved offline progress must sync before approving this handoff. Refresh"
                        + " Assignments online, or contact Admin if it needs review.");
    }

    boolean hasUnresolved(String owner, String org, String wo) {
        for (FieldAction a : dao.actions(owner, org))
            if (a.workOrderId.equals(wo) && !"ACCEPTED".equals(a.state)) return true;
        for (CachedWorkOrder r : dao.listForOwner(owner, org)) if (r.workOrderId.equals(wo))
            for (ProtectedPhoto p : dao.photos(owner, org, wo, r.runId))
                if (!"DISCARDED".equals(p.state)) return true;
        return false;
    }
}
