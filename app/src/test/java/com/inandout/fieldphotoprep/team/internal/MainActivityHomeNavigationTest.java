package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import androidx.annotation.NonNull;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class MainActivityHomeNavigationTest {
    private static Object field(Object owner, String name) throws Exception {
        Field target = owner.getClass().getDeclaredField(name);
        target.setAccessible(true);
        return target.get(owner);
    }

    private static void invoke(MainActivity owner, String name, String arg) throws Exception {
        Method method = MainActivity.class.getDeclaredMethod(name, String.class);
        method.setAccessible(true);
        method.invoke(owner, arg);
    }

    @Test
    public void contextualPagesKeepExistingWorkAndAccountRoutesReachable() throws Exception {
        // Build only the view tree: no sign-in, remote refresh, updater network call or
        // Room transaction is part of this UI reachability test.
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).get();
        Method build = MainActivity.class.getDeclaredMethod("buildContent");
        build.setAccessible(true);
        assertNotNull(build.invoke(activity));

        Field session = MainActivity.class.getDeclaredField("currentSession");
        session.setAccessible(true);
        session.set(activity, new SupabaseApi.AuthSession(
                "test", "test", "user-a", "test@example.invalid", "CONTRACTOR",
                "org-a", 0L));

        LinearLayout home = (LinearLayout) field(activity, "homePane");
        LinearLayout orders = (LinearLayout) field(activity, "workOrdersPane");
        LinearLayout account = (LinearLayout) field(activity, "accountPane");

        invoke(activity, "showPage", "HOME");
        // Empty introduction no longer consumes permanent space in the Home layout.
        assertEquals(View.GONE, ((android.widget.TextView)
                field(activity, "screenIntro")).getVisibility());
        assertEquals(View.VISIBLE, home.getVisibility());
        assertEquals(View.GONE, orders.getVisibility());
        assertEquals(View.GONE, account.getVisibility());
        // The existing recovery button is still attached to the Home screen.
        assertNotNull(field(activity, "recoverPhotosButton"));

        ((Button) home.getChildAt(1)).performClick(); // Work Orders
        assertEquals(View.GONE, home.getVisibility());
        assertEquals(View.VISIBLE, orders.getVisibility());
        assertNotNull(field(activity, "refreshAssignmentsButton"));
        assertNotNull(field(activity, "workOrdersContainer"));

        ((Button) orders.getChildAt(0)).performClick(); // Home
        assertEquals(View.VISIBLE, home.getVisibility());

        ((Button) home.getChildAt(2)).performClick(); // Account & Updates
        assertEquals(View.VISIBLE, account.getVisibility());
        assertNotNull(field(activity, "signOutButton"));
        assertNotNull(field(activity, "updateCheckButton"));
        assertNotNull(field(activity, "updateAppButton"));

        invoke(activity, "showSignedOutUi", "Signed out");
        // Original unauthenticated update check remains visible.
        assertEquals(View.VISIBLE, account.getVisibility());
        assertEquals(View.VISIBLE, ((android.widget.TextView)
                field(activity, "screenIntro")).getVisibility());
        assertEquals(View.VISIBLE, ((Button) field(activity, "updateCheckButton")).getVisibility());
        assertEquals(View.GONE, ((Button) field(activity, "signOutButton")).getVisibility());
    }
}
