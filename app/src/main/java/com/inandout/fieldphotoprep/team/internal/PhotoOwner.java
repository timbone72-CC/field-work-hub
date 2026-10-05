package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;
import android.graphics.*;
import android.media.ExifInterface;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** One application-scoped capture/file/preparation owner. No original upload or automatic cleanup. */
final class PhotoOwner {
    final ExecutorService io=Executors.newSingleThreadExecutor();
    private final File directory;
    private final CachedWorkOrderDao dao;
    private final SessionCoordinator sessions;
    private boolean recovered;
    PhotoOwner(Context context,CachedWorkOrderDao dao,SessionCoordinator sessions) {
        directory=new File(context.getFilesDir(),"protected-photos"); this.dao=dao; this.sessions=sessions;
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
}
