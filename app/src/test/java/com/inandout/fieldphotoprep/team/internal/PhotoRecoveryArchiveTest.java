package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.room.Room;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class) @Config(sdk=34)
public class PhotoRecoveryArchiveTest {
    Context context; TeamDatabase db; CachedWorkOrderDao dao; File root;
    SessionCoordinator sessions; PhotoOwner owner;
    SupabaseApi.AuthSession actor=OfflineActionTest.session("a","org"); long gen;
    @Before public void setup() throws Exception {
        context=RuntimeEnvironment.getApplication();
        db=Room.inMemoryDatabaseBuilder(context,TeamDatabase.class).allowMainThreadQueries().build();dao=db.cachedWorkOrderDao();
        root=new File(context.getFilesDir(),"protected-photos");assertTrue(root.isDirectory()||root.mkdirs());
        context.getSharedPreferences(SecureSessionStore.PREFERENCES_NAME,Context.MODE_PRIVATE).edit().clear().commit();
        SecureSessionStore store=new SecureSessionStore(context,new SecureSessionStore.Crypto(){public byte[] encrypt(byte[] b){return b;}public byte[] decrypt(byte[] b){return b;}});
        sessions=new SessionCoordinator(store,t->{throw new AssertionError("Export must not contact Auth");});
        gen=sessions.beginLogin();sessions.install(gen,actor);owner=new PhotoOwner(context,dao,sessions);
    }
    @After public void close(){owner.io.shutdownNow();db.close();for(File f:Objects.requireNonNull(root.listFiles()))f.delete();}
    ProtectedPhoto photo(String who,String org,String state)throws Exception{
        String id=UUID.randomUUID().toString();
        ProtectedPhoto p=new ProtectedPhoto(id,who,org,"wo","run","assignment","revision","item","2026-10-12T21:00:00Z",
                new File(root,id+"-original.jpg").getPath(),new File(root,id+"-prepared.jpg").getPath());
        // Damaged evidence must remain exportable exactly as stored, without preparation.
        Files.write(new File(p.originalPath).toPath(),new byte[]{1,2,3,4,5});
        p.state=state;p.originalBytes=5;p.finishSetId="frozen-finish";dao.insertPhoto(p);return p;
    }
    Map<String,byte[]> entries(byte[] bytes)throws Exception{
        Map<String,byte[]> out=new LinkedHashMap<>();
        try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(bytes))){ZipEntry e;while((e=zip.getNextEntry())!=null)out.put(e.getName(),zip.readAllBytes());}
        return out;
    }
    void export(ProtectedPhoto p,OutputStream out)throws Exception{owner.exportOriginals(actor,gen,List.of(p.id),out);}
    @Test public void frozenProblemOriginalCopiesExactlyWithoutChangingRoomOrOriginal()throws Exception{
        ProtectedPhoto p=photo("a","org","PROBLEM");ByteArrayOutputStream out=new ByteArrayOutputStream();export(p,out);
        Map<String,byte[]> files=entries(out.toByteArray());assertEquals(2,files.size());
        assertArrayEquals(new byte[]{1,2,3,4,5},files.get("originals/"+p.id+".jpg"));
        JSONObject manifest=new JSONObject(new String(files.get("recovery.json"),java.nio.charset.StandardCharsets.UTF_8));
        assertEquals("fwh-original-recovery-v1",manifest.getString("format"));
        assertEquals(5,manifest.getJSONArray("photos").getJSONObject(0).getLong("size"));
        assertEquals("frozen-finish",dao.photo(p.id).finishSetId);assertEquals("PROBLEM",dao.photo(p.id).state);
        assertFalse(dao.photo(p.id).prepared);assertNull(dao.transfer(p.id));
        assertArrayEquals(new byte[]{1,2,3,4,5},Files.readAllBytes(new File(p.originalPath).toPath()));
    }
    @Test public void otherOwnerAndOrgCannotExportEvenWithKnownPhotoId()throws Exception{
        ProtectedPhoto wrongUser=photo("b","org","WAITING"),wrongOrg=photo("a","other","WAITING");
        for(ProtectedPhoto p:List.of(wrongUser,wrongOrg)){ByteArrayOutputStream out=new ByteArrayOutputStream();
            assertThrows(IOException.class,()->export(p,out));assertEquals(0,out.size());assertTrue(new File(p.originalPath).exists());}
    }
    @Test public void signedOutAndReplacementLoginRejectOldPickerRequest()throws Exception{
        ProtectedPhoto p=photo("a","org","WAITING");sessions.signOut();
        assertThrows(SessionCoordinator.SessionChanged.class,()->export(p,new ByteArrayOutputStream()));
        long newer=sessions.beginLogin();sessions.install(newer,OfflineActionTest.session("b","org"));
        assertThrows(SessionCoordinator.SessionChanged.class,()->export(p,new ByteArrayOutputStream()));
        assertTrue(new File(p.originalPath).exists());
    }
    @Test public void signOutDuringCopyCannotWriteFinalManifest()throws Exception{
        ProtectedPhoto p=photo("a","org","WAITING");ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        OutputStream out=new FilterOutputStream(bytes){boolean changed;@Override public void write(byte[] b,int o,int n)throws IOException{
            bytes.write(b,o,n);if(!changed){changed=true;sessions.signOut();}}};
        assertThrows(SessionCoordinator.SessionChanged.class,()->export(p,out));
        assertFalse(new String(bytes.toByteArray(),java.nio.charset.StandardCharsets.ISO_8859_1).contains("recovery.json"));
        assertEquals("WAITING",dao.photo(p.id).state);assertTrue(new File(p.originalPath).exists());
    }
    @Test public void storageFailureAndCancellationKeepEverySourceAndNeverConfirmExport()throws Exception{
        ProtectedPhoto p=photo("a","org","WAITING");
        assertThrows(IOException.class,()->export(p,new OutputStream(){public void write(int b)throws IOException{throw new IOException("Quota");}}));
        assertThrows(InterruptedIOException.class,()->export(p,new OutputStream(){public void write(int b)throws IOException{throw new InterruptedIOException();}}));
        assertEquals("WAITING",dao.photo(p.id).state);assertEquals("frozen-finish",dao.photo(p.id).finishSetId);
        assertArrayEquals(new byte[]{1,2,3,4,5},Files.readAllBytes(new File(p.originalPath).toPath()));
    }
    @Test public void selectionIsValidatedBeforeAnyPhotoIsWritten()throws Exception{
        ProtectedPhoto p=photo("a","org","WAITING"),missing=photo("a","org","PROBLEM");assertTrue(new File(missing.originalPath).delete());
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        assertThrows(IOException.class,()->owner.exportOriginals(actor,gen,List.of(p.id,missing.id),out));assertEquals(0,out.size());
        assertThrows(IOException.class,()->owner.exportOriginals(actor,gen,List.of(p.id,p.id),out));
        assertThrows(IOException.class,()->owner.exportOriginals(actor,gen,Collections.nCopies(51,p.id),out));
        assertThrows(IOException.class,()->owner.exportOriginals(actor,gen,List.of(),out));
    }
    @Test public void canonicalPathEscapeAndSymlinkCannotExposeOtherAppPrivateFiles()throws Exception{
        ProtectedPhoto p=photo("a","org","WAITING");File foreign=File.createTempFile("foreign",".jpg",context.getCacheDir());Files.write(foreign.toPath(),new byte[]{9});
        try{
            ProtectedPhoto changed=dao.photo(p.id);changed.originalPath=foreign.getPath();
            assertThrows(IOException.class,()->PhotoRecoveryArchive.write(root,"a","org",List.of(changed),new ByteArrayOutputStream(),work->work.run()));
            assertTrue(new File(p.originalPath).delete());Files.createSymbolicLink(new File(p.originalPath).toPath(),foreign.toPath());
            assertThrows(IOException.class,()->export(p,new ByteArrayOutputStream()));
        }finally{foreign.delete();}
    }
    @Test public void unfinishedCaptureAndExplicitDiscardCannotBeExported()throws Exception{
        for(String state:List.of("CAPTURING","DISCARDING","DISCARDED")){
            ProtectedPhoto p=photo("a","org",state);assertThrows(IOException.class,()->export(p,new ByteArrayOutputStream()));
        }
    }
    @Test public void ownerScopedPagesIncludeHeldEvidenceWithoutNeedingCurrentAssignment()throws Exception{
        photo("b","org","WAITING");photo("a","other","WAITING");photo("a","org","CAPTURING");
        ProtectedPhoto held=photo("a","org","PROBLEM");
        List<ProtectedPhoto> page=dao.recoveryPhotos("a","org",26,0);assertEquals(1,page.size());assertEquals(held.id,page.get(0).id);
        assertTrue(dao.recoveryPhotos("a","org",26,1).isEmpty());
    }
}
