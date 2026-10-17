package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Pure safe-area calculations: transient bars may overlay without fresh insets. */
public class FwhImmersiveNavigationTest {
    @Test public void retainsStableNavigationClearanceWhenNavigationIsHidden() {
        assertEquals(48, FwhImmersiveNavigation.safeBottom(12, 48, 16,
                0, false, 6));
        assertEquals(24, FwhImmersiveNavigation.safeBottom(12, 0, 24,
                0, false, 6));
    }

    @Test public void movesBottomGroupWhenNavigationVisibilityIsActuallyReported() {
        assertEquals(54, FwhImmersiveNavigation.safeBottom(12, 48, 16,
                48, true, 6));
        assertEquals(62, FwhImmersiveNavigation.safeBottom(12, 48, 16,
                56, true, 6));
        assertEquals(48, FwhImmersiveNavigation.safeBottom(12, 48, 16,
                0, false, 6));
    }

    @Test public void neverSubtractsSafetyWhenNavigationSignalsAreSmallOrMissing() {
        assertEquals(16, FwhImmersiveNavigation.safeBottom(16, 0, 0,
                0, false, 6));
        assertEquals(54, FwhImmersiveNavigation.safeBottom(12, 48, 16,
                0, true, 6));
    }
}
