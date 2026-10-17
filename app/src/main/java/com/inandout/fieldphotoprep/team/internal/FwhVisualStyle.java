package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/**
 * Field Work Hub visual tokens. Display-only; no field/CameraX/Room/network authority.
 * Buttons retain their caller's OnClickListener and enabled-state ownership.
 */
final class FwhVisualStyle {
    static final int NAVY = Color.rgb(26, 43, 65);
    static final int TEAL = Color.rgb(23, 105, 116);
    static final int SKY = Color.rgb(229, 240, 242);
    static final int CANVAS = Color.rgb(245, 248, 250);
    static final int SURFACE = Color.WHITE;
    static final int INK = Color.rgb(28, 46, 66);
    static final int SUBTLE = Color.rgb(89, 108, 123);
    static final int BORDER = Color.rgb(216, 226, 233);
    static final int WARN = Color.rgb(137, 77, 44);

    private FwhVisualStyle() {}

    static int dp(Context context, float size) {
        return Math.round(size * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable background(Context context, int fill, int radius, int stroke) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(context, radius));
        if (stroke != Color.TRANSPARENT) shape.setStroke(dp(context, 1), stroke);
        return shape;
    }

    static void panel(View view) {
        view.setBackground(background(view.getContext(), SURFACE, 16, BORDER));
        view.setElevation(dp(view.getContext(), 1.5f));
    }

    static void button(Button button, boolean primary) {
        Context context = button.getContext();
        int fill = primary ? TEAL : SURFACE;
        int text = primary ? Color.WHITE : INK;
        int border = primary ? Color.TRANSPARENT : BORDER;
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(text);
        button.setMinHeight(dp(context, 52));
        button.setMinimumHeight(dp(context, 52));
        button.setPadding(dp(context, 14), dp(context, 10), dp(context, 14), dp(context, 10));
        // A real RippleDrawable retains Android's press feedback; it never changes enable/click logic.
        button.setBackground(new RippleDrawable(
                ColorStateList.valueOf(primary ? Color.argb(55, 255, 255, 255)
                        : Color.argb(32, 23, 105, 116)),
                background(context, fill, 12, border), null));
    }

    static void input(EditText input) {
        Context context = input.getContext();
        input.setTextColor(INK);
        input.setHintTextColor(SUBTLE);
        input.setTextSize(16);
        input.setSingleLine(true);
        input.setMinHeight(dp(context, 52));
        input.setPadding(dp(context, 14), dp(context, 8),
                dp(context, 14), dp(context, 8));
        input.setBackground(background(context, SURFACE, 12, BORDER));
    }

    static void heading(TextView text) {
        text.setTextColor(INK);
        text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    }

    static void body(TextView text) { text.setTextColor(SUBTLE); }
}
