package com.inandout.fieldphotoprep.team.internal;

import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/**
 * Bounded, read-only original-owner readiness polling. The existing
 * PhotoCleanupCoordinator owns the server proof -> HELD Room transaction.
 * This class NEVER arms READY, deletes files or sends provider work.
 */
final class PhotoCleanupReadinessPoller {
    static final int MAX_PHOTOS_PER_RUN = 8;
    private final PhotoCleanupDao journal;
    private final PhotoCleanupCoordinator readiness;
    private final SessionCoordinator sessions;
    private final boolean enabled;

    PhotoCleanupReadinessPoller(PhotoCleanupDao journal, PhotoCleanupCoordinator readiness,
            SessionCoordinator sessions) {
        this(journal, readiness, sessions, BuildConfig.CLEANUP_READINESS_POLLING_ENABLED);
    }

    /** Test-only enabled seam; shipping builds remain gated by BuildConfig. */
    PhotoCleanupReadinessPoller(PhotoCleanupDao journal, PhotoCleanupCoordinator readiness,
            SessionCoordinator sessions, boolean enabled) {
        this.journal = journal;
        this.readiness = readiness;
        this.sessions = sessions;
        this.enabled = enabled;
    }

    /**
     * One bounded page per scheduled run. Checkpoint even ineligible/denied
     * photos so older unresolved jobs cannot starve unrelated work. A later
     * run wraps to the beginning. Local HELD/READY/CLEANING/CLEANED snapshots
     * are excluded from repeated background discovery; an actual cleanup
     * decision must independently re-read fresh server authority.
     */
    int poll(String owner, String org, String after, BooleanSupplier stopped,
            Consumer<String> checkpoint) throws Exception {
        if (!enabled || !BuildConfig.FIELD_SYNC_ENABLED || stopped.getAsBoolean()) return 0;
        if (owner == null || owner.isEmpty() || org == null || org.isEmpty()
                || checkpoint == null) throw new IllegalArgumentException("Owner cursor required");
        long generation = sessions.generation();
        SupabaseApi.AuthSession expected = sessions.authorized(generation, owner, org, false);
        if (!"CONTRACTOR".equals(expected.role)) return 0;
        String cursor = after == null ? "" : after;
        List<String> ids = sessions.local(generation, expected,
                () -> journal.readinessCandidates(owner, org, cursor, MAX_PHOTOS_PER_RUN));
        if (ids.isEmpty() && !cursor.isEmpty()) {
            ids = sessions.local(generation, expected,
                    () -> journal.readinessCandidates(owner, org, "", MAX_PHOTOS_PER_RUN));
        }

        int checked = 0;
        for (String id : ids) {
            if (stopped.getAsBoolean()) break;
            if (!sessions.matches(generation, owner, org))
                throw new SessionCoordinator.SessionChanged();
            try {
                readiness.recordServerReadiness(owner, org, id);
            } catch (SessionCoordinator.SessionChanged changed) {
                throw changed;
            } catch (SupabaseApi.ApiException rejected) {
                if (rejected.statusCode == 401) {
                    sessions.reject(generation);
                    break;
                }
                // A 403 can apply to this one photo. Other owners' evidence
                // and unrelated jobs are never retried or altered.
            } catch (Exception unavailableOrDenied) {
                // No cleanup follows this read. A later periodic check may
                // revisit the held candidate; do not stop independent photos.
            }
            if (!sessions.matches(generation, owner, org))
                throw new SessionCoordinator.SessionChanged();
            checkpoint.accept(id); // saved synchronously by the Worker
            checked++;
        }
        return checked;
    }
}
