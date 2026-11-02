package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Safe-area calculations must not react to a transient navigation reveal. */
public class FwhImmersiveNavigationTest {
    @Test public void keepsClearanceForHiddenOrOverlaidNavigation() {
        assertEquals(48, FwhImmersiveNavigation.safeBottom(12, 48, 16));
        assertEquals(24, FwhImmersiveNavigation.safeBottom(12, 0, 24));
    }

    @Test public void retainsMinimumPaddingWithoutSystemInsets() {
        assertEquals(16, FwhImmersiveNavigation.safeBottom(16, 0, 0));
        assertEquals(12, FwhImmersiveNavigation.safeBottom(12, 0, 0));
    }

    @Test public void alwaysUsesLargestStableProtectionWithoutExtraLift() {
        assertEquals(48, FwhImmersiveNavigation.safeBottom(12, 48, 16));
        assertEquals(56, FwhImmersiveNavigation.safeBottom(12, 56, 16));
        assertEquals(32, FwhImmersiveNavigation.safeBottom(12, 0, 32));
    }
}
