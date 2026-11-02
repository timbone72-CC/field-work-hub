package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PhotoRequirementsVisualLayoutTest {
    private static void set(Object target, String field, Object value) throws Exception {
        Field f = PhotoActivity.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    private static boolean contains(View root, String phrase) {
        if (root instanceof TextView && ((TextView) root).getText().toString().contains(phrase))
            return true;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++)
                if (contains(group.getChildAt(i), phrase)) return true;
        }
        return false;
    }

    private static Button findButton(View root, String label) {
        if (root instanceof Button && ((Button) root).getText().toString().equals(label))
            return (Button) root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                Button result = findButton(group.getChildAt(i), label);
                if (result != null) return result;
            }
        }
        return null;
    }

    @Test
    public void compactPhotoPanelKeepsIdentityWarningsAndDisabledPhotoActions() throws Exception {
        PhotoActivity activity = Robolectric.buildActivity(PhotoActivity.class).get();
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        TextView title = new TextView(activity);
        set(activity, "content", content);
        set(activity, "message", title);

        CachedWorkOrder order = new CachedWorkOrder(
                "user-a", "org-a", "wo-a", "run-a", 1, "user-a",
                "TEST-0003-DASHBOARD", "300 Test Property Rd", "Inspection",
                "", "", "2026-10-16", "{}", "IN_PROGRESS",
                "", "", "", "", "", "", 0L);
        order.conflictReason = "PROTOCOL_REVIEW";

        Method render = PhotoActivity.class.getDeclaredMethod(
                "renderItems", CachedWorkOrder.class, PhotoRequirements.class,
                List.class, List.class);
        render.setAccessible(true);
        render.invoke(activity, order, PhotoRequirements.parse("{}"),
                Collections.emptyList(), Collections.emptyList());

        assertEquals("Photos", title.getText().toString());
        assertTrue(contains(content, "WO TEST-0003-DASHBOARD"));
        assertTrue(contains(content, "Photos optional."));
        assertTrue(contains(content, "Saved photos: 0"));
        assertTrue(contains(content, "Needs review. Your photos are preserved."));
        Button extra = findButton(content, "Extra photos");
        assertNotNull(extra);
        assertFalse(extra.isEnabled());
        assertNotNull(findButton(content, "Back to work order"));
    }
}
