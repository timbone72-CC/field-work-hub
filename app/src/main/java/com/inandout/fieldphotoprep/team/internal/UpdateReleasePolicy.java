package com.inandout.fieldphotoprep.team.internal;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Narrow, read-only public release policy. Never authorizes an install by itself. */
final class UpdateReleasePolicy {
    static final String PACKAGE = "com.inandout.fieldphotoprep.team.internal";
    static final String CERT_SHA256 = "1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe";
    static final String API = "https://api.github.com/repos/timbone72-CC/field-work-hub/releases/latest";
    static final String ASSET = "Field-Work-Hub-Internal.apk";
    static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final Pattern TAG = Pattern.compile("fwh-internal-v([1-9][0-9]{0,7})");
    private static final Pattern HASH = Pattern.compile("sha256:([0-9a-fA-F]{64})");

    static final class Candidate {
        final int versionCode;
        final long length;
        final String sha256;
        final String url;
        Candidate(int versionCode, long length, String sha256, String url) {
            this.versionCode = versionCode; this.length = length;
            this.sha256 = sha256; this.url = url;
        }
    }

    static Candidate fromLatestRelease(String json, int installedVersion) throws Exception {
        JSONObject release = new JSONObject(json);
        if (release.optBoolean("draft", true) || release.optBoolean("prerelease", true)) {
            throw new IllegalArgumentException("An unpublished or preview build cannot update this app.");
        }
        String tag = release.optString("tag_name", "");
        Matcher match = TAG.matcher(tag);
        if (!match.matches()) {
            throw new IllegalArgumentException("Latest public release is not an internal app update.");
        }
        int version = Integer.parseInt(match.group(1));
        if (version <= installedVersion) return null;
        if (version < 22) throw new IllegalArgumentException("An older recovery or test build cannot be an update.");
        JSONArray assets = release.getJSONArray("assets");
        if (assets.length() != 1) {
            // The release must only contain one installable candidate. A recovery artifact is never a public update.
            throw new IllegalArgumentException("Release asset inventory is not a single verified APK.");
        }
        JSONObject asset = assets.getJSONObject(0);
        if (!ASSET.equals(asset.optString("name", "")) || !"uploaded".equals(asset.optString("state", ""))) {
            throw new IllegalArgumentException("The release has no approved internal APK.");
        }
        long size = asset.optLong("size", 0);
        if (size < 100_000 || size > MAX_BYTES) {
            throw new IllegalArgumentException("APK size is invalid.");
        }
        Matcher digest = HASH.matcher(asset.optString("digest", ""));
        if (!digest.matches()) {
            throw new IllegalArgumentException("The release has no valid SHA-256.");
        }
        String url = asset.getString("browser_download_url");
        String exact = "https://github.com/timbone72-CC/field-work-hub/releases/download/" + tag + "/" + ASSET;
        if (!exact.equals(url)) {
            throw new IllegalArgumentException("Release download is not from the approved source.");
        }
        return new Candidate(version, size, digest.group(1).toLowerCase(Locale.ROOT), url);
    }

    static boolean permittedDownloadUrl(String value, Candidate candidate, boolean redirect) {
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null
                    || uri.getPort() != -1 || uri.getFragment() != null) return false;
            String host = uri.getHost();
            if ("github.com".equals(host)) return candidate.url.equals(value);
            return redirect && ("release-assets.githubusercontent.com".equals(host)
                    || "objects.githubusercontent.com".equals(host));
        } catch (Exception ignored) {
            return false;
        }
    }

    private UpdateReleasePolicy() {}
}
