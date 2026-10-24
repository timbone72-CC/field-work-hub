package com.inandout.fieldphotoprep.team.internal;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** Read-only copies. A final manifest exists only when every selected original was copied. */
final class PhotoRecoveryArchive {
    static final int MAX_PHOTOS = 50;
    interface Guard { void run(CheckedWork work) throws Exception; }
    interface CheckedWork { void run() throws Exception; }

    static void write(File directory, String owner, String org, List<ProtectedPhoto> photos,
            OutputStream destination, Guard guard) throws Exception {
        if (photos.isEmpty() || photos.size() > MAX_PHOTOS)
            throw new IOException("Select 1 to 50 protected originals.");
        File root = directory.getCanonicalFile();
        Set<String> seen = new HashSet<>();
        List<File> files = new ArrayList<>();
        // Validate the entire selection before writing any photograph.
        for (ProtectedPhoto p : photos) {
            if (!owner.equals(p.ownerId) || !org.equals(p.organizationId)
                    || !("WAITING".equals(p.state) || "PROBLEM".equals(p.state))
                    || !UUID.fromString(p.id).toString().equals(p.id) || !seen.add(p.id))
                throw new IOException("Selected evidence is unavailable for this account.");
            File file = new File(p.originalPath);
            File expected = new File(root, p.id + "-original.jpg");
            if (!file.getCanonicalFile().equals(expected) || !file.isFile()
                    || !file.canRead() || file.length() == 0)
                throw new IOException("A selected original is missing. Other originals remain protected.");
            files.add(file);
        }
        // Do not close/finalize a partial ZIP after an error. The caller owns the destination.
        RecoveryZip zip = new RecoveryZip(destination);
        try {
        zip.setLevel(Deflater.NO_COMPRESSION);
        JSONArray manifest = new JSONArray();
        byte[] buffer = new byte[64 * 1024];
        for (int i = 0; i < photos.size(); i++) {
            ProtectedPhoto p = photos.get(i); File file = files.get(i);
            long expectedSize = file.length(); long copied = 0;
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            String name = "originals/" + p.id + ".jpg";
            guard.run(() -> zip.putNextEntry(new ZipEntry(name)));
            try (FileInputStream input = new FileInputStream(file)) {
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                    copied += count;
                    if (copied > expectedSize) throw new IOException("Original changed; export is incomplete.");
                    final int length = count;
                    guard.run(() -> zip.write(buffer, 0, length));
                    sha.update(buffer, 0, count);
                }
            }
            if (copied != expectedSize || file.length() != expectedSize)
                throw new IOException("Original changed; export is incomplete.");
            guard.run(zip::closeEntry);
            StringBuilder hash = new StringBuilder();
            for (byte b : sha.digest()) hash.append(String.format(Locale.ROOT, "%02x", b & 255));
            manifest.put(new JSONObject().put("photo_id", p.id).put("work_order_id", p.workOrderId)
                    .put("run_id", p.runId).put("captured_at", p.capturedAt)
                    .put("capture_state", p.state).put("finish_set_id", p.finishSetId)
                    .put("file", name).put("size", copied).put("sha256", hash.toString()));
        }
        byte[] metadata = new JSONObject().put("format", "fwh-original-recovery-v1")
                .put("purpose", "Evidence copy; no server acceptance or client delivery")
                .put("photos", manifest).toString(2).getBytes(StandardCharsets.UTF_8);
        guard.run(() -> {
            zip.putNextEntry(new ZipEntry("recovery.json")); zip.write(metadata); zip.closeEntry();
            zip.finish(); zip.flush();
        });
        } finally { zip.release(); }
    }
    private static final class RecoveryZip extends ZipOutputStream {
        RecoveryZip(OutputStream out) { super(out); }
        void release() { def.end(); }
    }
}
