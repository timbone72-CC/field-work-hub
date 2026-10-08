package com.inandout.fieldphotoprep.team.internal;

import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;

/** Application-scoped transfer owner; this checkpoint stages locally and performs no network IO. */
final class PhotoTransferCoordinator {
    enum Outcome { STAGED, RETRY, HELD, PAUSED }
    private final CachedWorkOrderDao fields;
    private final PhotoTransferDao transfers;
    private final PhotoOwner photos;
    private final SessionCoordinator sessions;
    private final Object drainLock;
    private final boolean enabled;

    PhotoTransferCoordinator(CachedWorkOrderDao fields, PhotoTransferDao transfers,
            PhotoOwner photos, SessionCoordinator sessions, Object drainLock, boolean enabled) {
        this.fields = fields; this.transfers = transfers; this.photos = photos;
        this.sessions = sessions; this.drainLock = drainLock; this.enabled = enabled;
    }

    Outcome stageAccepted(String owner, String org, BooleanSupplier stopped) {
        synchronized (drainLock) {
            if (!enabled || stopped.getAsBoolean()) return Outcome.PAUSED;
            long generation = sessions.generation();
            if (!sessions.matches(generation, owner, org)) return Outcome.PAUSED;
            SupabaseApi.AuthSession expected = sessions.load();
            Future<Outcome> task = photos.io.submit(() -> {
                boolean held = false; int staged = 0;
                photos.recover();
                for (FieldAction action : fields.actions(owner, org)) {
                    if (!"ACCEPTED".equals(action.state) || !"COMPLETE".equals(action.kind)
                            || action.finishSetId.isEmpty()) continue;
                    try {
                        if (!PhotoOwner.digest(action.finishPhotosJson).equals(action.finishDigest)) {
                            held = true; continue;
                        }
                        JSONArray manifest = new JSONArray(action.finishPhotosJson);
                        for (int n = 0; n < manifest.length(); n++) {
                            if (stopped.getAsBoolean() || Thread.currentThread().isInterrupted()
                                    || !sessions.matches(generation, owner, org)) return Outcome.PAUSED;
                            String id = manifest.getJSONObject(n).getString("id");
                            // Existing journal is immutable. The future transport rechecks content before bytes.
                            if (transfers.find(id) != null) continue;
                            if (staged >= 32) return Outcome.RETRY;
                            try {
                                ProtectedPhoto p = fields.photo(id);
                                if (p == null || !owner.equals(p.ownerId) || !org.equals(p.organizationId)) {
                                    held = true; continue;
                                }
                                PhotoOwner.PreparedIdentity prepared = photos.preparedIdentity(p);
                                if (stopped.getAsBoolean()) return Outcome.PAUSED;
                                sessions.local(generation, expected, () -> transfers.stage(owner, org,
                                        action.actionId, id, prepared.sha256, prepared.size));
                                staged++;
                            } catch (SessionCoordinator.SessionChanged changed) { return Outcome.PAUSED; }
                            catch (Exception problem) {
                                held = true;
                                ProtectedPhoto p = fields.photo(id);
                                if (p != null && owner.equals(p.ownerId) && org.equals(p.organizationId))
                                    fields.photoPrepared(p.id, p.prepared, "Private transfer needs recovery; original protected.");
                            } // One photo cannot stop others; permanent problems do not spin retries.
                        }
                    } catch (Exception malformed) { held = true; }
                }
                return held ? Outcome.HELD : Outcome.STAGED;
            });
            try { return task.get(30, TimeUnit.SECONDS); }
            catch (InterruptedException stoppedThread) {
                task.cancel(true); Thread.currentThread().interrupt(); return Outcome.PAUSED;
            } catch (Exception problem) { task.cancel(true); return Outcome.RETRY; }
        }
    }
}
