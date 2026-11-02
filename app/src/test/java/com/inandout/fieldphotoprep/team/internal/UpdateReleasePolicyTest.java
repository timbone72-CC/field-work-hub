package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class UpdateReleasePolicyTest {
    private static final String DIGEST = "a".repeat(64);
    private static JSONObject release(int version) throws Exception {
        String tag = "fwh-internal-v" + version;
        JSONObject asset = new JSONObject();
        asset.put("name", UpdateReleasePolicy.ASSET);
        asset.put("state", "uploaded");
        asset.put("size", 8_000_000);
        asset.put("digest", "sha256:" + DIGEST);
        asset.put("browser_download_url", "https://github.com/timbone72-CC/field-work-hub/"
                + "releases/download/" + tag + "/" + UpdateReleasePolicy.ASSET);
        JSONObject result = new JSONObject();
        result.put("tag_name", tag);
        result.put("draft", false);
        result.put("prerelease", false);
        result.put("assets", new JSONArray().put(asset));
        return result;
    }

    private static void denied(JSONObject manifest, int installed) throws Exception {
        try {
            UpdateReleasePolicy.fromLatestRelease(manifest.toString(), installed);
            fail("Untrusted update was accepted");
        } catch (IllegalArgumentException | org.json.JSONException expected) {
            // The exact failure text must not become a permissive fallback.
        }
    }

    @Test public void acceptsOnlyNewerFullInternalVersion() throws Exception {
        UpdateReleasePolicy.Candidate candidate =
                UpdateReleasePolicy.fromLatestRelease(release(22).toString(), 20);
        assertNotNull(candidate);
        assertEquals(22, candidate.versionCode);
        assertEquals(8_000_000, candidate.length);
        assertEquals(DIGEST, candidate.sha256);
        assertTrue(UpdateReleasePolicy.permittedDownloadUrl(candidate.url, candidate, false));
        assertNull(UpdateReleasePolicy.fromLatestRelease(release(22).toString(), 22));
        assertNull(UpdateReleasePolicy.fromLatestRelease(release(22).toString(), 23));
        denied(release(21), 20); // Current protected recovery v21 must never become the updater.
    }

    @Test public void rejectsDraftPreviewAndWrongChannel() throws Exception {
        JSONObject j = release(24); j.put("draft", true); denied(j, 22);
        j = release(24); j.put("prerelease", true); denied(j, 22);
        j = release(24); j.put("tag_name", "production-v24"); denied(j, 22);
        j = release(24); j.put("tag_name", "fwh-internal-v999999999"); denied(j, 22);
    }

    @Test public void rejectsUnexpectedAssetIdentityAndDigest() throws Exception {
        JSONObject j = release(24);
        j.getJSONArray("assets").getJSONObject(0).put("digest", JSONObject.NULL);
        denied(j, 22);
        j = release(24); j.getJSONArray("assets").getJSONObject(0).put("size", 0); denied(j, 22);
        j = release(24); j.getJSONArray("assets").getJSONObject(0).put("size", 70_000_000); denied(j, 22);
        j = release(24); j.getJSONArray("assets").getJSONObject(0).put("name", "recovery.apk"); denied(j, 22);
        j = release(24); j.getJSONArray("assets").getJSONObject(0)
                .put("browser_download_url", "https://evil.example/installer.apk"); denied(j, 22);
        j = release(24); j.getJSONArray("assets").put(new JSONObject()); denied(j, 22);
    }

    @Test public void rejectsRedirectsToUntrustedEndpoints() throws Exception {
        UpdateReleasePolicy.Candidate c =
                UpdateReleasePolicy.fromLatestRelease(release(24).toString(), 22);
        assertFalse(UpdateReleasePolicy.permittedDownloadUrl(
                "http://github.com/timbone72-CC/field-work-hub/releases/download/fwh-internal-v24/"
                        + UpdateReleasePolicy.ASSET, c, false));
        assertFalse(UpdateReleasePolicy.permittedDownloadUrl(
                "https://github.com@evil.example/f.apk", c, true));
        assertFalse(UpdateReleasePolicy.permittedDownloadUrl(
                "https://evil.githubusercontent.com/file", c, true));
        assertFalse(UpdateReleasePolicy.permittedDownloadUrl(
                "https://release-assets.githubusercontent.com/file", c, false));
        assertTrue(UpdateReleasePolicy.permittedDownloadUrl(
                "https://release-assets.githubusercontent.com/path?id=1", c, true));
        assertTrue(UpdateReleasePolicy.permittedDownloadUrl(
                "https://objects.githubusercontent.com/github-production-release-asset/file", c, true));
    }
}
