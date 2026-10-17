package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;
import org.junit.Test;

public final class UpdateCheckCadenceTest {
    @Test public void repeatsForegroundChecksOnlyAfterFifteenMinutes() {
        long now = 1_000_000L;
        long interval = UpdateCheckCadence.AUTO_INTERVAL_MS;
        assertEquals(15L * 60L * 1000L, interval);
        assertTrue(UpdateCheckCadence.shouldCheck(false, now, 0));
        assertFalse(UpdateCheckCadence.shouldCheck(false, now, now));
        assertFalse(UpdateCheckCadence.shouldCheck(false, now, now - interval + 1));
        assertTrue(UpdateCheckCadence.shouldCheck(false, now, now - interval));
        assertTrue(UpdateCheckCadence.shouldCheck(true, now, now));
    }

    @Test public void clockRollbackPermitsRecoveryWithoutInfiniteSuppression() {
        assertTrue(UpdateCheckCadence.shouldCheck(false, 1_000_000L, 1_001_000L));
    }
}
