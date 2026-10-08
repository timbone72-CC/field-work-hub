package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import androidx.room.Room;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class) @Config(sdk = 34)
public class PhotoTransferTest {
    static String id(int n) { return String.format("00000000-0000-4000-8000-%012d", n); }
    final String ownerId = id(1), org = id(2), wo = id(3), run = id(4), version = id(8);
    final String url = "https://vyocaujuwrivoqynvitm.storage.supabase.co/storage/v1/upload/resumable/test-session";
    Context context; String databaseName; File directory; TeamDatabase db;
    CachedWorkOrderDao fields; PhotoTransferDao queue; PhotoOwner photos;
    SessionCoordinator sessions; SupabaseApi.AuthSession actor; FieldAction finish; ProtectedPhoto photo;

    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication(); databaseName = "transfer-" + UUID.randomUUID() + ".db";
        directory = new File(context.getCacheDir(), "transfer-" + UUID.randomUUID()); assertTrue(directory.mkdirs());
        open(); actor = OfflineActionTest.session(ownerId, org);
        context.getSharedPreferences(SecureSessionStore.PREFERENCES_NAME, Context.MODE_PRIVATE).edit().clear().commit();
        SecureSessionStore secure = new SecureSessionStore(context, new SecureSessionStore.Crypto() {
            public byte[] encrypt(byte[] value) { return value; }
            public byte[] decrypt(byte[] value) { return value; }
        });
        sessions = new SessionCoordinator(secure, ignored -> actor);
        sessions.install(sessions.beginLogin(), actor); photos = new PhotoOwner(context, fields, sessions);
        finish = new FieldAction(UUID.randomUUID().toString(), ownerId, org, wo, run, id(5),
                "COMPLETE", "2026-10-08T00:01:00Z", 1, 1);
        finish.requirementRevision = id(6); finish.finishSetId = id(7);
        finish.state = "ACCEPTED"; finish.canonicalStatus = "FIELD_COMPLETE";
        finish.acceptedAt = "2026-10-08T00:01:01Z";
        fields.insertAction(finish); photo = anotherPhoto();
    }

    void open() {
        db = Room.databaseBuilder(context, TeamDatabase.class, databaseName).allowMainThreadQueries().build();
        fields = db.cachedWorkOrderDao(); queue = db.photoTransferDao();
    }

    @After public void close() throws Exception {
        photos.io.shutdownNow(); assertTrue(photos.io.awaitTermination(5, TimeUnit.SECONDS));
        db.close(); context.deleteDatabase(databaseName);
        for (File file : directory.listFiles()) assertTrue(file.delete()); assertTrue(directory.delete());
    }

    ProtectedPhoto anotherPhoto() throws Exception {
        String key = UUID.randomUUID().toString();
        ProtectedPhoto p = new ProtectedPhoto(key, ownerId, org, wo, run, id(5), id(6), "",
                "2026-10-08T00:00:30Z", new File(directory, key + "-original.jpg").getAbsolutePath(),
                new File(directory, key + "-prepared.jpg").getAbsolutePath());
        Bitmap bitmap = Bitmap.createBitmap(64, 32, Bitmap.Config.ARGB_8888);
        try (FileOutputStream out = new FileOutputStream(p.originalPath)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)); }
        try (FileOutputStream out = new FileOutputStream(p.preparedPath)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)); }
        bitmap.recycle(); p.state = "WAITING"; p.originalBytes = new File(p.originalPath).length();
        p.prepared = true; p.finishSetId = finish.finishSetId; fields.insertPhoto(p);
        JSONArray manifest = finish.finishPhotosJson.isEmpty() ? new JSONArray() : new JSONArray(finish.finishPhotosJson);
        manifest.put(new JSONObject().put("id", p.id).put("item_id", JSONObject.NULL).put("captured_at", p.capturedAt));
        finish.finishPhotosJson = manifest.toString(); finish.finishDigest = PhotoOwner.digest(finish.finishPhotosJson);
        fields.updateAction(finish); return p;
    }

    PhotoTransfer stage() throws Exception {
        PhotoOwner.PreparedIdentity identity = photos.io.submit(() -> photos.preparedIdentity(fields.photo(photo.id))).get(5, TimeUnit.SECONDS);
        return queue.stage(ownerId, org, finish.actionId, photo.id, identity.sha256, identity.size);
    }
    String key() { return org + "/" + wo + "/" + run + "/" + photo.id + ".jpg"; }
    PhotoTransfer registered() throws Exception {
        PhotoTransfer row = stage();
        queue.registered(ownerId, org, photo.id, version, "fwh-review-private", key(), row.preparedSha256, row.preparedSize, "WAITING");
        return queue.find(photo.id);
    }
    PhotoTransfer uploading() throws Exception {
        registered(); queue.confirmedAbsent(ownerId, org, photo.id, version);
        queue.creating(ownerId, org, photo.id, version); queue.sessionCreated(ownerId, org, photo.id, version, url);
        return queue.find(photo.id);
    }
    String receipt(String photoId, String transfer, String receipt) throws Exception {
        return new JSONObject().put("photo_id", photoId).put("transfer_version", transfer)
                .put("receipt_id", receipt).put("state", "RECEIVED").toString();
    }
    PhotoTransferCoordinator coordinator(boolean enabled) {
        return new PhotoTransferCoordinator(fields, queue, photos, sessions, new Object(), enabled);
    }

    PhotoTransferCoordinator coordinator(FakeRemote remote) {
        return new PhotoTransferCoordinator(
                fields, queue, photos, sessions, remote, new Object(), true);
    }

    final class FakeRemote implements PhotoTransferCoordinator.Remote {
        final Map<String,String> statuses = new HashMap<>();
        final Map<String,PhotoTransferCoordinator.Head> heads = new HashMap<>();
        final Map<String,String> versions = new HashMap<>();
        final List<String> events = new ArrayList<>();
        final Set<String> failPatchOnce = new HashSet<>();
        int registerCalls, statusCalls, createCalls, headCalls, patchCalls, verifyCalls;
        long lastPatchOffset = -1;
        boolean switchAccountOnRegister;

        String transferVersion(PhotoTransfer row) {
            return versions.computeIfAbsent(row.photoId, ignored ->
                    UUID.nameUUIDFromBytes(row.photoId.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString());
        }

        @Override public PhotoTransferCoordinator.Registration register(String token, PhotoTransfer row) {
            registerCalls++; events.add("register:" + row.photoId);
            String v = transferVersion(row);
            PhotoTransferCoordinator.Registration result = new PhotoTransferCoordinator.Registration(
                    row.photoId, v, "fwh-review-private",
                    row.organizationId + "/" + row.workOrderId + "/" + row.runId + "/" + row.photoId + ".jpg",
                    row.preparedSha256, row.preparedSize, "WAITING");
            if (switchAccountOnRegister) {
                long next = sessions.beginLogin();
                sessions.install(next, OfflineActionTest.session(id(99), org));
            }
            return result;
        }

        @Override public PhotoTransferCoordinator.Status status(String token, PhotoTransfer row) throws Exception {
            statusCalls++; events.add("status:" + row.photoId);
            String state = statuses.getOrDefault(row.photoId, "ABSENT");
            String response = "RECEIVED".equals(state)
                    ? receipt(row.photoId, row.transferVersion, id(9)) : "";
            return new PhotoTransferCoordinator.Status(row.photoId, row.transferVersion, state, response);
        }

        @Override public String createSession(String token, PhotoTransfer row) {
            createCalls++; events.add("create:" + row.photoId); return url;
        }

        @Override public PhotoTransferCoordinator.Head head(String token, PhotoTransfer row) {
            headCalls++; events.add("head:" + row.photoId);
            return heads.getOrDefault(row.photoId, PhotoTransferCoordinator.Head.missing());
        }

        @Override public long patch(String token, PhotoTransfer row, File prepared, int maxBytes)
                throws Exception {
            patchCalls++; lastPatchOffset = row.confirmedOffset; events.add("patch:" + row.photoId);
            if (failPatchOnce.remove(row.photoId)) throw new IOException("response lost");
            return Math.min(row.preparedSize, row.confirmedOffset + maxBytes);
        }

        @Override public String verify(String token, PhotoTransfer row) throws Exception {
            verifyCalls++; events.add("verify:" + row.photoId);
            return receipt(row.photoId, row.transferVersion, id(9));
        }
    }

    @Test public void acceptedFinishStagesOnceWithStableBindingAndActionIds() throws Exception {
        PhotoTransfer first = stage(), second = stage();
        assertEquals(first.beginActionId, second.beginActionId); assertEquals(first.verificationActionId, second.verificationActionId);
        assertTrue(PhotoTransferDao.uuid(first.beginActionId)); assertTrue(PhotoTransferDao.uuid(first.verificationActionId));
        assertNotEquals(first.beginActionId, first.verificationActionId);
        assertTrue(first.matches(photo, finish)); assertEquals("REGISTER_PENDING", second.state);
        assertEquals(1, queue.list(ownerId, org).size()); assertTrue(queue.list(id(99), org).isEmpty());
        assertEquals(0, fields.unstagedAcceptedPhotos(ownerId, org));
    }

    @Test public void unacceptedOrConflictedFinishCannotStage() throws Exception {
        finish.state = "PENDING"; fields.updateAction(finish);
        assertThrows(IllegalStateException.class, this::stage);
        finish.state = "CONFLICT"; fields.updateAction(finish); assertThrows(IllegalStateException.class, this::stage);
        assertTrue(queue.list(ownerId, org).isEmpty()); assertTrue(new File(photo.originalPath).exists());
    }

    @Test public void wrongOwnerAndWrongFinishCannotBorrowPhotos() throws Exception {
        PhotoTransfer row = stage();
        assertThrows(IllegalStateException.class, () -> queue.stage(id(99), org, finish.actionId, photo.id, row.preparedSha256, row.preparedSize));
        finish.finishSetId = id(99); fields.updateAction(finish); assertThrows(IllegalStateException.class, this::stage);
        assertEquals(id(7), queue.find(photo.id).finishSetId);
    }

    @Test public void changedFrozenMetadataOrDigestCannotStage() throws Exception {
        finish.finishDigest = "bad"; fields.updateAction(finish); assertThrows(IllegalStateException.class, this::stage);
        JSONObject entry = new JSONArray(finish.finishPhotosJson).getJSONObject(0); entry.put("captured_at", "2026-10-08T00:00:31Z");
        finish.finishPhotosJson = new JSONArray().put(entry).toString(); finish.finishDigest = PhotoOwner.digest(finish.finishPhotosJson);
        fields.updateAction(finish); assertThrows(IllegalStateException.class, this::stage);
    }

    @Test public void duplicateFrozenMembershipCannotStage() throws Exception {
        JSONArray entries = new JSONArray(finish.finishPhotosJson); entries.put(entries.getJSONObject(0));
        finish.finishPhotosJson = entries.toString(); finish.finishDigest = PhotoOwner.digest(finish.finishPhotosJson);
        fields.updateAction(finish); assertThrows(IllegalStateException.class, this::stage);
    }

    @Test public void changedPreparedFingerprintCannotReplaceTheOriginalBinding() throws Exception {
        PhotoTransfer row = stage();
        assertThrows(IllegalStateException.class, () -> queue.stage(ownerId, org, finish.actionId, photo.id, "0".repeat(64), row.preparedSize));
        assertThrows(IllegalStateException.class, () -> queue.stage(ownerId, org, finish.actionId, photo.id, row.preparedSha256, row.preparedSize + 1));
        assertEquals(row.preparedSha256, queue.find(photo.id).preparedSha256);
    }

    @Test public void malformedOrUnsupportedPreparedIdentityIsRejected() throws Exception {
        assertThrows(IllegalStateException.class, () -> queue.stage(ownerId, org, finish.actionId, photo.id, "bad", 100));
        assertThrows(IllegalStateException.class, () -> queue.stage(ownerId, org, finish.actionId, photo.id, "0".repeat(64), PhotoTransferDao.MAX_PREPARED_BYTES + 1));
        assertTrue(queue.list(ownerId, org).isEmpty());
    }

    @Test public void registrationRequiresExactContentDestinationAndVersion() throws Exception {
        PhotoTransfer row = stage();
        assertThrows(IllegalStateException.class, () -> queue.registered(ownerId, org, photo.id, version, "other", key(), row.preparedSha256, row.preparedSize, "WAITING"));
        assertThrows(IllegalStateException.class, () -> queue.registered(ownerId, org, photo.id, version, "fwh-review-private", key() + "/other", row.preparedSha256, row.preparedSize, "WAITING"));
        assertThrows(IllegalStateException.class, () -> queue.registered(ownerId, org, photo.id, version, "fwh-review-private", key(), row.preparedSha256, row.preparedSize + 1, "WAITING"));
        registered(); assertThrows(IllegalStateException.class, () -> queue.registered(ownerId, org, photo.id, id(99), "fwh-review-private", key(), row.preparedSha256, row.preparedSize, "WAITING"));
    }

    @Test public void registrationDoesNotProveAbsenceOrReceipt() throws Exception {
        PhotoTransfer row = registered(); assertEquals("UNCERTAIN", row.state); assertEquals("", row.receiptId);
        assertThrows(IllegalStateException.class, () -> queue.creating(ownerId, org, photo.id, version));
        assertThrows(IllegalStateException.class, () -> queue.confirmedAbsent(id(99), org, photo.id, version));
        assertThrows(IllegalStateException.class, () -> queue.confirmedAbsent(ownerId, org, photo.id, id(99)));
    }

    @Test public void receivedRegistrationStillRequiresExactVerifierReceipt() throws Exception {
        PhotoTransfer row = stage(); queue.registered(ownerId, org, photo.id, version, "fwh-review-private", key(), row.preparedSha256, row.preparedSize, "RECEIVED");
        assertEquals("VERIFY_PENDING", queue.find(photo.id).state); assertEquals("", queue.find(photo.id).receiptId);
        assertThrows(IllegalStateException.class, () -> queue.confirmedAbsent(ownerId, org, photo.id, version));
    }

    @Test public void untrustedTusOriginsAndRedirectShapesCannotBeJournaled() throws Exception {
        registered(); queue.confirmedAbsent(ownerId, org, photo.id, version); queue.creating(ownerId, org, photo.id, version);
        for (String bad : new String[] {"http://" + url.substring(8), url + "?token=secret", url + "#fragment",
                url.replace("vyocaujuwrivoqynvitm", "otherproject"), url.replace("https://", "https://user@"),
                url.replace(".co/", ".co:443/"), url.replace("test-session", "../object"),
                url.replace("test-session", "%2e%2e/object"), url.replace("test-session", "")}) {
            assertFalse(bad, PhotoTransferDao.safeTusUrl(bad));
            assertThrows(IllegalStateException.class, () -> queue.sessionCreated(ownerId, org, photo.id, version, bad));
        }
        assertEquals("CREATING", queue.find(photo.id).state); assertTrue(PhotoTransferDao.safeTusUrl(url));
    }

    @Test public void lostCreationResponseStaysUncertainAcrossActualRestart() throws Exception {
        PhotoTransfer initial = registered(); queue.confirmedAbsent(ownerId, org, photo.id, version);
        queue.creating(ownerId, org, photo.id, version); db.close(); open(); queue.recoverInterrupted(ownerId, org);
        PhotoTransfer recovered = queue.find(photo.id); assertEquals("UNCERTAIN", recovered.state); assertEquals("", recovered.tusUrl);
        assertEquals(initial.beginActionId, recovered.beginActionId);
        assertThrows(IllegalStateException.class, () -> queue.creating(ownerId, org, photo.id, version));
    }

    @Test public void confirmedOffsetAndSessionSurviveActualRestart() throws Exception {
        PhotoTransfer row = uploading(); queue.offsetConfirmed(ownerId, org, photo.id, version, url, 0, 12);
        db.close(); open(); queue.recoverInterrupted(ownerId, org);
        PhotoTransfer recovered = queue.find(photo.id); assertEquals("UNCERTAIN", recovered.state);
        assertEquals(url, recovered.tusUrl); assertEquals(12, recovered.confirmedOffset); assertEquals(row.preparedSize, recovered.preparedSize);
        queue.sessionReconciled(ownerId, org, photo.id, version, url, row.preparedSize, 16);
        assertEquals("UPLOADING", queue.find(photo.id).state); assertEquals(16, queue.find(photo.id).confirmedOffset);
    }

    @Test public void wrongSessionAndStaleOffsetsCannotAdvanceOrRewindProgress() throws Exception {
        PhotoTransfer row = uploading(); queue.offsetConfirmed(ownerId, org, photo.id, version, url, 0, 12);
        assertThrows(IllegalStateException.class, () -> queue.offsetConfirmed(ownerId, org, photo.id, version, url, 0, 20));
        assertThrows(IllegalStateException.class, () -> queue.offsetConfirmed(ownerId, org, photo.id, version, url + "wrong", 12, 20));
        assertThrows(IllegalStateException.class, () -> queue.offsetConfirmed(ownerId, org, photo.id, version, url, 12, 11));
        assertThrows(IllegalStateException.class, () -> queue.offsetConfirmed(ownerId, org, photo.id, version, url, 12, row.preparedSize + 1));
        queue.uncertain(ownerId, org, photo.id, version, 100);
        assertThrows(IllegalStateException.class, () -> queue.sessionReconciled(ownerId, org, photo.id, version, url, row.preparedSize - 1, 12));
        assertThrows(IllegalStateException.class, () -> queue.sessionReconciled(ownerId, org, photo.id, version, url, row.preparedSize, 11));
        assertEquals(12, queue.find(photo.id).confirmedOffset); assertEquals(100, queue.find(photo.id).retryNotBefore);
    }

    @Test public void sentOrEvenFullyConfirmedBytesAreNotAReceipt() throws Exception {
        PhotoTransfer row = uploading(); assertEquals(0, row.confirmedOffset);
        queue.offsetConfirmed(ownerId, org, photo.id, version, url, 0, row.preparedSize);
        assertEquals("VERIFY_PENDING", queue.find(photo.id).state); assertEquals("", queue.find(photo.id).receiptId);
        assertEquals("WAITING", fields.photo(photo.id).state);
    }

    @Test public void verifiedReceiptIsImmutableDurableAndNeverDeletesFiles() throws Exception {
        byte[] original = Files.readAllBytes(new File(photo.originalPath).toPath());
        byte[] prepared = Files.readAllBytes(new File(photo.preparedPath).toPath()); registered();
        queue.verifiedResponse(ownerId, org, photo.id, version, receipt(photo.id, version, id(9)), 123);
        queue.verifiedResponse(ownerId, org, photo.id, version, receipt(photo.id, version, id(9)), 999);
        assertThrows(IllegalStateException.class, () -> queue.verifiedResponse(ownerId, org, photo.id, version, receipt(photo.id, version, id(99)), 999));
        db.close(); open(); queue.recoverInterrupted(ownerId, org); queue.uncertain(ownerId, org, photo.id, version, 1000);
        assertEquals("RECEIVED", queue.find(photo.id).state); assertEquals(123, queue.find(photo.id).receiptSavedAt);
        assertEquals(id(9), queue.find(photo.id).receiptId); assertEquals("WAITING", fields.photo(photo.id).state);
        assertArrayEquals(original, Files.readAllBytes(new File(photo.originalPath).toPath()));
        assertArrayEquals(prepared, Files.readAllBytes(new File(photo.preparedPath).toPath()));
    }

    @Test public void foreignMalformedOrNonReceivedResponsesNeverBecomeReceipts() throws Exception {
        registered();
        for (String bad : new String[] {receipt(id(99), version, id(9)), receipt(photo.id, id(99), id(9)),
                receipt(photo.id, version, "bad"), "{}", receipt(photo.id, version, id(9)).replace("RECEIVED", "WAITING"),
                new JSONObject(receipt(photo.id, version, id(9))).put("delivered", true).toString()})
            assertThrows(IllegalStateException.class, () -> queue.verifiedResponse(ownerId, org, photo.id, version, bad, 123));
        assertThrows(IllegalStateException.class, () -> queue.verifiedResponse(id(99), org, photo.id, version, receipt(photo.id, version, id(9)), 123));
        assertEquals("", queue.find(photo.id).receiptId);
    }

    @Test public void registrationReplayCannotEraseProgressOrReceipt() throws Exception {
        PhotoTransfer row = uploading(); queue.offsetConfirmed(ownerId, org, photo.id, version, url, 0, 12);
        queue.registered(ownerId, org, photo.id, version, "fwh-review-private", key(), row.preparedSha256, row.preparedSize, "WAITING");
        assertEquals(12, queue.find(photo.id).confirmedOffset); assertEquals(url, queue.find(photo.id).tusUrl);
        queue.verifiedResponse(ownerId, org, photo.id, version, receipt(photo.id, version, id(9)), 123);
        queue.registered(ownerId, org, photo.id, version, "fwh-review-private", key(), row.preparedSha256, row.preparedSize, "WAITING");
        assertEquals("RECEIVED", queue.find(photo.id).state);
    }

    @Test public void exactAbsenceIsRequiredToResetAnUncertainSession() throws Exception {
        uploading(); queue.offsetConfirmed(ownerId, org, photo.id, version, url, 0, 12);
        assertThrows(IllegalStateException.class, () -> queue.confirmedAbsent(ownerId, org, photo.id, version));
        queue.uncertain(ownerId, org, photo.id, version, 100);
        queue.confirmedAbsent(ownerId, org, photo.id, version);
        assertEquals("TRANSFER_PENDING", queue.find(photo.id).state); assertEquals(0, queue.find(photo.id).confirmedOffset);
        assertEquals("", queue.find(photo.id).tusUrl);
    }

    @Test public void oneMissingOriginalDoesNotBlockOtherAcceptedPhotos() throws Exception {
        ProtectedPhoto good = anotherPhoto(); assertTrue(new File(photo.originalPath).delete());
        assertEquals(PhotoTransferCoordinator.Outcome.HELD, coordinator(true).stageAccepted(ownerId, org, () -> false));
        assertNull(queue.find(photo.id)); assertNotNull(queue.find(good.id)); assertTrue(new File(good.originalPath).exists());
    }

    @Test public void acceptedHistoricalFinishStagesWithoutAnyCurrentAssignmentCache() throws Exception {
        assertTrue(fields.listForOwner(ownerId, org).isEmpty()); assertEquals(1, fields.unstagedAcceptedPhotos(ownerId, org));
        assertEquals(PhotoTransferCoordinator.Outcome.STAGED, coordinator(true).stageAccepted(ownerId, org, () -> false));
        assertNotNull(queue.find(photo.id)); assertEquals(0, fields.unstagedAcceptedPhotos(id(99), org));
    }

    @Test public void recoveryModeAndStoppedDrainMakeNoJournalOrFileChanges() throws Exception {
        byte[] original = Files.readAllBytes(new File(photo.originalPath).toPath());
        assertEquals(PhotoTransferCoordinator.Outcome.PAUSED, coordinator(false).stageAccepted(ownerId, org, () -> false));
        assertEquals(PhotoTransferCoordinator.Outcome.PAUSED, coordinator(true).stageAccepted(ownerId, org, () -> true));
        assertNull(queue.find(photo.id)); assertArrayEquals(original, Files.readAllBytes(new File(photo.originalPath).toPath()));
    }

    @Test public void accountSwitchWhileStagingIsQueuedCannotCommitAnotherOwnersEvidence() throws Exception {
        CountDownLatch waiting = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService runner = Executors.newSingleThreadExecutor();
        java.util.concurrent.atomic.AtomicInteger checks = new java.util.concurrent.atomic.AtomicInteger();
        try {
            PhotoTransferCoordinator coordinator = coordinator(true);
            Future<PhotoTransferCoordinator.Outcome> result = runner.submit(() -> coordinator.stageAccepted(ownerId, org, () -> {
                if (checks.incrementAndGet() == 2) {
                    waiting.countDown();
                    try { if (!release.await(5, TimeUnit.SECONDS)) throw new AssertionError("Switch was not released."); }
                    catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return true; }
                }
                return false;
            }));
            assertTrue(waiting.await(5, TimeUnit.SECONDS));
            sessions.signOut(); sessions.install(sessions.beginLogin(), OfflineActionTest.session(id(99), org));
            release.countDown();
            assertEquals(PhotoTransferCoordinator.Outcome.PAUSED, result.get(5, TimeUnit.SECONDS));
            assertNull(queue.find(photo.id)); assertTrue(queue.list(id(99), org).isEmpty());
        } finally { release.countDown(); runner.shutdownNow(); }
    }

    @Test public void durableDrainRegistersUploadsVerifiesAndPreservesBothFiles() throws Exception {
        byte[] original = Files.readAllBytes(new File(photo.originalPath).toPath());
        byte[] prepared = Files.readAllBytes(new File(photo.preparedPath).toPath());
        FakeRemote remote = new FakeRemote();
        assertEquals(PhotoTransferCoordinator.Outcome.STAGED,
                coordinator(remote).drain(ownerId, org, () -> false));
        PhotoTransfer done = queue.find(photo.id);
        assertEquals("RECEIVED", done.state); assertEquals(id(9), done.receiptId);
        assertEquals(1, remote.registerCalls); assertEquals(1, remote.statusCalls);
        assertEquals(1, remote.createCalls); assertEquals(1, remote.patchCalls);
        assertEquals(1, remote.verifyCalls);
        assertArrayEquals(original, Files.readAllBytes(new File(photo.originalPath).toPath()));
        assertArrayEquals(prepared, Files.readAllBytes(new File(photo.preparedPath).toPath()));
        assertEquals("WAITING", fields.photo(photo.id).state);
    }

    @Test public void interruptedUploadHeadsExactSessionBeforeResumingFromServerOffset() throws Exception {
        PhotoTransfer row = uploading(); queue.offsetConfirmed(ownerId, org, photo.id, version, url, 0, 12);
        FakeRemote remote = new FakeRemote();
        remote.heads.put(photo.id, PhotoTransferCoordinator.Head.present(row.preparedSize, 16));
        assertEquals(PhotoTransferCoordinator.Outcome.STAGED,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals("head:" + photo.id, remote.events.get(0));
        assertEquals(16, remote.lastPatchOffset);
        assertEquals("RECEIVED", queue.find(photo.id).state);
    }

    @Test public void lostCreateResponseRequiresExactAbsenceBeforeReplacementSession() throws Exception {
        registered(); queue.confirmedAbsent(ownerId, org, photo.id, version);
        queue.creating(ownerId, org, photo.id, version);
        FakeRemote remote = new FakeRemote();
        assertEquals(PhotoTransferCoordinator.Outcome.STAGED,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals(0, remote.registerCalls);
        assertTrue(remote.events.indexOf("status:" + photo.id)
                < remote.events.indexOf("create:" + photo.id));
        assertEquals("RECEIVED", queue.find(photo.id).state);
    }

    @Test public void exactPresentStatusSkipsReplacementUploadAndOnlyVerifies() throws Exception {
        registered(); FakeRemote remote = new FakeRemote();
        remote.statuses.put(photo.id, "PRESENT");
        assertEquals(PhotoTransferCoordinator.Outcome.STAGED,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals(0, remote.createCalls); assertEquals(0, remote.patchCalls);
        assertEquals(1, remote.verifyCalls); assertEquals("RECEIVED", queue.find(photo.id).state);
    }

    @Test public void exactReceivedStatusSavesReceiptWithoutVerifierOrUpload() throws Exception {
        registered(); FakeRemote remote = new FakeRemote();
        remote.statuses.put(photo.id, "RECEIVED");
        assertEquals(PhotoTransferCoordinator.Outcome.STAGED,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals(0, remote.createCalls); assertEquals(0, remote.patchCalls);
        assertEquals(0, remote.verifyCalls); assertEquals(id(9), queue.find(photo.id).receiptId);
    }

    @Test public void ambiguousPatchNeverAdvancesLocallyAndNextHeadCanFinishWithoutResend() throws Exception {
        PhotoTransfer row = uploading(); FakeRemote remote = new FakeRemote();
        remote.heads.put(photo.id, PhotoTransferCoordinator.Head.present(row.preparedSize, 0));
        remote.failPatchOnce.add(photo.id);
        assertEquals(PhotoTransferCoordinator.Outcome.RETRY,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals("UNCERTAIN", queue.find(photo.id).state);
        assertEquals(0, queue.find(photo.id).confirmedOffset); assertEquals(1, remote.patchCalls);
        remote.heads.put(photo.id,
                PhotoTransferCoordinator.Head.present(row.preparedSize, row.preparedSize));
        queue.find(photo.id).retryNotBefore = 0;
        PhotoTransfer retryRow = queue.find(photo.id); retryRow.retryNotBefore = 0; queue.update(retryRow);
        assertEquals(PhotoTransferCoordinator.Outcome.STAGED,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals(1, remote.patchCalls); assertEquals("RECEIVED", queue.find(photo.id).state);
    }

    @Test public void changedPreparedDerivativeStopsBeforeAnyMoreBytes() throws Exception {
        PhotoTransfer row = uploading();
        Bitmap replacement = Bitmap.createBitmap(31, 63, Bitmap.Config.ARGB_8888);
        try (FileOutputStream out = new FileOutputStream(photo.preparedPath)) {
            assertTrue(replacement.compress(Bitmap.CompressFormat.JPEG, 70, out));
        }
        replacement.recycle();
        FakeRemote remote = new FakeRemote();
        remote.heads.put(photo.id, PhotoTransferCoordinator.Head.present(row.preparedSize, 0));
        assertEquals(PhotoTransferCoordinator.Outcome.HELD,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals(0, remote.patchCalls); assertEquals("UNCERTAIN", queue.find(photo.id).state);
        assertFalse(fields.photo(photo.id).prepared); assertTrue(new File(photo.originalPath).exists());
    }

    @Test public void accountSwitchDuringRegistrationCannotCommitOtherOwnersEvidence() throws Exception {
        FakeRemote remote = new FakeRemote(); remote.switchAccountOnRegister = true;
        assertEquals(PhotoTransferCoordinator.Outcome.PAUSED,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals(1, remote.registerCalls); assertEquals("REGISTER_PENDING", queue.find(photo.id).state);
        assertEquals(id(99), sessions.load().userId); assertTrue(new File(photo.originalPath).exists());
    }

    @Test public void oneRemoteConflictDoesNotBlockAnotherPhotosReceipt() throws Exception {
        ProtectedPhoto other = anotherPhoto(); FakeRemote remote = new FakeRemote();
        remote.statuses.put(photo.id, "CONFLICT");
        assertEquals(PhotoTransferCoordinator.Outcome.HELD,
                coordinator(remote).drain(ownerId, org, () -> false));
        assertEquals("UNCERTAIN", queue.find(photo.id).state);
        assertEquals("RECEIVED", queue.find(other.id).state);
        assertTrue(new File(photo.originalPath).exists()); assertTrue(new File(other.originalPath).exists());
    }

    @Test public void journaledMissingDerivativeIsNeverSilentlyRecompressed() throws Exception {
        stage(); byte[] original = Files.readAllBytes(new File(photo.originalPath).toPath()); assertTrue(new File(photo.preparedPath).delete());
        photos.io.submit(() -> { photos.recover(); return null; }).get(5, TimeUnit.SECONDS);
        assertFalse(new File(photo.preparedPath).exists()); assertFalse(fields.photo(photo.id).prepared);
        assertTrue(fields.photo(photo.id).problem.contains("recovery")); assertNotNull(queue.find(photo.id));
        assertArrayEquals(original, Files.readAllBytes(new File(photo.originalPath).toPath()));
    }
}
