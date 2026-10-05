package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class CameraLensMathTest {
    @Test public void classifiesOnlyUsableSubOneXRatiosAsUltraWide() {
        assertTrue(CameraLensMath.isUltraWide(0.5f));
        assertTrue(CameraLensMath.isUltraWide(0.94f));
        assertFalse(CameraLensMath.isUltraWide(0.95f));
        assertFalse(CameraLensMath.isUltraWide(1f));
        assertFalse(CameraLensMath.isUltraWide(Float.NaN));
        assertFalse(CameraLensMath.isUltraWide(Float.POSITIVE_INFINITY));
    }

    @Test public void computesEffectiveRatioFromPhysicalLensAndZoom() {
        assertEquals(1f, CameraLensMath.effectiveRatio(0.5f, 2f), 0.0001f);
        assertEquals(2f, CameraLensMath.effectiveRatio(0f, 2f), 0.0001f);
    }
}
