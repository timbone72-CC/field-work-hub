package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;
import android.graphics.*;
import android.media.ExifInterface;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** One application-scoped original/file owner; cleanup is independently release-gated OFF. */
final class PhotoOwner {
    final ExecutorService io=Executors.newSingleThreadExecutor();
    private final File directory;
    private final CachedWorkOrderDao dao;
    private final SessionCoordinator sessions;
    private final PhotoCleanupDao cleanupDao;
    private final boolean cleanupEnabled;
    private boolean recovered;

    PhotoOwner(Context context,CachedWorkOrderDao dao,SessionCoordinator sessions) {
        this(context,dao,null,sessions,false);
    }

    PhotoOwner(Context context,CachedWorkOrderDao dao,PhotoCleanupDao cleanupDao,
               SessionCoordinator sessions) {
        this(context,dao,cleanupDao,sessions,BuildConfig.AUTOMATIC_CLEANUP_ENABLED);
    }

    // Test seam. Production always uses the BuildConfig switch above.
    PhotoOwner(Context context,CachedWorkOrderDao dao,PhotoCleanupDao cleanupDao,
               SessionCoordinator sessions,boolean cleanupEnabled) {
        directory=new File(context.getFilesDir(),"protected-photos");
        this.dao=dao; this.cleanupDao=cleanupDao; this.sessions=sessions;
        this.cleanupEnabled=cleanupEnabled;
    }
    ProtectedPhoto reserve(SupabaseApi.AuthSession session,long generation,String wo,String run,String item) throws Exception {
        if(!BuildConfig.FIELD_SYNC_ENABLED) throw new IllegalStateException("Recovery mode preserves photos; capture is paused.");
        recover();
        if(!directory.isDirectory()&&!directory.mkdirs()) throw new IOException("Cannot create protected photo storage.");
        String id=UUID.randomUUID().toString();
        return sessions.local(generation,session,()->dao.reservePhoto(session,wo,run,item,java.time.Instant.now().toString(),id,
                new File(directory,id+"-original.jpg").getAbsolutePath(),new File(directory,id+"-prepared.jpg").getAbsolutePath()));
    }
    void captured(String id) {
        ProtectedPhoto p=dao.photo(id); if(p==null||!"CAPTURING".equals(p.state)) return;
        File f=new File(p.originalPath); long bytes=f.isFile()?f.length():0; boolean valid=validImage(f);
        if(valid) {
            try(FileOutputStream durable=new FileOutputStream(f,true)) { durable.getFD().sync(); }
            catch(IOException e) { dao.finalizePhoto(id,false,bytes,"Original could not be made durable. Preserved for review."); return; }
        }
        dao.finalizePhoto(id,valid,bytes,valid?"":(bytes>0?"Original is unreadable. Preserved for review.":"Capture did not produce a photo."));
        if(valid) prepare(dao.photo(id));
        else if(bytes==0 && f.exists()) f.delete();
    }
    synchronized void recover() {
        if(!BuildConfig.FIELD_SYNC_ENABLED || recovered) return;
        recovered=true;
        for(ProtectedPhoto p:dao.allPhotos()) {
            if("CAPTURING".equals(p.state)) captured(p.id);
            else if("DISCARDING".equals(p.state)) finishDiscard(p);
            else if("WAITING".equals(p.state)) {
                if(!p.readable()||!validImage(new File(p.originalPath))) {
                    dao.photoProblem(p.id,"Protected original is missing or unreadable. Contact Admin.");
                } else if(!p.prepared||!validImage(new File(p.preparedPath))) prepare(p);
            }
        }
    }
    void discard(SupabaseApi.AuthSession s,long generation,String id) throws Exception {
        if(!BuildConfig.FIELD_SYNC_ENABLED) throw new IllegalStateException("Recovery mode is read only.");
        ProtectedPhoto p=sessions.local(generation,s,()->dao.beginDiscard(s,id)); finishDiscard(p);
    }
    private void finishDiscard(ProtectedPhoto p) {
        // Intent was confirmed and committed before either file is touched. Retry after a crash is safe.
        File original=new File(p.originalPath), prepared=new File(p.preparedPath), temp=new File(p.preparedPath+".tmp");
        boolean removed=(!original.exists()||original.delete())&&(!prepared.exists()||prepared.delete())&&(!temp.exists()||temp.delete());
        if(removed) dao.completeDiscard(p.id);
    }
    /**
     * Sole local original/derivative deletion owner. Invoke only on PhotoOwner.io
     * and under TeamRuntime's action/drain locks. The entire I/O attempt holds
     * the current signed-in owner's session generation so sign-out cannot
     * rebind a cleanup in progress to another account.
     *
     * HELD → READY → CLEANING are durably committed BEFORE file deletion.
     * An interrupted CLEANING resumes those exact deletions without any
     * preparation, transfer, client delivery or new server request.
     */
    boolean cleanupVerified(SupabaseApi.AuthSession session,long generation,String id)
            throws Exception {
        if(!cleanupEnabled || !BuildConfig.FIELD_SYNC_ENABLED) return false;
        if(cleanupDao==null) throw new IllegalStateException("Cleanup journal unavailable");
        return sessions.local(generation,session,()->{
            PhotoCleanupJournal j=cleanupDao.find(id);
            ProtectedPhoto p=cleanupDao.photo(id);
            if(j==null||p==null||!session.userId.equals(j.ownerId)
                ||!session.organizationId.equals(j.organizationId)
                ||!p.id.equals(j.photoId))
                throw new IOException("Exact original-owner cleanup proof unavailable");
            if("CLEANED".equals(j.state)) {
                if(!"CLEANED".equals(p.state))
                    throw new IOException("Local cleanup history needs reconciliation");
                return true;
            }
            if(!"HELD".equals(j.state)&&!"READY".equals(j.state)
                &&!"CLEANING".equals(j.state))
                throw new IOException("Unknown local cleanup state; originals held");
            verifyCleanupPaths(p,"CLEANING".equals(j.state));
            if("HELD".equals(j.state)) cleanupDao.arm(session.userId,session.organizationId,id);
            // No network call: exact immutable receipt+owner+Finish must already
            // be in Room and the whole WO must be locally settled.
            p=cleanupDao.beginOrResume(session.userId,session.organizationId,id);
            verifyCleanupPaths(p,true);
            removeExactPhotoFiles(p);
            cleanupDao.markCleaned(session.userId,session.organizationId,id);
            return true;
        });
    }

    /** Restart recovery: only the signed-in original owner and in-flight rows. */
    int resumeInterruptedCleanup(SupabaseApi.AuthSession session,long generation)
            throws Exception {
        if(!cleanupEnabled || !BuildConfig.FIELD_SYNC_ENABLED) return 0;
        if(cleanupDao==null) throw new IllegalStateException("Cleanup journal unavailable");
        List<PhotoCleanupJournal> jobs=sessions.local(generation,session,
                ()->cleanupDao.pending(session.userId,session.organizationId));
        int completed=0; Exception failure=null;
        for(PhotoCleanupJournal j:jobs) {
            try { if(cleanupVerified(session,generation,j.photoId)) completed++; }
            catch(SessionCoordinator.SessionChanged changed) { throw changed; }
            catch(Exception problem) {
                // This photo remains READY/CLEANING; unrelated safe photos
                // may still proceed. Report the error instead of false success.
                if(failure==null) failure=problem;
                else failure.addSuppressed(problem);
            }
        }
        if(failure!=null) throw failure;
        return completed;
    }

    /** Refuse symlinks, outside-root paths or changed filenames before touching bytes. */
    private void verifyCleanupPaths(ProtectedPhoto p,boolean resuming) throws IOException {
        if(p==null||!java.util.UUID.fromString(p.id).toString().equals(p.id))
            throw new IOException("Unrecognized immutable photo identity");
        java.nio.file.Path root=directory.toPath().toAbsolutePath().normalize();
        if(!Files.isDirectory(root,LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(root))
            throw new IOException("Protected photo root not available");
        java.nio.file.Path original=root.resolve(p.id+"-original.jpg");
        java.nio.file.Path prepared=root.resolve(p.id+"-prepared.jpg");
        java.nio.file.Path temporary=root.resolve(p.id+"-prepared.jpg.tmp");
        if(!new File(p.originalPath).toPath().toAbsolutePath().normalize().equals(original)
            ||!new File(p.preparedPath).toPath().toAbsolutePath().normalize().equals(prepared)
            ||original.equals(prepared)||Files.isSymbolicLink(original)
            ||Files.isSymbolicLink(prepared)||Files.isSymbolicLink(temporary))
            throw new IOException("Protected photo path identity changed");
        for(java.nio.file.Path path:new java.nio.file.Path[]{original,prepared,temporary})
            if(Files.exists(path,LinkOption.NOFOLLOW_LINKS)
               &&!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS))
                throw new IOException("Unexpected protected photo file type");
        if(!resuming) {
            PhotoTransfer t=cleanupDao.transfer(p.id);
            if(!"WAITING".equals(p.state)||!p.readable()||t==null
                ||t.preparedSize<=0||!Files.isRegularFile(prepared,LinkOption.NOFOLLOW_LINKS)
                ||Files.size(prepared)!=t.preparedSize
                ||!hashPrepared(prepared).equals(t.preparedSha256)
                ||Files.exists(temporary,LinkOption.NOFOLLOW_LINKS))
                throw new IOException("Protected original/derivative needs recovery before cleanup");
        } else {
            // An interrupted deletion is allowed to have ONE or BOTH files
            // missing, but any remaining bytes must retain their identity.
            if(Files.exists(original,LinkOption.NOFOLLOW_LINKS)
                &&Files.size(original)!=p.originalBytes)
                throw new IOException("Surviving original changed during interrupted cleanup");
            PhotoTransfer t=cleanupDao.transfer(p.id);
            if(t==null|| (Files.exists(prepared,LinkOption.NOFOLLOW_LINKS)
                &&(Files.size(prepared)!=t.preparedSize
                   ||!hashPrepared(prepared).equals(t.preparedSha256))))
                throw new IOException("Surviving prepared bytes changed during cleanup");
        }
    }

    private static String hashPrepared(java.nio.file.Path path) throws IOException {
        try {
            java.security.MessageDigest hash=java.security.MessageDigest.getInstance("SHA-256");
            try(InputStream in=Files.newInputStream(path)) {
                byte[] bytes=new byte[32768];int count;
                while((count=in.read(bytes))>=0) {
                    if(Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                    if(count>0) hash.update(bytes,0,count);
                }
            }
            StringBuilder out=new StringBuilder();
            for(byte b:hash.digest()) out.append(String.format(Locale.ROOT,"%02x",b&255));
            return out.toString();
        } catch(java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private void removeExactPhotoFiles(ProtectedPhoto p) throws IOException {
        java.nio.file.Path root=directory.toPath().toAbsolutePath().normalize();
        for(java.nio.file.Path path:new java.nio.file.Path[]{root.resolve(p.id+"-original.jpg"),
                root.resolve(p.id+"-prepared.jpg"),root.resolve(p.id+"-prepared.jpg.tmp")}) {
            if(Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
            if(Files.isSymbolicLink(path)) throw new IOException("Symlink appeared during cleanup");
            Files.deleteIfExists(path);
            if(Files.exists(path,LinkOption.NOFOLLOW_LINKS))
                throw new IOException("Protected photo removal did not complete");
        }
    }

    static String digest(String value) {
        try {
            byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder b=new StringBuilder();for(byte v:hash)b.append(String.format(java.util.Locale.ROOT,"%02x",v&255));return b.toString();
        } catch(java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    void ensureFrozenReadable(FieldAction a) throws IOException {
        if(a.finishSetId.isEmpty()) return;
        if(!digest(a.finishPhotosJson).equals(a.finishDigest)) throw new IOException("Frozen metadata fingerprint needs review.");
        try {
            org.json.JSONArray frozen=new org.json.JSONArray(a.finishPhotosJson);
            for(int n=0;n<frozen.length();n++) {
                ProtectedPhoto p=dao.photo(frozen.getJSONObject(n).getString("id"));
                if(p==null||!p.finishSetId.equals(a.finishSetId)||!p.ownerId.equals(a.ownerId)
                        ||!p.organizationId.equals(a.organizationId)||!p.workOrderId.equals(a.workOrderId)
                        ||!p.runId.equals(a.runId)||!p.assignmentInstanceId.equals(a.assignmentInstanceId)
                        ||!p.requirementRevision.equals(a.requirementRevision)||!p.readable())
                {
                    if(p!=null) dao.photoProblem(p.id,"Protected original needs recovery. Contact Admin.");
                    dao.markRunConflict(a.ownerId,a.organizationId,a.workOrderId,a.runId,"PHOTO_RECOVERY_REQUIRED");
                    throw new IOException("Frozen originals need recovery; metadata submission paused.");
                }
            }
        } catch(org.json.JSONException e) { throw new IOException("Frozen metadata needs review",e); }
    }
    private void prepare(ProtectedPhoto initial) {
        if(initial==null||!initial.readable()) return;
        if(dao.transfer(initial.id)!=null) {
            // Prepared content is immutable once journaled; never silently recompress its binding.
            dao.photoPrepared(initial.id,false,"Frozen prepared copy needs recovery; original protected.");
            return;
        }
        File temp=new File(initial.preparedPath+".tmp"); Bitmap decoded=null, oriented=null, scaled=null;
        try {
            BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
            BitmapFactory.decodeFile(initial.originalPath,bounds);
            BitmapFactory.Options options=new BitmapFactory.Options();
            int longest=Math.max(bounds.outWidth,bounds.outHeight);options.inSampleSize=1;
            while(longest/options.inSampleSize>4096) options.inSampleSize*=2;
            decoded=BitmapFactory.decodeFile(initial.originalPath,options);if(decoded==null) throw new IOException("Unreadable original");
            int orientation=new ExifInterface(initial.originalPath).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);
            Matrix matrix=new Matrix();
            switch(orientation) {
                case 2: matrix.setScale(-1,1); break;
                case 3: matrix.setRotate(180); break;
                case 4: matrix.setScale(1,-1); break;
                case 5: matrix.setRotate(90);matrix.postScale(-1,1);break;
                case 6: matrix.setRotate(90);break;
                case 7: matrix.setRotate(-90);matrix.postScale(-1,1);break;
                case 8: matrix.setRotate(-90);break;
                default: break;
            }
            oriented=Bitmap.createBitmap(decoded,0,0,decoded.getWidth(),decoded.getHeight(),matrix,true);
            float scale=Math.min(1f,2048f/Math.max(oriented.getWidth(),oriented.getHeight()));
            scaled=Bitmap.createScaledBitmap(oriented,Math.max(1,Math.round(oriented.getWidth()*scale)),Math.max(1,Math.round(oriented.getHeight()*scale)),true);
            try(FileOutputStream out=new FileOutputStream(temp)) {
                if(!scaled.compress(Bitmap.CompressFormat.JPEG,85,out)) throw new IOException("Preparation failed");out.flush();out.getFD().sync();
            }
            if(!validImage(temp)) throw new IOException("Prepared copy unreadable");
            Files.move(temp.toPath(),new File(initial.preparedPath).toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            ProtectedPhoto current=dao.photo(initial.id);
            if(current!=null) dao.photoPrepared(current.id,true,"");
        } catch(Exception e) {
            ProtectedPhoto current=dao.photo(initial.id);
            if(current!=null) dao.photoPrepared(current.id,false,"Preparation pending; original protected.");
        } finally {
            if(temp.exists()) temp.delete();
            Set<Bitmap> images=new HashSet<>(Arrays.asList(decoded,oriented,scaled));for(Bitmap b:images) if(b!=null)b.recycle();
        }
    }
    static boolean validImage(File f) {
        if(!f.isFile()||!f.canRead()||f.length()==0) return false;
        try {
            try(RandomAccessFile jpeg=new RandomAccessFile(f,"r")) {
                if(jpeg.length()<4)return false;jpeg.seek(jpeg.length()-2);if(jpeg.readUnsignedShort()!=0xffd9)return false;
            }
            BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(f.getAbsolutePath(),bounds);
            if(bounds.outWidth<=0||bounds.outHeight<=0) return false;
            BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;
            while(Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;
            Bitmap bitmap=BitmapFactory.decodeFile(f.getAbsolutePath(),options);if(bitmap==null)return false;bitmap.recycle();return true;
        } catch(Exception e) {return false;}
    }

    /** Same serial file owner as capture/cleanup. No recover, prepare or network call. */
    void exportOriginals(SupabaseApi.AuthSession session, long generation,
            List<String> selected, OutputStream destination) throws Exception {
        if(selected==null || selected.isEmpty() || selected.size()>PhotoRecoveryArchive.MAX_PHOTOS
                || new HashSet<>(selected).size()!=selected.size())
            throw new IOException("Select 1 to 50 protected originals.");
        List<ProtectedPhoto> photos=sessions.local(generation,session,()->{
            List<ProtectedPhoto> result=new ArrayList<>();
            for(String id:selected) {
                ProtectedPhoto p=dao.photo(id);
                if(p==null) throw new IOException("Selected original is unavailable.");
                result.add(p);
            }
            return result;
        });
        PhotoRecoveryArchive.write(directory,session.userId,session.organizationId,photos,destination,
                work -> sessions.local(generation,session,()->{work.run();return null;}));
    }

    static final class PreparedIdentity {
        final String sha256; final long size;
        PreparedIdentity(String sha256,long size) { this.sha256=sha256;this.size=size; }
    }

    /** Called on this owner's serial IO executor. Hash only the separately prepared JPEG. */
    PreparedIdentity preparedIdentity(ProtectedPhoto p) throws IOException {
        if(p==null||!p.readable()) throw new IOException("Original recovery is required.");
        if(!p.prepared || !validImage(new File(p.preparedPath))) {
            prepare(p); p=dao.photo(p.id);
        }
        if(p==null||!p.prepared) throw new IOException("Preparation or original recovery is required.");
        File file=new File(p.preparedPath);
        long size=file.length();
        if(size<4||size>PhotoTransferDao.MAX_PREPARED_BYTES||!validImage(file))
            throw new IOException("Prepared copy needs review; original protected.");
        try {
            java.security.MessageDigest sha=java.security.MessageDigest.getInstance("SHA-256");
            long read=0;byte[] buffer=new byte[64*1024];
            try(FileInputStream input=new FileInputStream(file)) {
                int count;
                while((count=input.read(buffer))!=-1) {
                    if(Thread.currentThread().isInterrupted())throw new java.io.InterruptedIOException();
                    read+=count;if(read>size)throw new IOException("Prepared copy changed.");sha.update(buffer,0,count);
                }
            }
            if(read!=size||file.length()!=size)throw new IOException("Prepared copy changed.");
            StringBuilder hash=new StringBuilder();
            for(byte v:sha.digest())hash.append(String.format(java.util.Locale.ROOT,"%02x",v&255));
            return new PreparedIdentity(hash.toString(),size);
        } catch(java.security.NoSuchAlgorithmException impossible) {throw new IllegalStateException(impossible);}
    }
}
