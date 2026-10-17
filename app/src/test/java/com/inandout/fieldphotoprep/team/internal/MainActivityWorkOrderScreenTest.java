package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class MainActivityWorkOrderScreenTest {
    private static Object field(MainActivity a, String name) throws Exception {
        Field f = MainActivity.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(a);
    }

    private static void call(MainActivity a, String name, Class<?> type, Object arg) throws Exception {
        Method m = MainActivity.class.getDeclaredMethod(name, type);
        m.setAccessible(true);
        m.invoke(a, arg);
    }

    private static SupabaseApi.WorkOrder work(
            String id, String run, String instance, String address, String number, String status) {
        SupabaseApi.WorkOrder order = new SupabaseApi.WorkOrder(
                id, "org-a", run, 1, number, address, "Inspection", "Instructions",
                "2026-10-22", status, "user-a", "", "", "2026-10-16T00:00:00Z",
                "", "", "");
        order.assignmentInstanceId = instance;
        return order;
    }

    private static MainActivity ui() throws Exception {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).get();
        Method build = MainActivity.class.getDeclaredMethod("buildContent");
        build.setAccessible(true);
        View root = (View) build.invoke(a);
        assertNotNull(root);
        Field session = MainActivity.class.getDeclaredField("currentSession");
        session.setAccessible(true);
        session.set(a, new SupabaseApi.AuthSession(
                "test", "test", "user-a", "test@example.invalid", "CONTRACTOR", "org-a", 0L));
        call(a, "showPage", String.class, "WORK_ORDERS");
        return a;
    }

    private static Button firstButton(LinearLayout list) {
        for (int i = 0; i < list.getChildCount(); i++) {
            if (list.getChildAt(i) instanceof Button) return (Button) list.getChildAt(i);
        }
        return null;
    }

    private static boolean containsText(View view, String text) {
        if (view instanceof TextView && ((TextView) view).getText().toString().contains(text))
            return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++)
                if (containsText(group.getChildAt(i), text)) return true;
        }
        return false;
    }

    @Test
    public void filteredListHasItsOwnScrollAndNeverConflatesDuplicateAddresses() throws Exception {
        MainActivity a = ui();
        SupabaseApi.WorkOrder one = work("wo-a", "run-a", "assign-a", "15 Oak St", "100", "ASSIGNED");
        SupabaseApi.WorkOrder two = work("wo-b", "run-b", "assign-b", "15 Oak St", "200", "IN_PROGRESS");
        SupabaseApi.WorkOrder completed =
                work("wo-c", "run-c", "assign-c", "12 Elm St", "300", "FIELD_COMPLETE");
        call(a, "renderWorkOrders", List.class, List.of(one, two, completed));

        LinearLayout list = (LinearLayout) field(a, "workOrdersContainer");
        ScrollView scroll = (ScrollView) field(a, "workOrdersScroll");
        assertSame(list.getParent(), scroll);
        assertTrue(containsText(list, "WO 100"));
        assertTrue(containsText(list, "WO 200"));
        assertTrue(containsText(list, "Inspection"));
        assertTrue(firstButton(list).getContentDescription().toString().contains("Inspection"));
        assertTrue(containsText(list, "Completed Work"));

        EditText search = (EditText) field(a, "workOrderSearch");
        assertEquals("Search address or WO", search.getHint().toString());
        Button refresh = (Button) field(a, "refreshAssignmentsButton");
        assertEquals("Refresh", refresh.getText().toString());
        assertEquals(a.getString(R.string.refresh_assignments),
                refresh.getContentDescription().toString());
        assertEquals("2 current · 1 completed",
                ((TextView) field(a, "homeSummary")).getText().toString());
        search.setText("oak");
        assertEquals(2, list.getChildCount());
        assertTrue(containsText(list, "WO 100"));
        assertTrue(containsText(list, "WO 200"));
        search.setText("300");
        assertTrue(containsText(list, "12 Elm"));
        assertFalse(containsText(list, "15 Oak"));
        search.setText("not present");
        assertTrue(containsText(list, "No matching work orders."));
        assertFalse(containsText(list, "WO 100"));
    }

    @Test
    public void jobDetailRetainsEveryLegacyActionAndRejectsChangedAssignment() throws Exception {
        MainActivity a = ui();
        SupabaseApi.WorkOrder one = work("wo-a", "run-a", "assign-a", "15 Oak St", "100", "ASSIGNED");
        call(a, "renderWorkOrders", List.class, List.of(one));
        LinearLayout list = (LinearLayout) field(a, "workOrdersContainer");
        Button open = firstButton(list);
        assertNotNull(open);
        open.performClick();
        assertEquals("WORK_ORDER_DETAIL", field(a, "selectedPage"));
        assertEquals("wo-a", field(a, "selectedWorkOrderId"));
        assertEquals("run-a", field(a, "selectedRunId"));
        assertEquals("assign-a", field(a, "selectedAssignmentInstanceId"));

        LinearLayout detail = (LinearLayout) field(a, "detailContainer");
        assertTrue(containsText(detail, "WORK ORDER"));
        assertTrue(containsText(detail, "Work type: Inspection"));
        assertTrue(containsText(detail, "Photos"));
        assertTrue(containsText(detail, "Start Work"));
        assertTrue(containsText(detail, "Accept"));

        SupabaseApi.WorkOrder changed = work(
                "wo-a", "run-new", "assign-new", "15 Oak St", "100", "ASSIGNED");
        call(a, "renderWorkOrders", List.class, List.of(changed));
        assertTrue(containsText(detail, "no longer available"));
        assertFalse(containsText(detail, "Start Work"));
        assertFalse(containsText(detail, "Photos"));
        assertEquals("run-a", field(a, "selectedRunId"));
    }

    @Test
    public void signOutClearsCachedSelectionAndSearchWithoutDeletingAnyWork() throws Exception {
        MainActivity a = ui();
        SupabaseApi.WorkOrder one = work("wo-a", "run-a", "assign-a", "15 Oak St", "100", "ASSIGNED");
        call(a, "renderWorkOrders", List.class, List.of(one));
        ((EditText) field(a, "workOrderSearch")).setText("Oak");
        firstButton((LinearLayout) field(a, "workOrdersContainer")).performClick();
        call(a, "showSignedOutUi", String.class, "Signed out");
        assertEquals("", field(a, "selectedWorkOrderId"));
        assertEquals("", ((EditText) field(a, "workOrderSearch")).getText().toString());
        assertEquals("HOME", field(a, "selectedPage"));
        assertEquals(View.GONE, ((LinearLayout) field(a, "detailPane")).getVisibility());
        assertEquals(0, ((LinearLayout) field(a, "detailContainer")).getChildCount());
    }

    @Test
    public void activeJobKeepsFinishAndBothTypesOfHandoffConsentControls() throws Exception {
        MainActivity a = ui();
        SupabaseApi.WorkOrder work = new SupabaseApi.WorkOrder(
                "wo-d", "org-a", "run-d", 1, "500", "44 Pine St",
                "Inspection", "Field instructions", "2026-10-22", "IN_PROGRESS",
                "user-a", "user-b", "", "2026-10-16T00:00:00Z", "", "", "");
        work.assignmentInstanceId = "assign-d";
        work.teamHandoffRequestId = "office-change-d";
        call(a, "renderWorkOrders", List.class, List.of(work));
        firstButton((LinearLayout) field(a, "workOrdersContainer")).performClick();

        LinearLayout detail = (LinearLayout) field(a, "detailContainer");
        assertTrue(containsText(detail, "Photos"));
        assertTrue(containsText(detail, "Finish Field Work"));
        assertTrue(containsText(detail, "Approve Reassignment"));
        assertTrue(containsText(detail, "Decline Reassignment"));
        assertTrue(containsText(detail, "Approve Office-Team Change"));
        assertTrue(containsText(detail, "Decline Office-Team Change"));
    }
}
