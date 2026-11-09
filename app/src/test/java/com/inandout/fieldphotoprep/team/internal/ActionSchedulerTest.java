package com.inandout.fieldphotoprep.team.internal;

import static org.junit.Assert.*;

import android.content.Context;

import androidx.work.*;
import androidx.work.testing.*;

import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.concurrent.TimeUnit;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, application = android.app.Application.class)
public class ActionSchedulerTest {
    @Test
    public void requestContainsOnlyIdentityAndWaitsForNetworkWithBackoff() {
        OneTimeWorkRequest request = ActionScheduler.request("owner", "org");
        assertEquals(
                NetworkType.CONNECTED, request.getWorkSpec().constraints.getRequiredNetworkType());
        assertEquals(BackoffPolicy.EXPONENTIAL, request.getWorkSpec().backoffPolicy);
        assertEquals(30000, request.getWorkSpec().backoffDelayDuration);
        assertEquals(2, request.getWorkSpec().input.getKeyValueMap().size());
        assertEquals("owner", request.getWorkSpec().input.getString("owner"));
        assertFalse(request.getWorkSpec().expedited);
    }

    @Test
    public void readinessRequestHasBoundedPeriodicNetworkOnlyIdentity() {
        PeriodicWorkRequest request = ActionScheduler.readinessRequest("owner", "org");
        assertEquals(NetworkType.CONNECTED,
                request.getWorkSpec().constraints.getRequiredNetworkType());
        assertEquals(TimeUnit.HOURS.toMillis(24), request.getWorkSpec().intervalDuration);
        assertEquals(3, request.getWorkSpec().input.getKeyValueMap().size());
        assertEquals("owner", request.getWorkSpec().input.getString("owner"));
        assertEquals("org", request.getWorkSpec().input.getString("org"));
        assertTrue(request.getWorkSpec().input.getBoolean("readiness_only", false));
        assertNotEquals(ActionScheduler.readinessWorkName("owner","org"),
                ActionScheduler.workName("owner","org"));
    }

    @Test
    public void testReadinessBuildNeverEnablesDestructiveCleanupOrWrongBackend() {
        assertFalse(BuildConfig.AUTOMATIC_CLEANUP_ENABLED);
        if (BuildConfig.CLEANUP_READINESS_POLLING_ENABLED) {
            assertTrue(BuildConfig.FIELD_SYNC_ENABLED);
            assertEquals(42, BuildConfig.VERSION_CODE);
            assertEquals("https://vyocaujuwrivoqynvitm.supabase.co",
                    SupabaseConfig.PROJECT_URL);
        } else if (!BuildConfig.FIELD_SYNC_ENABLED) {
            assertTrue(BuildConfig.VERSION_CODE == 41 || BuildConfig.VERSION_CODE == 43);
        }
    }

    @Test
    public void successorArrivingDuringDrainCannotBeStrandedByKeepPolicy() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        WorkManagerTestInitHelper.initializeTestWorkManager(
                context,
                new Configuration.Builder().setExecutor(new SynchronousExecutor()).build());
        WorkManager manager = WorkManager.getInstance(context);
        TestDriver driver = WorkManagerTestInitHelper.getTestDriver(context);
        String name = ActionScheduler.workName("owner", "org");
        OneTimeWorkRequest first = ActionScheduler.request("owner", "org"),
                successor = ActionScheduler.request("owner", "org");
        manager.enqueueUniqueWork(name, ExistingWorkPolicy.APPEND_OR_REPLACE, first)
                .getResult()
                .get(5, TimeUnit.SECONDS);
        manager.enqueueUniqueWork(name, ExistingWorkPolicy.APPEND_OR_REPLACE, successor)
                .getResult()
                .get(5, TimeUnit.SECONDS);
        assertEquals(
                WorkInfo.State.ENQUEUED,
                manager.getWorkInfoById(first.getId()).get(5, TimeUnit.SECONDS).getState());
        assertEquals(
                WorkInfo.State.BLOCKED,
                manager.getWorkInfoById(successor.getId()).get(5, TimeUnit.SECONDS).getState());
        // Signed-out/empty worker completion creates no business success; successor still executes.
        driver.setAllConstraintsMet(first.getId());
        driver.setAllConstraintsMet(successor.getId());
        assertEquals(
                WorkInfo.State.SUCCEEDED,
                manager.getWorkInfoById(successor.getId()).get(5, TimeUnit.SECONDS).getState());
    }
}
