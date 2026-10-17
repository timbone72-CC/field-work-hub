package com.inandout.fieldphotoprep.team.internal;

import android.app.Activity;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** Presentation-only system navigation policy; never intercepts Back, gestures or field actions. */
final class FwhImmersiveNavigation {
    private FwhImmersiveNavigation() {}

    static void enter(Activity activity) {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(
                activity.getWindow(), activity.getWindow().getDecorView());
        bars.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.navigationBars());
        // Never hide the status bar, override Android's gestures or own external dialogs.
    }

    static void protect(Activity activity, View root,
                        int left, int top, int right, int bottom) {
        final int minimum = FwhVisualStyle.dp(activity, 12);
        final int visibleLift = FwhVisualStyle.dp(activity, 6);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets status = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets gesture = insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures());
            Insets stableNav = insets.getInsetsIgnoringVisibility(
                    WindowInsetsCompat.Type.navigationBars());
            Insets visibleNav = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
            boolean navShown = insets.isVisible(WindowInsetsCompat.Type.navigationBars());
            // Transient system bars often overlay content without dispatching new insets.
            // Preserve stable clearance even while hidden; shift if visibility is reported.
            int safeBottom = safeBottom(minimum, stableNav.bottom, gesture.bottom,
                    visibleNav.bottom, navShown, visibleLift);
            int topInset = Math.max(status.top, cutout.top);
            int leftInset = Math.max(cutout.left, gesture.left);
            int rightInset = Math.max(cutout.right, gesture.right);
            int newLeft = left + leftInset;
            int newTop = top + topInset;
            int newRight = right + rightInset;
            int newBottom = bottom + safeBottom;
            if (view.getPaddingLeft() != newLeft || view.getPaddingTop() != newTop
                    || view.getPaddingRight() != newRight
                    || view.getPaddingBottom() != newBottom) {
                view.setPadding(newLeft, newTop, newRight, newBottom);
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(root);
    }

    /** Pixels in, pixels out. Not cumulative; stable inset is an overlay-safe fallback. */
    static int safeBottom(int minimum, int stableNavigation, int mandatoryGesture,
                          int visibleNavigation, boolean navigationShown, int visibleLift) {
        int protectedInset = Math.max(minimum,
                Math.max(stableNavigation, mandatoryGesture));
        return navigationShown
                ? Math.max(protectedInset, visibleNavigation) + visibleLift
                : protectedInset;
    }
}
