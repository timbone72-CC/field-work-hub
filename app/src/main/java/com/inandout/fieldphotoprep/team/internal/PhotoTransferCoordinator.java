package com.inandout.fieldphotoprep.team.internal;

import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;

/**
 * Application-scoped private-transfer owner. One Room journal and one existing WorkManager drain
 * own register/reconcile/TUS/verification; protected files remain owned by PhotoOwner.
 */
final class PhotoTransferCoordinator {
    static final int TUS_CHUNK_BYTES = 6 * 1024 * 1024;
    private static final int MAX_NETWORK_STEPS = 64;
    private static final long MAX_DRAIN_MS = 4 * 60_000L;
    private static final long DEFAULT_RETRY_MS = 30_000L;
    private static final long MAX_RETRY_MS = 30 * 60_000L;

    interface Remote {
        Registration register(String accessToken, PhotoTransfer row) throws Exception;
        Status status(String accessToken, PhotoTransfer row) throws Exception;
        String createSession(String accessToken, PhotoTransfer row) throws Exception;
        Head head(String accessToken, PhotoTransfer row) throws Exception;
        long patch(String accessToken, PhotoTransfer row, File prepared, int maxBytes) throws Exception;
        String verify(String accessToken, PhotoTransfer row) throws Exception;
    }

    static final class Registration {
        final String photoId, transferVersion, bucket, objectKey, preparedSha256, state;
        final long preparedSize;
        Registration(String photoId, String transferVersion, String bucket, String objectKey,
                String preparedSha256, long preparedSize, String state) {
            this.photoId = photoId; this.transferVersion = transferVersion; this.bucket = bucket;
            this.objectKey = objectKey; this.preparedSha256 = preparedSha256;
            this.preparedSize = preparedSize; this.state = state;
        }
    }

    static final class Status {
        final String photoId, transferVersion, state, receiptResponse;
        Status(String photoId, String transferVersion, String state, String receiptResponse) {
            this.photoId = photoId; this.transferVersion = transferVersion;
            this.state = state; this.receiptResponse = receiptResponse == null ? "" : receiptResponse;
        }
    }

    static final class Head {
        final boolean exists;
        final long length, offset;
        private Head(boolean exists, long length, long offset) {
            this.exists = exists; this.length = length; this.offset = offset;
        }
        static Head missing() { return new Head(false, 0, 0); }
        static Head present(long length, long offset) { return new Head(true, length, offset); }
    }

    enum Outcome { STAGED, RETRY, HELD, PAUSED }

    private final CachedWorkOrderDao fields;
    private final PhotoTransferDao transfers;
    private final PhotoOwner photos;
    private final SessionCoordinator sessions;
    private final Remote remote;
    private final Object drainLock;
    private final boolean enabled;

    PhotoTransferCoordinator(CachedWorkOrderDao fields, PhotoTransferDao transfers,
            PhotoOwner photos, SessionCoordinator sessions, Object drainLock, boolean enabled) {
        this(fields, transfers, photos, sessions, null, drainLock, enabled);
    }

    PhotoTransferCoordinator(CachedWorkOrderDao fields, PhotoTransferDao transfers,
            PhotoOwner photos, SessionCoordinator sessions, Remote remote, Object drainLock,
            boolean enabled) {
        this.fields = fields; this.transfers = transfers; this.photos = photos;
        this.sessions = sessions; this.remote = remote; this.drainLock = drainLock;
        this.enabled = enabled;
    }

    Outcome stageAccepted(String owner, String org, BooleanSupplier stopped) {
        synchronized (drainLock) {
            return stageAcceptedLocked(owner, org, stopped);
        }
    }

    private Outcome stageAcceptedLocked(String owner, String org, BooleanSupplier stopped) {
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
                        } catch (SessionCoordinator.SessionChanged changed) {
                            return Outcome.PAUSED;
                        } catch (Exception problem) {
                            held = true;
                            ProtectedPhoto p = fields.photo(id);
                            if (p != null && owner.equals(p.ownerId) && org.equals(p.organizationId))
                                fields.photoPrepared(p.id, p.prepared,
                                        "Private transfer needs recovery; original protected.");
                        }
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

    Outcome drain(String owner, String org, BooleanSupplier stopped) {
        synchronized (drainLock) {
            if (!enabled || stopped.getAsBoolean()) return Outcome.PAUSED;
            Outcome staging = stageAcceptedLocked(owner, org, stopped);
            if (staging == Outcome.PAUSED) return Outcome.PAUSED;
            boolean retry = staging == Outcome.RETRY, held = staging == Outcome.HELD;
            if (remote == null) return retry ? Outcome.RETRY : held ? Outcome.HELD : Outcome.STAGED;

            long generation = sessions.generation();
            if (!sessions.matches(generation, owner, org)) return Outcome.PAUSED;
            transfers.recoverInterrupted(owner, org);
            long deadline = System.currentTimeMillis() + MAX_DRAIN_MS;
            int steps = 0;
            Set<String> contentChecked = new HashSet<>();

            for (PhotoTransfer candidate : transfers.list(owner, org)) {
                while (steps < MAX_NETWORK_STEPS && System.currentTimeMillis() < deadline) {
                    if (stopped.getAsBoolean() || Thread.currentThread().isInterrupted()
                            || !sessions.matches(generation, owner, org)) return Outcome.PAUSED;
                    PhotoTransfer row = transfers.find(candidate.photoId);
                    if (row == null || "RECEIVED".equals(row.state)) break;
                    if (row.retryNotBefore > System.currentTimeMillis()) {
                        retry = true; break;
                    }
                    try {
                        boolean progressed = processOne(owner, org, generation, row, contentChecked);
                        steps++;
                        if (!progressed) { held = true; break; }
                    } catch (SessionCoordinator.SessionChanged changed) {
                        return Outcome.PAUSED;
                    } catch (SupabaseApi.ApiException api) {
                        PhotoTransfer current = transfers.find(row.photoId);
                        if (current != null && !current.transferVersion.isEmpty()
                                && !"REGISTER_PENDING".equals(current.state)
                                && sessions.matches(generation, owner, org)) {
                            long delay = transientStatus(api.statusCode)
                                    ? retryAt(api.retryAfterMs) : 0;
                            transfers.uncertain(owner, org, current.photoId,
                                    current.transferVersion, delay);
                        }
                        if (api.statusCode == 401 || api.statusCode == 403) {
                            sessions.reject(generation);
                            return Outcome.PAUSED;
                        }
                        if (transientStatus(api.statusCode)
                                || (api.statusCode == 409
                                    && ("CREATING".equals(row.state)
                                        || "UPLOADING".equals(row.state)))) retry = true;
                        else held = true;
                        break;
                    } catch (IOException transport) {
                        PhotoTransfer current = transfers.find(row.photoId);
                        if (current != null && !current.transferVersion.isEmpty()
                                && !"REGISTER_PENDING".equals(current.state)
                                && sessions.matches(generation, owner, org))
                            transfers.uncertain(owner, org, current.photoId,
                                    current.transferVersion, retryAt(0));
                        retry = true; break;
                    } catch (Exception protocol) {
                        PhotoTransfer current = transfers.find(row.photoId);
                        if (current != null && !current.transferVersion.isEmpty()
                                && !"REGISTER_PENDING".equals(current.state)
                                && sessions.matches(generation, owner, org))
                            transfers.uncertain(owner, org, current.photoId,
                                    current.transferVersion, 0);
                        held = true; break;
                    }
                }
                if (steps >= MAX_NETWORK_STEPS || System.currentTimeMillis() >= deadline) {
                    retry = transfers.unresolved(owner, org) > 0 || retry;
                    break;
                }
            }
            return retry ? Outcome.RETRY : held ? Outcome.HELD : Outcome.STAGED;
        }
    }

    private boolean processOne(String owner, String org, long generation, PhotoTransfer row,
            Set<String> contentChecked) throws Exception {
        SupabaseApi.AuthSession session =
                sessions.authorized(generation, owner, org, false);
        if (!sessions.matches(generation, owner, org)) throw new SessionCoordinator.SessionChanged();

        if ("REGISTER_PENDING".equals(row.state)) {
            Registration registered = remote.register(session.accessToken, row);
            if (!row.photoId.equals(registered.photoId))
                throw new IllegalStateException("Private registration photo changed.");
            sessions.local(generation, session, () -> {
                transfers.registered(owner, org, row.photoId, registered.transferVersion,
                        registered.bucket, registered.objectKey, registered.preparedSha256,
                        registered.preparedSize, registered.state);
                return null;
            });
            return true;
        }

        if (row.transferVersion.isEmpty())
            throw new IllegalStateException("Registered transfer version is missing.");

        if ("UNCERTAIN".equals(row.state)) {
            if (!row.tusUrl.isEmpty()) {
                Head head = remote.head(session.accessToken, row);
                if (head.exists) {
                    sessions.local(generation, session, () -> {
                        transfers.sessionReconciled(owner, org, row.photoId, row.transferVersion,
                                row.tusUrl, head.length, head.offset);
                        return null;
                    });
                    return true;
                }
            }
            Status status = remote.status(session.accessToken, row);
            validateStatus(row, status);
            if ("RECEIVED".equals(status.state)) {
                sessions.local(generation, session, () -> {
                    transfers.verifiedResponse(owner, org, row.photoId, row.transferVersion,
                            status.receiptResponse, System.currentTimeMillis());
                    return null;
                });
                return true;
            }
            if ("PRESENT".equals(status.state)) {
                sessions.local(generation, session, () -> {
                    transfers.objectPresent(owner, org, row.photoId, row.transferVersion);
                    return null;
                });
                return true;
            }
            if ("ABSENT".equals(status.state)) {
                sessions.local(generation, session, () -> {
                    transfers.confirmedAbsent(owner, org, row.photoId, row.transferVersion);
                    return null;
                });
                return true;
            }
            if ("CONFLICT".equals(status.state)) return false;
            throw new IllegalStateException("Unknown transfer status.");
        }

        if ("TRANSFER_PENDING".equals(row.state)) {
            sessions.local(generation, session, () -> {
                transfers.creating(owner, org, row.photoId, row.transferVersion);
                return null;
            });
            String url = remote.createSession(session.accessToken, transfers.find(row.photoId));
            sessions.local(generation, session, () -> {
                transfers.sessionCreated(owner, org, row.photoId, row.transferVersion, url);
                return null;
            });
            return true;
        }

        if ("UPLOADING".equals(row.state)) {
            if (contentChecked.add(row.photoId) && !preparedMatches(row)) {
                if (sessions.matches(generation, owner, org)) {
                    transfers.uncertain(owner, org, row.photoId, row.transferVersion, 0);
                    ProtectedPhoto p = fields.photo(row.photoId);
                    if (p != null) fields.photoPrepared(p.id, false,
                            "Frozen prepared copy changed or is unavailable; original protected.");
                }
                return false;
            }
            ProtectedPhoto p = fields.photo(row.photoId);
            if (p == null) return false;
            long next = remote.patch(session.accessToken, row, new File(p.preparedPath),
                    TUS_CHUNK_BYTES);
            sessions.local(generation, session, () -> {
                transfers.offsetConfirmed(owner, org, row.photoId, row.transferVersion,
                        row.tusUrl, row.confirmedOffset, next);
                return null;
            });
            return true;
        }

        if ("VERIFY_PENDING".equals(row.state)) {
            String receipt = remote.verify(session.accessToken, row);
            sessions.local(generation, session, () -> {
                transfers.verifiedResponse(owner, org, row.photoId, row.transferVersion,
                        receipt, System.currentTimeMillis());
                return null;
            });
            return true;
        }

        if ("CREATING".equals(row.state)) {
            transfers.uncertain(owner, org, row.photoId, row.transferVersion, 0);
            return true;
        }

        return false;
    }

    private boolean preparedMatches(PhotoTransfer row) throws Exception {
        Future<PhotoOwner.PreparedIdentity> task = photos.io.submit(
                () -> photos.preparedIdentity(fields.photo(row.photoId)));
        try {
            PhotoOwner.PreparedIdentity identity = task.get(30, TimeUnit.SECONDS);
            return row.preparedSha256.equals(identity.sha256) && row.preparedSize == identity.size;
        } catch (InterruptedException stopped) {
            task.cancel(true); Thread.currentThread().interrupt(); throw stopped;
        } catch (java.util.concurrent.ExecutionException problem) {
            Throwable cause = problem.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new IllegalStateException(cause);
        } catch (java.util.concurrent.TimeoutException timeout) {
            task.cancel(true); throw new IOException("Prepared photo check timed out.");
        }
    }

    private static void validateStatus(PhotoTransfer row, Status status) {
        if (status == null || !row.photoId.equals(status.photoId)
                || !row.transferVersion.equals(status.transferVersion)
                || !("ABSENT".equals(status.state) || "PRESENT".equals(status.state)
                    || "CONFLICT".equals(status.state) || "RECEIVED".equals(status.state)))
            throw new IllegalStateException("Exact transfer status did not match.");
        if ("RECEIVED".equals(status.state) && status.receiptResponse.isEmpty())
            throw new IllegalStateException("Received status omitted its receipt.");
        if (!"RECEIVED".equals(status.state) && !status.receiptResponse.isEmpty())
            throw new IllegalStateException("Non-received status carried a receipt.");
    }

    private static boolean transientStatus(int status) {
        return status == 408 || status == 429 || status >= 500;
    }

    private static long retryAt(long retryAfterMs) {
        long delay = Math.max(DEFAULT_RETRY_MS, retryAfterMs);
        return System.currentTimeMillis() + Math.min(MAX_RETRY_MS, delay);
    }
}
