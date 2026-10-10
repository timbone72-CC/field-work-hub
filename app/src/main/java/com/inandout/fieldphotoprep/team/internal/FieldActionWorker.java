package com.inandout.fieldphotoprep.team.internal;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class FieldActionWorker extends Worker {
    public FieldActionWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (!BuildConfig.FIELD_SYNC_ENABLED) return Result.success();
        String owner = getInputData().getString("owner"), org = getInputData().getString("org");
        if (owner == null || org == null) return Result.failure();
        TeamRuntime runtime = TeamRuntime.get(getApplicationContext());
        ActionSyncCoordinator.Outcome outcome = runtime.sync.drain(owner, org, this::isStopped);
        PhotoTransferCoordinator.Outcome transfer =
                runtime.transfers.drain(owner, org, this::isStopped);
        if (outcome == ActionSyncCoordinator.Outcome.RETRY
                || transfer == PhotoTransferCoordinator.Outcome.RETRY) return Result.retry();
        if (outcome == ActionSyncCoordinator.Outcome.DONE && !isStopped()) {
            synchronized (runtime.sync.drainLock) {
                long gen = runtime.sessions.generation();
                if (runtime.sessions.matches(gen, owner, org)) {
                    try {
                        runtime.reconcile(runtime.sessions.load(), gen);
                    } catch (SessionCoordinator.SessionChanged ignored) {
                    } catch (SupabaseApi.ApiException error) {
                        if (error.statusCode == 401 || error.statusCode == 403)
                            runtime.sessions.reject(gen);
                        else if (error.statusCode == 408
                                || error.statusCode == 429
                                || error.statusCode >= 500) return Result.retry();
                    } catch (java.io.IOException error) {
                        return Result.retry();
                    } catch (Exception error) {
                        return Result.failure();
                    }
                }
            }
        }
        return Result.success();
    }
}
