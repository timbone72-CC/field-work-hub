package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.StatFs;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/** Separate from Room, PhotoOwner, WorkManager and Auth; no local work data is ever modified. */
final class InternalAppUpdater {
    private static final int CONNECT_TIMEOUT_MS = 12_000;
    private static final int READ_TIMEOUT_MS = 25_000;
    private static final int MAX_JSON_BYTES = 256 * 1024;
    private final Context context;

    InternalAppUpdater(Context context) {
        this.context = context.getApplicationContext();
    }

    UpdateReleasePolicy.Candidate check() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(UpdateReleasePolicy.API).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "Field-Work-Hub-Internal-Update-Check");
        try {
            int status = connection.getResponseCode();
            if (status == 404) {
                throw new IOException("No internal APK release has been published yet.");
            }
            if (status != 200) throw new IOException("Could not check updates (HTTP " + status + ").");
            byte[] result = boundedRead(connection.getInputStream(), MAX_JSON_BYTES);
            return UpdateReleasePolicy.fromLatestRelease(
                    new String(result, java.nio.charset.StandardCharsets.UTF_8), BuildConfig.VERSION_CODE);
        } finally {
            connection.disconnect();
        }
    }

    File downloadAndVerify(UpdateReleasePolicy.Candidate candidate) throws Exception {
        verifyInstalledSigner();
        File directory = new File(context.getCacheDir(), "updates");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not prepare the app update cache.");
        }
        long available = new StatFs(directory.getAbsolutePath()).getAvailableBytes();
        if (available < candidate.length + (8L * 1024 * 1024)) {
            throw new IOException("Not enough free space to download the update.");
        }
        File part = new File(directory, "internal.apk.part");
        File apk = new File(directory, UpdateReleasePolicy.ASSET);
        if (part.exists() && !part.delete()) throw new IOException("Could not clear an incomplete update.");
        if (apk.exists() && !apk.delete()) throw new IOException("Could not clear the previous update.");

        try {
            HttpURLConnection connection = followApprovedDownload(candidate);
            try {
                long responseLength = connection.getContentLengthLong();
                if (responseLength > 0 && responseLength != candidate.length) {
                    throw new IOException("Downloaded APK length disagrees with the release.");
                }
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long count = 0;
                try (InputStream input = connection.getInputStream();
                     FileOutputStream output = new FileOutputStream(part)) {
                    byte[] buffer = new byte[32 * 1024];
                    for (int n; (n = input.read(buffer)) != -1; ) {
                        count += n;
                        if (count > candidate.length || count > UpdateReleasePolicy.MAX_BYTES) {
                            throw new IOException("APK exceeds the verified release size.");
                        }
                        digest.update(buffer, 0, n);
                        output.write(buffer, 0, n);
                    }
                    output.getFD().sync();
                }
                if (count != candidate.length || !candidate.sha256.equals(hex(digest.digest()))) {
                    throw new IOException("Downloaded APK does not match the release SHA-256.");
                }
            } finally {
                connection.disconnect();
            }
            if (!part.renameTo(apk)) throw new IOException("Could not finalize the verified APK.");
            verifyArchive(apk, candidate.versionCode);
            return apk;
        } catch (Exception failure) {
            part.delete();
            apk.delete();
            throw failure;
        }
    }

    void verifyArchive(File apk, int expectedVersion) throws Exception {
        if (!apk.isFile() || apk.length() < 100_000) {
            throw new IOException("APK cannot be read.");
        }
        PackageInfo info = context.getPackageManager().getPackageArchiveInfo(
                apk.getAbsolutePath(), signingFlags());
        if (info == null || !UpdateReleasePolicy.PACKAGE.equals(info.packageName)
                || version(info) != expectedVersion || expectedVersion <= BuildConfig.VERSION_CODE
                || !UpdateReleasePolicy.CERT_SHA256.equals(signerDigest(info))) {
            throw new IOException("Update APK package, signing certificate or version does not match.");
        }
    }

    private void verifyInstalledSigner() throws Exception {
        PackageInfo installed = context.getPackageManager().getPackageInfo(
                context.getPackageName(), signingFlags());
        if (!UpdateReleasePolicy.PACKAGE.equals(installed.packageName)
                || !UpdateReleasePolicy.CERT_SHA256.equals(signerDigest(installed))) {
            throw new IOException("Installed app identity does not match the internal update channel.");
        }
    }

    private static int signingFlags() {
        return Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private static long version(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static String signerDigest(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            if (info.signingInfo == null || info.signingInfo.hasMultipleSigners()) return "";
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length != 1) return "";
        return hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }

    private static String hex(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }

    private static byte[] boundedRead(InputStream stream, int max) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            for (int n; (n = input.read(buffer)) != -1; ) {
                if (bytes.size() + n > max) throw new IOException("Update response exceeds the limit.");
                bytes.write(buffer, 0, n);
            }
            return bytes.toByteArray();
        }
    }

    private static HttpURLConnection followApprovedDownload(UpdateReleasePolicy.Candidate candidate)
            throws Exception {
        String next = candidate.url;
        for (int redirect = 0; redirect <= 5; redirect++) {
            if (!UpdateReleasePolicy.permittedDownloadUrl(next, candidate, redirect > 0)) {
                throw new IOException("APK download redirected to an untrusted origin.");
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(next).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("User-Agent", "Field-Work-Hub-Internal-Download");
            int status;
            try {
                status = connection.getResponseCode();
            } catch (Exception error) {
                connection.disconnect();
                throw error;
            }
            if (status == 200) return connection;
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("APK redirect has no destination.");
                next = new URL(new URL(next), location).toString();
                continue;
            }
            connection.disconnect();
            throw new IOException("Could not download the verified update (HTTP " + status + ").");
        }
        throw new IOException("APK download redirected too many times.");
    }
}
