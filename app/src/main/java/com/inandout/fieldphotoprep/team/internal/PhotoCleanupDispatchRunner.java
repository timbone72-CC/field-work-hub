package com.inandout.fieldphotoprep.team.internal;

import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/**
 * Bounded, owner-scoped cleanup dispatch. This NEVER writes provider state,
 * authorizes a deletion, or touches files. TeamRuntime's existing cleanupVerified
 * is the only allowed executor: fresh server attestation, Room journal and
 * PhotoOwner's serial file deletion remain required for EVERY original.
 */
final class PhotoCleanupDispatchRunner {
    static final int MAX_PHOTOS_PER_RUN = 8;

    interface Cleanup {
        boolean execute(SupabaseApi.AuthSession session,long generation,String photoId)
                throws Exception;
    }

    private final PhotoCleanupDao journal;
    private final SessionCoordinator sessions;
    private final Cleanup cleanup;
    private final boolean enabled;

    PhotoCleanupDispatchRunner(PhotoCleanupDao journal,SessionCoordinator sessions,Cleanup cleanup) {
        this(journal,sessions,cleanup,BuildConfig.AUTOMATIC_CLEANUP_ENABLED);
    }

    /** Test-only seam. Shipping builds always use the protected BuildConfig gate. */
    PhotoCleanupDispatchRunner(PhotoCleanupDao journal,SessionCoordinator sessions,
            Cleanup cleanup,boolean enabled) {
        this.journal=journal;
        this.sessions=sessions;
        this.cleanup=cleanup;
        this.enabled=enabled;
    }

    /**
     * One stable keyset page per invocation, resuming at the beginning after
     * reaching the end. Even a blocked original advances the cursor so it
     * cannot starve independently safe work. Persisted journal states, not the
     * cursor, determine whether each original may ever be deleted.
     */
    int drain(String owner,String org,String after,BooleanSupplier stopped,
            Consumer<String> checkpoint) throws Exception {
        if(!enabled||!BuildConfig.FIELD_SYNC_ENABLED||stopped.getAsBoolean()) return 0;
        if(owner==null||owner.isEmpty()||org==null||org.isEmpty()
                ||checkpoint==null)
            throw new IllegalArgumentException("Original owner and cursor required");
        long generation=sessions.generation();
        SupabaseApi.AuthSession session=sessions.authorized(generation,owner,org,false);
        if(!"CONTRACTOR".equals(session.role)) return 0;
        String cursor=after==null?"":after;
        List<String> ids=sessions.local(generation,session,
                ()->journal.dispatchCandidates(owner,org,cursor,MAX_PHOTOS_PER_RUN));
        if(ids.isEmpty()&&!cursor.isEmpty()) {
            ids=sessions.local(generation,session,
                    ()->journal.dispatchCandidates(owner,org,"",MAX_PHOTOS_PER_RUN));
        }

        int checked=0;
        for(String id:ids) {
            if(stopped.getAsBoolean()) break;
            if(!sessions.matches(generation,owner,org))
                throw new SessionCoordinator.SessionChanged();
            try {
                cleanup.execute(session,generation,id);
            } catch(SessionCoordinator.SessionChanged changed) {
                throw changed;
            } catch(SupabaseApi.ApiException rejected) {
                if(rejected.statusCode==401) {
                    sessions.reject(generation);
                    break;
                }
                // 403/404 or one photo's provider/retention conflict only holds
                // that exact original. Other candidates remain independently safe.
            } catch(Exception held) {
                // A fresh server read, pending action, changed byte or disk error
                // blocks only this photo. The persisted journal never claims CLEANED.
            }
            if(!sessions.matches(generation,owner,org))
                throw new SessionCoordinator.SessionChanged();
            checkpoint.accept(id); // WorkManager persists before scanning another photo.
            checked++;
        }
        return checked;
    }
}
