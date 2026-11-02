package com.inandout.fieldphotoprep.team.internal;

/** Presentation-only update discovery cadence; never installs or downloads an APK. */
final class UpdateCheckCadence {
    static final long AUTO_INTERVAL_MS = 15L * 60L * 1000L;

    private UpdateCheckCadence() {}

    static boolean shouldCheck(boolean manual, long now, long lastAttempt) {
        return manual || lastAttempt <= 0 || now < lastAttempt
                || now - lastAttempt >= AUTO_INTERVAL_MS;
    }
}
