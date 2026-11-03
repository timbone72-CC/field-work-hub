package com.inandout.fieldphotoprep.team.internal;

import org.json.JSONObject;

/**
 * Future original-owner poll-to-Room bridge. Not scheduled or attached to a
 * Worker yet; never opens/deletes a file or changes a photo transfer state.
 * This is server READY information only, not local deletion authorization.
 */
final class PhotoCleanupCoordinator {
    interface Remote {
        String read(String accessToken,String photoId) throws Exception;
    }

    private final PhotoCleanupDao journal;
    private final SessionCoordinator sessions;
    private final Remote remote;

    PhotoCleanupCoordinator(PhotoCleanupDao journal,SessionCoordinator sessions,Remote remote) {
        this.journal=journal;this.sessions=sessions;this.remote=remote;
    }

    /** Returns true only after a matching immutable local receipt is committed. */
    boolean recordServerReadiness(String owner,String org,String photoId) throws Exception {
        if(!BuildConfig.FIELD_SYNC_ENABLED) return false;
        if(owner==null||owner.isEmpty()||org==null||org.isEmpty()
            ||photoId==null||photoId.isEmpty())
            throw new IllegalArgumentException("Exact local identity required");
        long generation=sessions.generation();
        SupabaseApi.AuthSession session=sessions.authorized(generation,owner,org,false);
        String response=remote.read(session.accessToken,photoId);
        JSONObject proof=new JSONObject(response);
        if(!proof.has("eligible"))
            throw new IllegalStateException("Server readiness response incomplete");
        if(!proof.getBoolean("eligible")) return false; // no local READY or cleanup.
        sessions.local(generation,session,()->{
            journal.recordVerifiedReadiness(owner,org,photoId,response);
            return null;
        });
        return true;
    }
}
