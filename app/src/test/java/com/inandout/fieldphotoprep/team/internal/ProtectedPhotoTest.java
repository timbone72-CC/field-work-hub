package com.inandout.fieldphotoprep.team.internal;
import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import androidx.room.Room;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import java.io.*;
import java.util.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=34)
public class ProtectedPhotoTest {
    TeamDatabase db; CachedWorkOrderDao dao; RoomAssignmentStore store;
    final SupabaseApi.AuthSession actor=OfflineActionTest.session("a","org");
    Context context; String databaseName; File directory; PhotoOwner owner; SessionCoordinator sessions;
    @Before public void setup() throws Exception {
        context=RuntimeEnvironment.getApplication();directory=new File(context.getCacheDir(),"photo-test-"+UUID.randomUUID());assertTrue(directory.mkdirs());
        databaseName="protected-test-"+UUID.randomUUID()+".db";db=Room.databaseBuilder(context,TeamDatabase.class,databaseName).allowMainThreadQueries().build();dao=db.cachedWorkOrderDao();store=new RoomAssignmentStore(dao);
        SupabaseApi.WorkOrder work=OfflineActionTest.wo("1","instance");work.requirementSnapshotJson=PhotoRequirementsTest.configuration(3,1,1).toString();store.replace(actor,List.of(work),1);
        dao.createAction(actor,"1","run-1","START","2026-10-03T12:00:00Z");
        context.getSharedPreferences(SecureSessionStore.PREFERENCES_NAME,Context.MODE_PRIVATE).edit().clear().commit();
        SecureSessionStore secure=new SecureSessionStore(context,new SecureSessionStore.Crypto(){public byte[] encrypt(byte[] v){return v;}public byte[] decrypt(byte[] v){return v;}});
        sessions=new SessionCoordinator(secure,t->actor);sessions.install(sessions.beginLogin(),actor);owner=new PhotoOwner(context,dao,sessions);
    }
    @After public void close(){owner.io.shutdownNow();db.close();context.deleteDatabase(databaseName);for(File f:Objects.requireNonNull(directory.listFiles()))f.delete();directory.delete();}
    ProtectedPhoto reservation(String item) {
        String id=UUID.randomUUID().toString();return dao.reservePhoto(actor,"1","run-1",item,"2026-10-03T12:00:10Z",id,new File(directory,id+".jpg").getAbsolutePath(),new File(directory,id+"-prep.jpg").getAbsolutePath());
    }
    void jpeg(ProtectedPhoto p) throws Exception {Bitmap b=Bitmap.createBitmap(64,32,Bitmap.Config.ARGB_8888);try(FileOutputStream o=new FileOutputStream(p.originalPath)){assertTrue(b.compress(Bitmap.CompressFormat.JPEG,95,o));}b.recycle();}
    ProtectedPhoto photo(String item) throws Exception {ProtectedPhoto p=reservation(item);jpeg(p);owner.captured(p.id);return dao.photo(p.id);}
    @Test public void onePhotoCreditsOneItemAndExtraCreditsTotalWithAtomicFrozenIntent() throws Exception {
        ProtectedPhoto a=photo(PhotoRequirementsTest.id(2));assertTrue(a.readable());
        assertThrows(IllegalStateException.class,()->dao.createAction(actor,"1","run-1","COMPLETE","2026-10-03T12:01:00Z"));
        photo(PhotoRequirementsTest.id(3));assertThrows(IllegalStateException.class,()->dao.createAction(actor,"1","run-1","COMPLETE","2026-10-03T12:01:00Z"));
        photo("");FieldAction finish=dao.createAction(actor,"1","run-1","COMPLETE","2026-10-03T12:01:00Z");
        assertEquals(3,new JSONArray(finish.finishPhotosJson).length());assertFalse(finish.finishSetId.isEmpty());
        for(ProtectedPhoto p:dao.photos("a","org","1","run-1"))assertEquals(finish.finishSetId,p.finishSetId);
        dao.photoPrepared(a.id,true,"");assertEquals(finish.finishSetId,dao.photo(a.id).finishSetId);
        assertEquals(finish.actionId,dao.createAction(actor,"1","run-1","COMPLETE","2026-10-03T12:02:00Z").actionId);
        assertThrows(IllegalStateException.class,()->reservation(""));assertThrows(IllegalStateException.class,()->dao.beginDiscard(actor,a.id));owner.ensureFrozenReadable(finish);
    }
    @Test public void interruptedNonemptyCaptureIsPreservedAndEmptyCaptureDoesNotCount() throws Exception {
        ProtectedPhoto p=reservation(PhotoRequirementsTest.id(2));jpeg(p);owner.recover();assertTrue(dao.photo(p.id).readable());assertTrue(new File(p.originalPath).isFile());
        ProtectedPhoto empty=reservation("");owner.captured(empty.id);assertEquals("DISCARDED",dao.photo(empty.id).state);
        assertEquals(1,dao.photos("a","org","1","run-1").stream().filter(ProtectedPhoto::readable).count());
    }
    @Test public void discardIntentAndWrongAccountCannotDropOrRebindPhotos() throws Exception {
        ProtectedPhoto p=photo(PhotoRequirementsTest.id(2));
        assertThrows(IllegalStateException.class,()->dao.beginDiscard(OfflineActionTest.session("b","org"),p.id));
        dao.beginDiscard(actor,p.id);PhotoOwner restarted=new PhotoOwner(context,dao,sessions);restarted.recover();restarted.io.shutdownNow();
        assertEquals("DISCARDED",dao.photo(p.id).state);assertFalse(new File(p.originalPath).exists());
    }
    @Test public void requirementRaceProtectsSnapshotAndPhotosInsteadOfReplacingCache() throws Exception {
        ProtectedPhoto p=photo(PhotoRequirementsTest.id(2));SupabaseApi.WorkOrder changed=OfflineActionTest.wo("1","instance");
        JSONObject j=PhotoRequirementsTest.configuration(3,1,1);j.put("revision",PhotoRequirementsTest.id(90));changed.requirementSnapshotJson=j.toString();store.replace(actor,List.of(changed),2);
        assertEquals("REQUIREMENTS_CHANGED",dao.find("a","org","1","run-1").conflictReason);assertTrue(new File(p.originalPath).exists());
        assertEquals(PhotoRequirementsTest.id(1),PhotoRequirements.parse(dao.find("a","org","1","run-1").requirementSnapshotJson).revision);
        assertThrows(IllegalStateException.class,()->reservation(""));
    }
    @Test public void preparingASeparateCopyNeverMutatesTheOriginal() throws Exception {
        ProtectedPhoto p=reservation("");jpeg(p);byte[] before=java.nio.file.Files.readAllBytes(new File(p.originalPath).toPath());owner.captured(p.id);
        assertArrayEquals(before,java.nio.file.Files.readAllBytes(new File(p.originalPath).toPath()));
        assertTrue(dao.photo(p.id).readable());assertNotEquals(p.originalPath,p.preparedPath);
    }
    @Test public void frozenSetAndProtectedOriginalSurviveActualRoomCloseAndReopen() throws Exception {
        photo(PhotoRequirementsTest.id(2));photo(PhotoRequirementsTest.id(3));ProtectedPhoto extra=photo("");
        FieldAction finish=dao.createAction(actor,"1","run-1","COMPLETE","2026-10-03T12:01:00Z");db.close();
        db=Room.databaseBuilder(context,TeamDatabase.class,databaseName).allowMainThreadQueries().build();dao=db.cachedWorkOrderDao();
        assertEquals(finish.finishDigest,dao.action(finish.actionId).finishDigest);
        assertEquals(finish.finishPhotosJson,dao.action(finish.actionId).finishPhotosJson);
        assertEquals(finish.finishSetId,dao.photo(extra.id).finishSetId);assertTrue(dao.photo(extra.id).readable());
        PhotoOwner restarted=new PhotoOwner(context,dao,sessions);restarted.ensureFrozenReadable(dao.action(finish.actionId));restarted.io.shutdownNow();
    }
    @Test public void derivativeKeepsSmallPhotoDimensionsAndAppliesOrientation() throws Exception {
        ProtectedPhoto p=reservation("");jpeg(p);
        android.media.ExifInterface exif=new android.media.ExifInterface(p.originalPath);
        exif.setAttribute(android.media.ExifInterface.TAG_ORIENTATION,"6");exif.saveAttributes();
        byte[] original=java.nio.file.Files.readAllBytes(new File(p.originalPath).toPath());owner.captured(p.id);assertTrue(dao.photo(p.id).prepared);
        android.graphics.BitmapFactory.Options bounds=new android.graphics.BitmapFactory.Options();bounds.inJustDecodeBounds=true;
        android.graphics.BitmapFactory.decodeFile(p.preparedPath,bounds);assertEquals(32,bounds.outWidth);assertEquals(64,bounds.outHeight);
        assertArrayEquals(original,java.nio.file.Files.readAllBytes(new File(p.originalPath).toPath()));
    }
    @Test public void derivativeLimitsLongEdgeAndFailedPreparationStillProtectsAndCountsOriginal() throws Exception {
        ProtectedPhoto p=reservation("");Bitmap bitmap=Bitmap.createBitmap(4096,2048,Bitmap.Config.ARGB_8888);
        try(FileOutputStream out=new FileOutputStream(p.originalPath)){assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,95,out));}bitmap.recycle();
        owner.captured(p.id);assertTrue(dao.photo(p.id).prepared);
        android.graphics.BitmapFactory.Options bounds=new android.graphics.BitmapFactory.Options();bounds.inJustDecodeBounds=true;
        android.graphics.BitmapFactory.decodeFile(p.preparedPath,bounds);assertEquals(2048,bounds.outWidth);assertEquals(1024,bounds.outHeight);
        ProtectedPhoto blocked=reservation("");jpeg(blocked);assertTrue(new File(blocked.preparedPath+".tmp").mkdir());owner.captured(blocked.id);
        assertTrue(dao.photo(blocked.id).readable());assertFalse(dao.photo(blocked.id).prepared);assertTrue(new File(blocked.originalPath).exists());
    }

    @Test public void concurrentShutterAndFinishCannotFreezeHalfCapturedBytes() throws Exception {
        photo(PhotoRequirementsTest.id(2));photo(PhotoRequirementsTest.id(3));photo("");
        java.util.concurrent.ExecutorService workers=java.util.concurrent.Executors.newFixedThreadPool(2);
        java.util.concurrent.CountDownLatch start=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.Future<Boolean> shutter=workers.submit(()->{start.await();try{reservation("");return true;}catch(IllegalStateException e){return false;}});
        java.util.concurrent.Future<Boolean> finish=workers.submit(()->{start.await();try{dao.createAction(actor,"1","run-1","COMPLETE","2026-10-03T12:01:00Z");return true;}catch(IllegalStateException e){return false;}});
        start.countDown();boolean captured=shutter.get(10,java.util.concurrent.TimeUnit.SECONDS),frozen=finish.get(10,java.util.concurrent.TimeUnit.SECONDS);workers.shutdownNow();
        assertNotEquals(captured,frozen);
        if(frozen)for(ProtectedPhoto p:dao.photos("a","org","1","run-1"))assertFalse(p.finishSetId.isEmpty());
        else assertEquals(1,dao.photos("a","org","1","run-1").stream().filter(p->"CAPTURING".equals(p.state)).count());
    }

}
