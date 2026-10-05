package com.inandout.fieldphotoprep.team.internal;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String RLS_CONTROL_WO = "TEST-0002-ADMIN-ONLY";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final SupabaseApi api = new SupabaseApi();

    private AssignmentRepository assignmentRepository;
    private TeamRuntime runtime;
    private final SessionOperationGuard sessionOperations = new SessionOperationGuard();
    private TextView screenTitle;
    private TextView screenIntro;
    private EditText emailInput;
    private EditText passwordInput;
    private Button signInButton;
    private Button signOutButton;
    private Button refreshAssignmentsButton;
    private ProgressBar progress;
    private TextView statusText;
    private TextView identityText;
    private TextView rlsText;
    private TextView workOrdersHeading;
    private TextView assignmentSummaryText;
    private LinearLayout workOrdersContainer;
    private SupabaseApi.AuthSession currentSession;
    private final androidx.room.InvalidationTracker.Observer evidenceObserver =
            new androidx.room.InvalidationTracker.Observer("cached_work_orders", "field_actions", "protected_photos") {
                @Override
                public void onInvalidated(java.util.Set<String> tables) {
                    if (executor.isShutdown()) return;
                    try {
                        executor.execute(
                                () -> {
                                    long operation = sessionOperations.capture();
        long sessionGeneration = runtime.sessions.generation();
                                    SupabaseApi.AuthSession s = runtime.sessions.load();
                                    if (s == null) {
                                        postSessionExpired(operation, sessionGeneration);
                                        return;
                                    }
                                    List<SupabaseApi.WorkOrder> cached =
                                            assignmentRepository.loadCached(s);
                                    postIfCurrent(operation, sessionGeneration,
                                            () -> {
                                                if (currentSession != null
                                                        && currentSession.userId.equals(s.userId)
                                                        && currentSession.organizationId.equals(
                                                                s.organizationId))
                                                    renderWorkOrders(cached);
                                            });
                                });
                    } catch (java.util.concurrent.RejectedExecutionException ignored) {
                        // Activity teardown has already removed this observer.
                    }
                }
            };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        runtime = TeamRuntime.get(this);
        assignmentRepository = runtime.assignments;
        setContentView(buildContent());
        showSignedOutUi(getString(R.string.signed_out));
        TeamDatabase.getInstance(this).getInvalidationTracker().addObserver(evidenceObserver);
        restoreSavedSession();
    }

    private View buildContent() {
        int padding = dp(20);

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        root.setLayoutParams(
                new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroll.addView(root);

        TextView appName = text(getString(R.string.app_name), 14, false);
        root.addView(appName);

        screenTitle = text(getString(R.string.phase1_title), 26, true);
        screenTitle.setPadding(0, dp(8), 0, dp(6));
        root.addView(screenTitle);

        screenIntro = text(getString(R.string.phase1_intro), 15, false);
        screenIntro.setPadding(0, 0, 0, dp(18));
        root.addView(screenIntro);

        emailInput = new EditText(this);
        emailInput.setHint(R.string.email_hint);
        emailInput.setInputType(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        emailInput.setSingleLine(true);
        emailInput.setLayoutParams(matchWrap());
        root.addView(emailInput);

        passwordInput = new EditText(this);
        passwordInput.setHint(R.string.password_hint);
        passwordInput.setInputType(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        passwordInput.setSingleLine(true);
        passwordInput.setLayoutParams(matchWrap());
        root.addView(passwordInput);

        signInButton = new Button(this);
        signInButton.setText(R.string.sign_in);
        signInButton.setOnClickListener(v -> beginSignIn());
        signInButton.setLayoutParams(matchWrap());
        root.addView(signInButton);

        progress = new ProgressBar(this);
        LinearLayout.LayoutParams progressParams =
                new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        progressParams.gravity = Gravity.CENTER_HORIZONTAL;
        progressParams.topMargin = dp(12);
        progress.setLayoutParams(progressParams);
        root.addView(progress);

        statusText = text("", 15, false);
        statusText.setPadding(0, dp(12), 0, 0);
        root.addView(statusText);

        identityText = text("", 15, false);
        identityText.setPadding(0, dp(12), 0, 0);
        root.addView(identityText);

        rlsText = text("", 15, true);
        rlsText.setPadding(0, dp(12), 0, dp(12));
        root.addView(rlsText);

        signOutButton = new Button(this);
        signOutButton.setText(R.string.sign_out);
        signOutButton.setOnClickListener(v -> signOut());
        signOutButton.setLayoutParams(matchWrap());
        root.addView(signOutButton);

        workOrdersHeading = text(getString(R.string.work_orders_heading), 20, true);
        workOrdersHeading.setPadding(0, dp(20), 0, dp(4));
        root.addView(workOrdersHeading);

        assignmentSummaryText = text("", 14, false);
        assignmentSummaryText.setPadding(0, 0, 0, dp(8));
        root.addView(assignmentSummaryText);

        refreshAssignmentsButton = new Button(this);
        refreshAssignmentsButton.setText(R.string.refresh_assignments);
        refreshAssignmentsButton.setOnClickListener(v -> refreshAssignments());
        refreshAssignmentsButton.setLayoutParams(matchWrap());
        root.addView(refreshAssignmentsButton);

        workOrdersContainer = new LinearLayout(this);
        workOrdersContainer.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams workOrderParams = matchWrap();
        workOrderParams.topMargin = dp(12);
        workOrdersContainer.setLayoutParams(workOrderParams);
        root.addView(workOrdersContainer);

        return scroll;
    }

    private void restoreSavedSession() {
        long operation = sessionOperations.capture();
        long sessionGeneration = runtime.sessions.generation();
        executor.execute(
                () -> {
                    SupabaseApi.AuthSession saved = runtime.sessions.load();
                    if (saved == null) {
                        return;
                    }

                    List<SupabaseApi.WorkOrder> cached = assignmentRepository.loadCached(saved);
                    postIfCurrent(operation, sessionGeneration,
                            () ->
                                    showSignedIn(
                                            saved,
                                            cached,
                                            false,
                                            cached.isEmpty()
                                                    ? "Reconnecting to Team…"
                                                    : "Showing downloaded assignments while"
                                                            + " reconnecting…"));

                    try {
                        runtime.scheduler.ensure(saved);
                        List<SupabaseApi.WorkOrder> workOrders = runtime.refresh(saved, sessionGeneration);
                        SupabaseApi.AuthSession refreshed = runtime.sessions.load();
                        if (refreshed == null) return;
                        postIfCurrent(operation, sessionGeneration,
                                () ->
                                        showSignedIn(
                                                refreshed,
                                                workOrders,
                                                true,
                                                getString(R.string.assignments_refreshed)));
                    } catch (IOException error) {
                        postStatus(operation, sessionGeneration, "Offline — showing last downloaded assignments.");
                    } catch (SupabaseApi.ApiException error) {
                        if (error.isAuthenticationRejection()) {
                            runtime.sessions.reject(sessionGeneration);
                            postSessionExpired(operation, sessionGeneration);
                        } else {
                            postStatus(operation, sessionGeneration,
                                    "Unable to refresh right now — showing last downloaded"
                                            + " assignments.");
                        }
                    } catch (Exception error) {
                        postStatus(operation, sessionGeneration,
                                "Unable to refresh right now — showing last downloaded"
                                        + " assignments.");
                    }
                });
    }

    private void beginSignIn() {
        String email = emailInput.getText().toString().trim();
        String password = passwordInput.getText().toString();
        if (email.isEmpty() || password.isEmpty()) {
            statusText.setText("Enter both email and password.");
            return;
        }

        long operation = sessionOperations.invalidate(() -> {});
        long loginGeneration = runtime.sessions.beginLogin();
        long sessionGeneration = loginGeneration;
        setLoading(true, getString(R.string.signing_in));
        executor.execute(
                () -> {
                    try {
                        SupabaseApi.AuthSession session = api.signIn(email, password);
                        if (!sessionOperations.runIfCurrent(
                                operation,
                                () -> runtime.sessions.install(loginGeneration, session))) return;
                        if (!runtime.sessions.matches(
                                loginGeneration, session.userId, session.organizationId)) return;
                        postStatus(operation, sessionGeneration, getString(R.string.loading_work));
                        List<SupabaseApi.WorkOrder> workOrders = runtime.refresh(session, sessionGeneration);
                        postIfCurrent(operation, sessionGeneration,
                                () ->
                                        showSignedIn(
                                                session,
                                                workOrders,
                                                true,
                                                "Signed in successfully."));
                    } catch (Exception error) {
                        String message = safeMessage(error, "Sign-in failed.");
                        postIfCurrent(operation, sessionGeneration,
                                () -> {
                                    passwordInput.setText("");
                                    setLoading(false, message);
                                });
                    }
                });
    }

    private void showSignedIn(
            SupabaseApi.AuthSession session,
            List<SupabaseApi.WorkOrder> workOrders,
            boolean serverVerified,
            String message) {
        currentSession = session;
        setLoading(false, message);
        passwordInput.setText("");
        emailInput.setVisibility(View.GONE);
        passwordInput.setVisibility(View.GONE);
        signInButton.setVisibility(View.GONE);
        signOutButton.setVisibility(View.VISIBLE);
        refreshAssignmentsButton.setVisibility(View.VISIBLE);
        identityText.setVisibility(View.VISIBLE);
        workOrdersHeading.setVisibility(View.VISIBLE);
        assignmentSummaryText.setVisibility(View.VISIBLE);
        workOrdersContainer.setVisibility(View.VISIBLE);

        if ("CONTRACTOR".equals(session.role)) {
            screenTitle.setText(R.string.assignments_title);
            screenIntro.setText(R.string.assignments_intro);
            workOrdersHeading.setText(R.string.assignments_heading);
        } else {
            screenTitle.setText(R.string.phase1_title);
            screenIntro.setText(R.string.phase1_intro);
            workOrdersHeading.setText(R.string.work_orders_heading);
        }

        identityText.setText("Account: " + session.email + "\nRole: " + session.role);
        if (serverVerified) {
            updateRlsProof(session, workOrders);
        } else {
            rlsText.setText("");
            rlsText.setVisibility(View.GONE);
        }
        renderWorkOrders(workOrders);
    }

    private void refreshAssignments() {
        long operation = sessionOperations.capture();
        long sessionGeneration = runtime.sessions.generation();
        SupabaseApi.AuthSession session = currentSession;
        if (session == null) {
            statusText.setText("Sign in again before refreshing assignments.");
            return;
        }

        refreshAssignmentsButton.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        statusText.setText(R.string.refreshing_assignments);

        executor.execute(
                () -> {
                    try {
                        List<SupabaseApi.WorkOrder> workOrders = runtime.refresh(session, sessionGeneration);
                        SupabaseApi.AuthSession refreshed = runtime.sessions.load();
                        if (refreshed == null) return;
                        postIfCurrent(operation, sessionGeneration,
                                () -> {
                                    progress.setVisibility(View.GONE);
                                    refreshAssignmentsButton.setEnabled(true);
                                    showSignedIn(
                                            refreshed,
                                            workOrders,
                                            true,
                                            getString(R.string.assignments_refreshed));
                                });
                    } catch (IOException error) {
                        postIfCurrent(operation, sessionGeneration,
                                () -> {
                                    progress.setVisibility(View.GONE);
                                    refreshAssignmentsButton.setEnabled(true);
                                    statusText.setText(
                                            "Offline — downloaded assignments remain available.");
                                });
                    } catch (SupabaseApi.ApiException error) {
                        if (error.isAuthenticationRejection()) {
                            runtime.sessions.reject(sessionGeneration);
                            postSessionExpired(operation, sessionGeneration);
                        } else {
                            showRefreshFailure(operation, sessionGeneration,
                                    safeMessage(error, "Unable to refresh assignments."));
                        }
                    } catch (Exception error) {
                        showRefreshFailure(operation, sessionGeneration, safeMessage(error, "Unable to refresh assignments."));
                    }
                });
    }

    private void showRefreshFailure(long operation, long sessionGeneration, String message) {
        postIfCurrent(operation, sessionGeneration,
                () -> {
                    progress.setVisibility(View.GONE);
                    refreshAssignmentsButton.setEnabled(true);
                    statusText.setText(message);
                });
    }

    private void updateRlsProof(
            SupabaseApi.AuthSession session, List<SupabaseApi.WorkOrder> workOrders) {
        boolean foreignAssignmentReturned = false;
        boolean foreignOrganizationReturned = false;
        boolean controlReturned = false;
        for (SupabaseApi.WorkOrder workOrder : workOrders) {
            if (!session.userId.equals(workOrder.assignedUserId)) {
                foreignAssignmentReturned = true;
            }
            if (!session.organizationId.equals(workOrder.organizationId)) {
                foreignOrganizationReturned = true;
            }
            if (RLS_CONTROL_WO.equals(workOrder.woNumber)) {
                controlReturned = true;
            }
        }

        if ("CONTRACTOR".equals(session.role)
                && !foreignAssignmentReturned
                && !foreignOrganizationReturned
                && !controlReturned
                && !workOrders.isEmpty()) {
            rlsText.setText(
                    "RLS CHECK: PASS\n"
                            + "Server returned "
                            + workOrders.size()
                            + " work order(s), all assigned to this account. The admin-only control"
                            + " WO was not returned. No client-side assignment filter was used.");
            rlsText.setVisibility(View.GONE);
        } else if ("CONTRACTOR".equals(session.role) && workOrders.isEmpty()) {
            rlsText.setText(
                    "RLS CHECK: PASS\n"
                            + "No work orders are currently assigned to this contractor account.");
            rlsText.setVisibility(View.GONE);
        } else if ("CONTRACTOR".equals(session.role)) {
            rlsText.setText(
                    "RLS CHECK: NEEDS REVIEW\n"
                            + "The contractor response contained a row that should not have been"
                            + " returned.");
            rlsText.setVisibility(View.VISIBLE);
        } else {
            rlsText.setText(
                    "Signed in as "
                            + session.role
                            + ". Contractor-only RLS proof is evaluated when a CONTRACTOR account"
                            + " signs in.");
            rlsText.setVisibility(View.VISIBLE);
        }
    }

    private void renderWorkOrders(List<SupabaseApi.WorkOrder> workOrders) {
        workOrdersContainer.removeAllViews();

        int currentCount = 0;
        int completedCount = 0;
        for (SupabaseApi.WorkOrder workOrder : workOrders) {
            if (isCurrentAssignment(workOrder)) {
                currentCount++;
            } else if ((workOrder.conflictReason.isEmpty()
                    && isCompletedWork(workOrder.fieldStatus))) {
                completedCount++;
            }
        }

        assignmentSummaryText.setText(currentAssignmentCountText(currentCount));

        if (currentCount == 0) {
            TextView empty = text(getString(R.string.no_assignments), 15, false);
            empty.setPadding(0, dp(10), 0, dp(10));
            workOrdersContainer.addView(empty);
        } else {
            for (SupabaseApi.WorkOrder workOrder : workOrders) {
                if (isCurrentAssignment(workOrder)) {
                    addWorkOrderCard(workOrder);
                }
            }
        }

        if (completedCount > 0) {
            TextView completedHeading = text(getString(R.string.completed_work_heading), 20, true);
            completedHeading.setPadding(0, dp(20), 0, dp(4));
            workOrdersContainer.addView(completedHeading);

            TextView completedSummary = text(completedCountText(completedCount), 14, false);
            completedSummary.setPadding(0, 0, 0, dp(8));
            workOrdersContainer.addView(completedSummary);

            for (SupabaseApi.WorkOrder workOrder : workOrders) {
                if ((workOrder.conflictReason.isEmpty()
                        && isCompletedWork(workOrder.fieldStatus))) {
                    addWorkOrderCard(workOrder);
                }
            }
        }
    }

    private void addWorkOrderCard(SupabaseApi.WorkOrder workOrder) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(12), dp(12), dp(12));
        LinearLayout.LayoutParams cardParams = matchWrap();
        cardParams.bottomMargin = dp(10);
        card.setLayoutParams(cardParams);

        String address =
                workOrder.propertyAddress.isEmpty()
                        ? "Address not provided"
                        : workOrder.propertyAddress;
        String woNumber = workOrder.woNumber.isEmpty() ? "Work order" : "WO " + workOrder.woNumber;
        String workType =
                workOrder.workType.isEmpty() ? "Work type not provided" : workOrder.workType;
        String dueDate = workOrder.dueDate.isEmpty() ? "Not set" : workOrder.dueDate;

        card.addView(text(address, 18, true));
        card.addView(text(woNumber, 14, true));
        card.addView(text("Work type: " + workType, 14, false));
        card.addView(text("Due: " + dueDate, 14, false));
        String status =
                !workOrder.conflictReason.isEmpty()
                        ? "Needs review"
                        : "COMPLETE".equals(workOrder.pendingKind)
                                ? "Field complete — waiting to sync"
                                : "START".equals(workOrder.pendingKind)
                                        ? "Started — waiting to sync"
                                        : displayStatus(workOrder.fieldStatus);
        card.addView(text("Status: " + status, 14, false));
        try { card.addView(text(PhotoRequirements.parse(workOrder.requirementSnapshotJson).summary(), 14, false)); }
        catch (Exception e) { card.addView(text(e.getMessage(),14,true)); }
        Button photos = new Button(this); photos.setText("Photos");
        photos.setOnClickListener(v -> startActivity(new android.content.Intent(this, PhotoActivity.class)
                .putExtra("wo",workOrder.id).putExtra("run",workOrder.currentRunId)));
        card.addView(photos);

        if (!workOrder.conflictReason.isEmpty()) {
            String explanation =
                    "CLOCK_REVIEW".equals(workOrder.conflictReason)
                                    || "FINISH_BEFORE_START".equals(workOrder.conflictReason)
                            ? "Your saved progress is preserved. The phone time needs review."
                                    + " Contact Admin before continuing."
                            : workOrder.conflictReason.startsWith("PROTOCOL")
                                    ? "Your saved progress is preserved. Sync is paused because its"
                                            + " response could not be confirmed. Contact Admin."
                                    : "Your saved offline progress is preserved. This assignment"
                                            + " could not be confirmed. Contact Admin before"
                                            + " continuing.";
            card.addView(text(explanation, 14, true));
        } else if (currentSession != null
                && "CONTRACTOR".equals(currentSession.role)
                && BuildConfig.FIELD_SYNC_ENABLED) {
            boolean start =
                    "ASSIGNED".equals(workOrder.fieldStatus) && workOrder.pendingKind.isEmpty();
            boolean finish =
                    ("IN_PROGRESS".equals(workOrder.fieldStatus)
                                    || "START".equals(workOrder.pendingKind))
                            && !"COMPLETE".equals(workOrder.pendingKind);
            if (start || finish) {
                Button action = new Button(this);
                action.setText(start ? "Start Work" : "Finish Field Work");
                action.setEnabled(!workOrder.assignmentInstanceId.isEmpty());
                action.setOnClickListener(
                        v -> {
                            action.setEnabled(false);
                            queueFieldAction(workOrder, start ? "START" : "COMPLETE");
                        });
                card.addView(action);
                if (workOrder.assignmentInstanceId.isEmpty())
                    card.addView(
                            text("Refresh Assignments online to enable field actions.", 14, false));
            }
        }
        card.addView(
                text(
                        workOrder.assignmentReceivedAt.isEmpty()
                                ? "Assignment receipt: Pending"
                                : "Assignment receipt: Confirmed",
                        14,
                        !workOrder.assignmentReceivedAt.isEmpty()));

        if (!workOrder.instructions.isEmpty()) {
            TextView instructions = text("Instructions: " + workOrder.instructions, 14, false);
            instructions.setPadding(0, dp(8), 0, 0);
            card.addView(instructions);
        }

        if (currentSession != null
                && currentSession.userId.equals(workOrder.assignedUserId)
                && "IN_PROGRESS".equals(workOrder.fieldStatus)
                && !workOrder.pendingAssigneeUserId.isEmpty()
                && BuildConfig.FIELD_SYNC_ENABLED) {
            TextView request =
                    text(
                            "Admin requested that this in-progress WO be reassigned. Approve the"
                                    + " handoff if you need to release it, or decline to keep the"
                                    + " assignment.",
                            14,
                            true);
            request.setPadding(0, dp(12), 0, dp(8));
            card.addView(request);

            Button approve = new Button(this);
            approve.setText("Approve Reassignment");
            approve.setOnClickListener(v -> respondToReassignment(workOrder.id, true));
            if (!workOrder.pendingKind.isEmpty() || !workOrder.conflictReason.isEmpty()) {
                approve.setEnabled(false);
                card.addView(
                        text(
                                "Sync saved offline progress before approving this handoff, or"
                                        + " contact Admin if it needs review.",
                                14,
                                true));
            }
            approve.setLayoutParams(matchWrap());
            card.addView(approve);

            Button decline = new Button(this);
            decline.setText("Decline Reassignment");
            decline.setOnClickListener(v -> respondToReassignment(workOrder.id, false));
            LinearLayout.LayoutParams declineParams = matchWrap();
            declineParams.topMargin = dp(6);
            decline.setLayoutParams(declineParams);
            card.addView(decline);
        }

        workOrdersContainer.addView(card);
    }

    private boolean isCurrentAssignment(SupabaseApi.WorkOrder workOrder) {
        return !workOrder.conflictReason.isEmpty()
                || "ASSIGNED".equals(workOrder.fieldStatus)
                || "IN_PROGRESS".equals(workOrder.fieldStatus);
    }

    private boolean isCompletedWork(String status) {
        return "FIELD_COMPLETE".equals(status);
    }

    private String currentAssignmentCountText(int count) {
        if (count == 1) {
            return "1 current assignment";
        }
        return count + " current assignments";
    }

    private String completedCountText(int count) {
        if (count == 1) {
            return "1 completed work order";
        }
        return count + " completed work orders";
    }

    private String displayStatus(String status) {
        if (status == null || status.isEmpty()) {
            return "Unknown";
        }
        return status.replace('_', ' ');
    }

    private void queueFieldAction(SupabaseApi.WorkOrder workOrder, String kind) {
        long operation = sessionOperations.capture();
        long sessionGeneration = runtime.sessions.generation();
        SupabaseApi.AuthSession session = currentSession;
        executor.execute(
                () -> {
                    try {
                        runtime.create(session, sessionGeneration, workOrder.id, workOrder.currentRunId, kind);
                        List<SupabaseApi.WorkOrder> cached =
                                assignmentRepository.loadCached(session);
                        postIfCurrent(operation, sessionGeneration,
                                () ->
                                        showSignedIn(
                                                session,
                                                cached,
                                                false,
                                                "Saved on this phone — waiting to sync."));
                    } catch (Exception error) {
                        List<SupabaseApi.WorkOrder> cached =
                                assignmentRepository.loadCached(session);
                        postIfCurrent(operation, sessionGeneration,
                                () -> {
                                    String message = safeMessage(error, "Unable to save field action.");
                                    showSignedIn(session, cached, false, message);
                                    if ("COMPLETE".equals(kind))
                                        showFinishBlockedDialog(workOrder, message);
                                });
                    }
                });
    }

    // The work list can be scrolled far below statusText when Finish is tapped.
    // Show the authoritative transaction failure without requiring a scroll to the top.
    void showFinishBlockedDialog(SupabaseApi.WorkOrder workOrder, String message) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle("Can't finish field work")
                .setMessage(workOrder.woNumber + "\n\n" + message)
                .setPositiveButton("Open Photos", (dialog, which) ->
                        startActivity(new android.content.Intent(this, PhotoActivity.class)
                                .putExtra("wo", workOrder.id)
                                .putExtra("run", workOrder.currentRunId)))
                .setNegativeButton("OK", null)
                .show();
    }

    private void respondToReassignment(String workOrderId, boolean accept) {
        long operation = sessionOperations.capture();
        long sessionGeneration = runtime.sessions.generation();
        SupabaseApi.AuthSession session = currentSession;
        if (session == null) {
            statusText.setText("Sign in again before responding to reassignment.");
            return;
        }

        progress.setVisibility(View.VISIBLE);
        refreshAssignmentsButton.setEnabled(false);
        statusText.setText(accept ? "Approving reassignment…" : "Declining reassignment…");
        executor.execute(
                () -> {
                    try {
                        runtime.handoff(session, sessionGeneration, workOrderId, accept);
                        List<SupabaseApi.WorkOrder> workOrders = runtime.refresh(session, sessionGeneration);
                        SupabaseApi.AuthSession refreshed = runtime.sessions.load();
                        if (refreshed == null) return;
                        postIfCurrent(operation, sessionGeneration,
                                () -> {
                                    progress.setVisibility(View.GONE);
                                    refreshAssignmentsButton.setEnabled(true);
                                    showSignedIn(
                                            refreshed,
                                            workOrders,
                                            true,
                                            accept
                                                    ? "Reassignment approved. This WO has been"
                                                            + " released to the new assignee."
                                                    : "Reassignment declined. This WO remains"
                                                            + " assigned to you.");
                                });
                    } catch (IOException error) {
                        showRefreshFailure(operation, sessionGeneration, "Network required to respond to reassignment.");
                    } catch (SupabaseApi.ApiException error) {
                        if (error.isAuthenticationRejection()) {
                            runtime.sessions.reject(sessionGeneration);
                            postSessionExpired(operation, sessionGeneration);
                        } else {
                            showRefreshFailure(operation, sessionGeneration,
                                    safeMessage(error, "Unable to respond to reassignment."));
                        }
                    } catch (Exception error) {
                        showRefreshFailure(operation, sessionGeneration,
                                safeMessage(error, "Unable to respond to reassignment."));
                    }
                });
    }

    private void signOut() {
        sessionOperations.invalidate(runtime::signOut);
        showSignedOutUi(getString(R.string.signed_out));
    }

    private void showSignedOutUi(String message) {
        currentSession = null;
        passwordInput.setText("");
        screenTitle.setText(R.string.phase1_title);
        screenIntro.setText(R.string.phase1_intro);
        emailInput.setVisibility(View.VISIBLE);
        passwordInput.setVisibility(View.VISIBLE);
        signInButton.setVisibility(View.VISIBLE);
        signInButton.setEnabled(true);
        signOutButton.setVisibility(View.GONE);
        refreshAssignmentsButton.setVisibility(View.GONE);
        refreshAssignmentsButton.setEnabled(true);
        progress.setVisibility(View.GONE);
        statusText.setText(message);
        identityText.setText("");
        identityText.setVisibility(View.GONE);
        rlsText.setText("");
        rlsText.setVisibility(View.GONE);
        workOrdersHeading.setText(R.string.work_orders_heading);
        workOrdersHeading.setVisibility(View.GONE);
        assignmentSummaryText.setText("");
        assignmentSummaryText.setVisibility(View.GONE);
        workOrdersContainer.removeAllViews();
        workOrdersContainer.setVisibility(View.GONE);
    }

    private void setLoading(boolean loading, String message) {
        signInButton.setEnabled(!loading);
        emailInput.setEnabled(!loading);
        passwordInput.setEnabled(!loading);
        progress.setVisibility(loading ? View.VISIBLE : View.GONE);
        statusText.setText(message);
    }

    private void postStatus(long operation, long sessionGeneration, String message) {
        postIfCurrent(operation, sessionGeneration, () -> statusText.setText(message));
    }

    private void postIfCurrent(long operation, long sessionGeneration, Runnable action) {
        mainHandler.post(() -> sessionOperations.runIfCurrent(operation,
                () -> runtime.sessions.runIfCurrent(sessionGeneration, action)));
    }

    private void postSessionExpired(long operation, long sessionGeneration) {
        mainHandler.post(() -> sessionOperations.runIfCurrent(operation,
                () -> runtime.sessions.runIfSignedOutAfter(sessionGeneration,
                    () -> showSignedOutUi("Team session expired. Sign in again; downloaded work was preserved."))));
    }

    private String safeMessage(Exception error, String fallback) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message;
    }

    private TextView text(String value, float sizeSp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        }
        view.setLayoutParams(matchWrap());
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        TeamDatabase.getInstance(this).getInvalidationTracker().removeObserver(evidenceObserver);
        sessionOperations.invalidate(() -> {});
        mainHandler.removeCallbacksAndMessages(null);
        executor.shutdownNow();
        super.onDestroy();
    }
}
