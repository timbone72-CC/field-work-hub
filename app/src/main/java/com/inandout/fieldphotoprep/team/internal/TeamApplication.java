package com.inandout.fieldphotoprep.team.internal;

import android.app.Application;

public final class TeamApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // Relaunch closes the Room-commit/enqueue crash gap, including force-stop recovery.
        java.util.concurrent.ExecutorService startup =
                java.util.concurrent.Executors.newSingleThreadExecutor();
        startup.execute(
                () -> {
                    TeamRuntime runtime = TeamRuntime.get(this);
                    if (BuildConfig.FIELD_SYNC_ENABLED) runtime.photos.io.execute(runtime.photos::recover);
                    SupabaseApi.AuthSession s = runtime.sessions.load();
                    if (s != null) runtime.scheduler.ensure(s);
                });
        startup.shutdown();
    }
}
