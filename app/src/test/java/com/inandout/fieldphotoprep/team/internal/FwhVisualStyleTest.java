package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.graphics.drawable.RippleDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class FwhVisualStyleTest {
    @Test public void presentationNeverReplacesActionOrEnablesProtectedButton() {
        Button action = new Button(RuntimeEnvironment.getApplication());
        AtomicInteger calls = new AtomicInteger();
        action.setOnClickListener(v -> calls.incrementAndGet());
        FwhVisualStyle.button(action, true);
        assertTrue(action.getBackground() instanceof RippleDrawable);
        action.performClick();
        assertEquals(1, calls.get());
        action.setEnabled(false);
        FwhVisualStyle.button(action, false);
        assertFalse(action.isEnabled());
        // Programmatic performClick can dispatch despite disabled on some Android versions;
        // test the actual enabled flag, then prove the original handler still exists.
        action.setEnabled(true);
        action.performClick();
        assertEquals(2, calls.get());
    }

    @Test public void sharedPanelAndInputArePresentationOnly() {
        EditText search = new EditText(RuntimeEnvironment.getApplication());
        search.setText("WO 100");
        FwhVisualStyle.input(search);
        assertEquals("WO 100", search.getText().toString());
        assertTrue(search.isSingleLine());

        LinearLayout card = new LinearLayout(RuntimeEnvironment.getApplication());
        View child = new View(RuntimeEnvironment.getApplication());
        card.addView(child);
        FwhVisualStyle.panel(card);
        assertSame(child, card.getChildAt(0));
        assertNotNull(card.getBackground());
    }
}
