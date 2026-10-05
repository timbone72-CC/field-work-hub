package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.app.AlertDialog;
import android.app.Application;
import android.content.Intent;
import android.os.Looper;
import android.widget.TextView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, application = Application.class)
public class FinishFeedbackTest {
    @Test public void blockedFinishIsVisibleAndOpensPhotosForTheExactRun() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).get();
        SupabaseApi.WorkOrder work = OfflineActionTest.wo("test-wo", "assignment");
        String message = "More photos needed:\nTotal photos: 6/8 — 2 more photos needed.";
        activity.showFinishBlockedDialog(work, message);

        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        assertTrue(dialog.isShowing());
        assertEquals("Can't finish field work", Shadows.shadowOf(dialog).getTitle());
        TextView visibleMessage = dialog.findViewById(android.R.id.message);
        assertEquals(work.woNumber + "\n\n" + message, visibleMessage.getText().toString());
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        Intent intent = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(PhotoActivity.class.getName(), intent.getComponent().getClassName());
        assertEquals(work.id, intent.getStringExtra("wo"));
        assertEquals(work.currentRunId, intent.getStringExtra("run"));
    }

    @Test public void acknowledgingTheExplanationDoesNotStartAnotherScreen() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).get();
        activity.showFinishBlockedDialog(OfflineActionTest.wo("test-wo", "assignment"),
                "A photo is still saving or needs recovery. Finish is paused.");
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertFalse(dialog.isShowing());
        assertNull(Shadows.shadowOf(activity).getNextStartedActivity());
    }
}
