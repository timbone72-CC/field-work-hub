package com.inandout.fieldphotoprep.team.internal;

final class CameraLensMath {
    private CameraLensMath() { }

    static boolean isUsableRatio(float ratio) {
        return !Float.isNaN(ratio) && !Float.isInfinite(ratio) && ratio > 0f;
    }

    static boolean isUltraWide(float ratio) {
        return isUsableRatio(ratio) && ratio < 0.95f;
    }

    static float effectiveRatio(float intrinsicRatio, float cameraZoomRatio) {
        float intrinsic = isUsableRatio(intrinsicRatio) ? intrinsicRatio : 1f;
        float zoom = isUsableRatio(cameraZoomRatio) ? cameraZoomRatio : 1f;
        return intrinsic * zoom;
    }
}
