package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.room.Room;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;

/** Destructive operations run ONLY on fake app-private files and disposable local Room. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk=34)
public class PhotoCleanupExecutorTest {
    Context context;
    TeamDatabase db;
    CachedWorkOrderDao fields;
    PhotoCleanupDao journal;
    PhotoTransferDao transfers;
    PhotoOwner owner;
    SessionCoordinator sessions;
    SupabaseApi.AuthSession actor;
    File root;
    String database;
    String finishSet;
    FieldAction finish;
    final Set<Path> ownedFiles=new HashSet<>();

    @Before public void setup() throws Exception {
        context=RuntimeEnvironment.getApplication();
        root=new File(context.getFilesDir(),"protected-photos");
        if(!root.isDirectory()) assertTrue(root.mkdirs());
        database="cleanup-evidence-"+UUID.randomUUID()+".db";
        db=Room.databaseBuilder(context,TeamDatabase.class,database)
            .allowMainThreadQueries().build();
        fields=db.cachedWorkOrderDao();
        journal=db.photoCleanupDao();
        transfers=db.photoTransferDao();
        actor=OfflineActionTest.session("cleanup-owner","cleanup-org");
        context.getSharedPreferences(SecureSessionStore.PREFERENCES_NAME,Context.MODE_PRIVATE)
            .edit().clear().commit();
        SecureSessionStore secure=new SecureSessionStore(context,new SecureSessionStore.Crypto() {
            public byte[] encrypt(byte[] bytes) { return bytes; }
            public byte[] decrypt(byte[] bytes) { return bytes; }
        });
        sessions=new SessionCoordinator(secure,token->actor);
        assertTrue(sessions.install(sessions.beginLogin(),actor));
        owner=new PhotoOwner(context,fields,journal,sessions,true); // test seam; shipping flag OFF
        finishSet=UUID.randomUUID().toString();
    }

    @After public void cleanup() throws Exception {
        if(owner!=null) owner.io.shutdownNow();
        if(db!=null) db.close();
        if(database!=null) context.deleteDatabase(database);
        // Never delete other tests' or users' files from the shared app root.
        for(Path owned:ownedFiles) Files.deleteIfExists(owned);
        if(root!=null&&root.isDirectory()&&Objects.requireNonNull(root.list()).length==0)
            Files.deleteIfExists(root.toPath());
    }

    static String digest(byte[] bytes) throws Exception {
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder result=new StringBuilder();
        for(byte b:hash) result.append(String.format(Locale.ROOT,"%02x",b&255));
        return result.toString();
    }

    /** Exact prepared receipt for every captured image; all fake bytes live in this test app. */
    ProtectedPhoto addPhoto(String wo,String run,FieldAction action) throws Exception {
        String id=UUID.randomUUID().toString();
        byte[] original=("fake-original-"+id).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] prepared=("fake-prepared-"+id).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        File source=new File(root,id+"-original.jpg"), derivative=new File(root,id+"-prepared.jpg");
        Files.write(source.toPath(),original);
        Files.write(derivative.toPath(),prepared);
        ownedFiles.add(source.toPath());ownedFiles.add(derivative.toPath());
        ProtectedPhoto p=new ProtectedPhoto(id,actor.userId,actor.organizationId,wo,run,
                "assignment","revision","","2026-11-02T00:00:00Z",
                source.getAbsolutePath(),derivative.getAbsolutePath());
        p.state="WAITING";p.originalBytes=original.length;p.prepared=true;p.finishSetId=finishSet;
        fields.insertPhoto(p);
        PhotoTransfer t=new PhotoTransfer(id,p.ownerId,p.organizationId,wo,run,
                p.assignmentInstanceId,p.requirementRevision,p.itemId,p.capturedAt,
                action.actionId,finishSet,digest(prepared),prepared.length,
                UUID.randomUUID().toString(),UUID.randomUUID().toString());
        t.state="RECEIVED";t.transferVersion=UUID.randomUUID().toString();
        t.receiptId=UUID.randomUUID().toString();t.receiptSavedAt=1;
        transfers.insert(t);
        return p;
    }

    FieldAction acceptedFinish(String wo,String run) {
        FieldAction f=new FieldAction(UUID.randomUUID().toString(),
                actor.userId,actor.organizationId,wo,run,"assignment",
                "COMPLETE","2026-11-02T00:00:01Z",1,1);
        f.requirementRevision="revision";f.finishSetId=finishSet;
        f.state="ACCEPTED";f.acceptedAt="2026-11-02T00:00:02Z";
        f.canonicalStatus="FIELD_COMPLETE";
        return f;
    }

    void freezeAndInsert(FieldAction f,ProtectedPhoto... photos) throws Exception {
        JSONArray set=new JSONArray();
        for(ProtectedPhoto p:photos) set.put(new JSONObject().put("id",p.id));
        f.finishPhotosJson=set.toString();
        f.finishDigest=PhotoOwner.digest(f.finishPhotosJson);
        fields.insertAction(f);
    }

    ProtectedPhoto verified(String wo,String run) throws Exception {
        FieldAction f=acceptedFinish(wo,run);
        // Insert the accepted Finish before its transfer FK is written.
        f.finishPhotosJson=new JSONArray().toString();
        f.finishDigest=PhotoOwner.digest(f.finishPhotosJson);
        fields.insertAction(f);
        ProtectedPhoto p=addPhoto(wo,run,f);
        JSONArray set=new JSONArray().put(new JSONObject().put("id",p.id));
        f.finishPhotosJson=set.toString();
        f.finishDigest=PhotoOwner.digest(f.finishPhotosJson);
        fields.updateAction(f);
        return p;
    }

    void acceptedExtra(String wo,String run,ProtectedPhoto p) throws Exception {
        // Keep one accepted Finish tied to every photo in the frozen set.
        // Additional originals use the existing Finish action and its JSON
        // updated atomically for this isolated fixture only.
        FieldAction f=fields.action(transfers.find(p.id).finishActionId);
        JSONArray all=new JSONArray();
        for(ProtectedPhoto item:journal.workPhotos(actor.userId,actor.organizationId,wo))
            if(item.runId.equals(run)) all.put(new JSONObject().put("id",item.id));
        f.finishPhotosJson=all.toString();
        f.finishDigest=PhotoOwner.digest(f.finishPhotosJson);
        fields.updateAction(f);
    }

    void journal(ProtectedPhoto p) throws Exception {
        PhotoTransfer t=transfers.find(p.id);
        FieldAction a=fields.action(t.finishActionId);
        String packageId=UUID.randomUUID().toString();
        String exactServerSnapshot=new JSONObject()
            .put("eligible",true)
            .put("server_readiness_only",true)
            .put("private_receipt_verified",true)
            .put("retained_privately",true)
            .put("included_in_client_package",false)
            .put("photo_id",p.id).put("run_id",p.runId)
            .put("finish_set_id",p.finishSetId).put("finish_digest",a.finishDigest)
            .put("transfer_version",t.transferVersion)
            .put("package_id",packageId).toString();
        PhotoCleanupJournal record=new PhotoCleanupJournal(p.id,p.ownerId,p.organizationId,
                p.workOrderId,p.runId,p.finishSetId,a.finishDigest,t.transferVersion,
                t.receiptId,packageId,exactServerSnapshot,System.currentTimeMillis());
        journal.insert(record);
    }

    @Test public void approvedExactClosureDeletesOnlyOnePhotoAndKeepsReceipts() throws Exception {
        ProtectedPhoto a=verified("wo-a","run-a");
        journal(a);
        assertTrue(owner.cleanupVerified(actor,sessions.generation(),a.id));
        assertFalse(new File(a.originalPath).exists());
        assertFalse(new File(a.preparedPath).exists());
        assertEquals("CLEANED",journal.find(a.id).state);
        assertEquals("CLEANED",fields.photo(a.id).state);
        assertEquals(a.originalBytes,fields.photo(a.id).originalBytes);
        assertEquals("RECEIVED",transfers.find(a.id).state);
        assertEquals("ACCEPTED",fields.action(transfers.find(a.id).finishActionId).state);
        assertTrue(owner.cleanupVerified(actor,sessions.generation(),a.id)); // idempotent
    }

    @Test public void unsyncedActionOnAnotherRunBlocksCleanupButNotUnrelatedWO() throws Exception {
        ProtectedPhoto blocked=verified("wo-blocked","run-b");
        journal(blocked);
        FieldAction pending=new FieldAction(UUID.randomUUID().toString(),actor.userId,
            actor.organizationId,"wo-blocked","run-pending","assignment",
            "START","2026-11-02T00:00:01Z",2,2);
        fields.insertAction(pending);
        assertThrows(IllegalStateException.class,
            ()->owner.cleanupVerified(actor,sessions.generation(),blocked.id));
        assertEquals("HELD",journal.find(blocked.id).state);
        assertTrue(new File(blocked.originalPath).exists());
        ProtectedPhoto independent=verified("wo-independent","run-independent");
        journal(independent);
        assertTrue(owner.cleanupVerified(actor,sessions.generation(),independent.id));
        assertEquals("CLEANED",journal.find(independent.id).state);
        assertTrue(new File(blocked.originalPath).exists());
    }

    @Test public void anotherUnreceivedOrProblemPhotoBlocksWholeWO() throws Exception {
        ProtectedPhoto ready=verified("wo-private","run-1");
        FieldAction accepted=fields.action(transfers.find(ready.id).finishActionId);
        ProtectedPhoto extra=addPhoto("wo-private","run-1",accepted);
        acceptedExtra("wo-private","run-1",extra);
        journal(ready); // valid target proof; only the other photo is unresolved
        PhotoTransfer missing=transfers.find(extra.id);
        missing.state="UNCERTAIN";
        transfers.update(missing);
        assertThrows(IllegalStateException.class,
            ()->owner.cleanupVerified(actor,sessions.generation(),ready.id));
        assertEquals("HELD",journal.find(ready.id).state);
        assertTrue(new File(ready.originalPath).exists());
        assertTrue(new File(extra.originalPath).exists());
    }

    @Test public void restartFromCleaningCompletesOnlyAbsentAndRemainingExactFiles() throws Exception {
        ProtectedPhoto p=verified("wo-crash","run-crash");journal(p);
        journal.arm(actor.userId,actor.organizationId,p.id);
        journal.beginOrResume(actor.userId,actor.organizationId,p.id);
        assertEquals("CLEANING",journal.find(p.id).state);
        Files.delete(new File(p.originalPath).toPath()); // simulated crash after first erase
        db.close();
        db=Room.databaseBuilder(context,TeamDatabase.class,database)
            .allowMainThreadQueries().build();
        fields=db.cachedWorkOrderDao();journal=db.photoCleanupDao();
        owner.io.shutdownNow();
        owner=new PhotoOwner(context,fields,journal,sessions,true);
        assertEquals(1,owner.resumeInterruptedCleanup(actor,sessions.generation()));
        assertEquals("CLEANED",journal.find(p.id).state);
        assertEquals("CLEANED",fields.photo(p.id).state);
        assertFalse(new File(p.preparedPath).exists());
        assertEquals("RECEIVED",db.photoTransferDao().find(p.id).state);
    }

    @Test public void unexpectedPathStopsBeforeReadyAndDoesNotTouchOtherFile() throws Exception {
        ProtectedPhoto p=verified("wo-path","run-path");journal(p);
        File different=new File(root,"unrelated-evidence.jpg");
        Files.write(different.toPath(),new byte[]{1,2,3});
        ownedFiles.add(different.toPath());
        ProtectedPhoto mutated=fields.photo(p.id);
        mutated.originalPath=different.getAbsolutePath();
        // Test DAO update via narrow SQL (no runtime mutation method required).
        db.getOpenHelper().getWritableDatabase().execSQL(
            "UPDATE protected_photos SET originalPath=? WHERE id=?",
            new Object[]{different.getAbsolutePath(),p.id});
        assertThrows(java.io.IOException.class,
            ()->owner.cleanupVerified(actor,sessions.generation(),p.id));
        assertTrue(different.isFile());
        assertEquals("HELD",journal.find(p.id).state);
    }

    @Test public void wrongSessionNeverDeletesAnotherOwnerFiles() throws Exception {
        ProtectedPhoto p=verified("wo-foreign","run-foreign");journal(p);
        SupabaseApi.AuthSession foreign=OfflineActionTest.session("other-owner","cleanup-org");
        assertThrows(SessionCoordinator.SessionChanged.class,
            ()->owner.cleanupVerified(foreign,sessions.generation(),p.id));
        assertTrue(new File(p.originalPath).exists());
        assertEquals("HELD",journal.find(p.id).state);
    }

    @Test public void staleAcceptedFinishPreventsTerminalCleanup() throws Exception {
        ProtectedPhoto p=verified("wo-conflict","run-conflict");journal(p);
        db.getOpenHelper().getWritableDatabase().execSQL(
            "UPDATE field_actions SET state='CONFLICT' WHERE actionId=?",
            new Object[]{transfers.find(p.id).finishActionId});
        assertThrows(IllegalStateException.class,
            ()->owner.cleanupVerified(actor,sessions.generation(),p.id));
        assertTrue(new File(p.originalPath).exists());
        assertEquals("HELD",journal.find(p.id).state);
    }

    @Test public void disabledProductionModeNeverMovesHeldOrDeletesFiles() throws Exception {
        ProtectedPhoto p=verified("wo-off","run-off");journal(p);
        PhotoOwner gated=new PhotoOwner(context,fields,journal,sessions,false);
        try {
            assertFalse(gated.cleanupVerified(actor,sessions.generation(),p.id));
            assertEquals("HELD",journal.find(p.id).state);
            assertTrue(new File(p.originalPath).exists());
        } finally {gated.io.shutdownNow();}
    }
}
