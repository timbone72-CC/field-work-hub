package com.inandout.fieldphotoprep.team.internal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import android.graphics.Typeface;
import android.graphics.Color;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.Editable;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.ForegroundColorSpan;
import android.text.TextWatcher;
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
import java.io.File;
import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String RLS_CONTROL_WO = "TEST-0002-ADMIN-ONLY";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService updaterExecutor = Executors.newSingleThreadExecutor();
    private InternalAppUpdater updater;
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
    private Button recoverPhotosButton;
    private Button updateCheckButton;
    private Button updateAppButton;
    private TextView updateStatus;
    private UpdateReleasePolicy.Candidate availableUpdate;
    private File pendingInstallerApk;
    private Button refreshAssignmentsButton;
    private ProgressBar progress;
    private TextView statusText;
    private TextView identityText;
    private TextView rlsText;
    private TextView workOrdersHeading;
    private TextView assignmentSummaryText;
    private LinearLayout workOrdersContainer;
    private ScrollView workOrdersScroll;
    private EditText workOrderSearch;
    private LinearLayout detailPane;
    private LinearLayout detailContainer;
    private TextView detailHeading;
    private ScrollView detailScroll;
    private List<SupabaseApi.WorkOrder> downloadedWorkOrders = Collections.emptyList();
    private String selectedWorkOrderId = "";
    private String selectedRunId = "";
    private String selectedAssignmentInstanceId = "";
    private Bundle restoredNavigation;
    private int savedListScrollY = -1;
    private ScrollView mainScroll;
    private LinearLayout homePane;
    private TextView homeSummary;
    private LinearLayout workOrdersPane;
    private LinearLayout accountPane;
    private static final String PAGE_HOME = "HOME";
    private static final String PAGE_WORK_ORDERS = "WORK_ORDERS";
    private static final String PAGE_ACCOUNT = "ACCOUNT";
    private static final String PAGE_DETAIL = "WORK_ORDER_DETAIL";
    private String selectedPage = PAGE_HOME;
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
        updater = new InternalAppUpdater(this);
        runtime = TeamRuntime.get(this);
        assignmentRepository = runtime.assignments;
        setContentView(buildContent());
        showSignedOutUi(getString(R.string.signed_out));
        // Only restore display state after the same authenticated owner is re-established.
        if (savedInstanceState != null) restoredNavigation = new Bundle(savedInstanceState);
        TeamDatabase.getInstance(this).getInvalidationTracker().addObserver(evidenceObserver);
        restoreSavedSession();
        checkForUpdates(false);
    }

    private View buildContent() {
        int padding = dp(20);
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(FwhVisualStyle.CANVAS);
        shell.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView appName = text(getString(R.string.app_name), 14, false);
        appName.setBackgroundColor(FwhVisualStyle.NAVY);
        appName.setTextColor(Color.WHITE);
        appName.setPadding(dp(20), dp(14), dp(20), dp(14));
        shell.addView(appName);

        progress = new ProgressBar(this);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        progressParams.gravity = Gravity.CENTER_HORIZONTAL;
        progress.setLayoutParams(progressParams);
        shell.addView(progress);

        statusText = text("", 14, false);
        statusText.setPadding(dp(20), dp(4), dp(20), dp(4));
        shell.addView(statusText);

        mainScroll = new ScrollView(this);
        mainScroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        mainScroll.addView(root);
        shell.addView(mainScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        screenTitle = text(getString(R.string.phase1_title), 26, true);
        screenTitle.setPadding(0, dp(8), 0, dp(6));
        FwhVisualStyle.heading(screenTitle);
        root.addView(screenTitle);

        screenIntro = text(getString(R.string.phase1_intro), 15, false);
        screenIntro.setPadding(0, 0, 0, dp(18));
        FwhVisualStyle.body(screenIntro);
        root.addView(screenIntro);

        emailInput = new EditText(this);
        emailInput.setHint(R.string.email_hint);
        emailInput.setInputType(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        FwhVisualStyle.input(emailInput);
        LinearLayout.LayoutParams emailParams = matchWrap();
        emailParams.bottomMargin = dp(9);
        root.addView(emailInput, emailParams);

        passwordInput = new EditText(this);
        passwordInput.setHint(R.string.password_hint);
        passwordInput.setInputType(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        FwhVisualStyle.input(passwordInput);
        LinearLayout.LayoutParams passwordParams = matchWrap();
        passwordParams.bottomMargin = dp(12);
        root.addView(passwordInput, passwordParams);

        signInButton = new Button(this);
        signInButton.setText(R.string.sign_in);
        signInButton.setOnClickListener(v -> beginSignIn());
        FwhVisualStyle.button(signInButton, true);
        root.addView(signInButton, matchWrap());

        identityText = text("", 15, false);
        identityText.setPadding(0, dp(12), 0, 0);
        rlsText = text("", 15, true);
        rlsText.setPadding(0, dp(12), 0, dp(12));

        homePane = new LinearLayout(this);
        homePane.setOrientation(LinearLayout.VERTICAL);
        homePane.setPadding(dp(16), dp(14), dp(16), dp(18));
        FwhVisualStyle.panel(homePane);
        root.addView(homePane, matchWrap());

        TextView homeLabel = text("YOUR WORKSPACE", 12, true);
        homeLabel.setTextColor(FwhVisualStyle.TEAL);
        homeLabel.setPadding(dp(4), dp(6), 0, dp(14));
        homePane.addView(homeLabel);
        homePane.addView(navigationButton("Work Orders", true,
                () -> showPage(PAGE_WORK_ORDERS)), matchWrap());
        homePane.addView(navigationButton("Account & Updates", false,
                () -> showPage(PAGE_ACCOUNT)), matchWrap());

        accountPane = new LinearLayout(this);
        accountPane.setOrientation(LinearLayout.VERTICAL);
        accountPane.setPadding(dp(16), dp(14), dp(16), dp(18));
        FwhVisualStyle.panel(accountPane);
        root.addView(accountPane, matchWrap());
        accountPane.addView(navigationButton("← Home", false,
                () -> showPage(PAGE_HOME)), matchWrap());
        accountPane.addView(identityText);
        accountPane.addView(rlsText);

        signOutButton = new Button(this);
        signOutButton.setText(R.string.sign_out);
        signOutButton.setOnClickListener(v -> signOut());
        FwhVisualStyle.button(signOutButton, false);
        accountPane.addView(signOutButton, matchWrap());

        recoverPhotosButton = new Button(this);
        recoverPhotosButton.setText("Recover my photos");
        recoverPhotosButton.setOnClickListener(v ->
                startActivity(new Intent(this, PhotoRecoveryActivity.class)));
        FwhVisualStyle.button(recoverPhotosButton, false);
        homePane.addView(recoverPhotosButton, matchWrap());

        homeSummary = text("", 14, false);
        homeSummary.setPadding(dp(5), dp(14), dp(5), dp(6));
        FwhVisualStyle.body(homeSummary);
        homePane.addView(homeSummary);

        updateCheckButton = new Button(this);
        updateCheckButton.setText("Check for Update");
        updateCheckButton.setOnClickListener(v -> checkForUpdates(true));
        FwhVisualStyle.button(updateCheckButton, false);
        accountPane.addView(updateCheckButton, matchWrap());

        updateAppButton = new Button(this);
        updateAppButton.setText("Update App");
        updateAppButton.setVisibility(View.GONE);
        updateAppButton.setOnClickListener(v -> confirmUpdateDownload());
        FwhVisualStyle.button(updateAppButton, true);
        accountPane.addView(updateAppButton, matchWrap());

        updateStatus = text("", 13, false);
        updateStatus.setVisibility(View.GONE);
        FwhVisualStyle.body(updateStatus);
        accountPane.addView(updateStatus);

        // Work Orders has one scroll owner: search/refresh/navigation stay above the list.
        workOrdersPane = new LinearLayout(this);
        workOrdersPane.setOrientation(LinearLayout.VERTICAL);
        workOrdersPane.setPadding(padding, dp(10), padding, dp(10));
        shell.addView(workOrdersPane, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        workOrdersPane.addView(navigationButton("← Home", false,
                () -> showPage(PAGE_HOME)), matchWrap());

        workOrdersHeading = text(getString(R.string.work_orders_heading), 22, true);
        workOrdersHeading.setPadding(0, dp(6), 0, dp(4));
        FwhVisualStyle.heading(workOrdersHeading);
        workOrdersPane.addView(workOrdersHeading);

        assignmentSummaryText = text("", 14, false);
        assignmentSummaryText.setPadding(0, 0, 0, dp(6));
        FwhVisualStyle.body(assignmentSummaryText);
        workOrdersPane.addView(assignmentSummaryText);

        workOrderSearch = new EditText(this);
        workOrderSearch.setSingleLine(true);
        workOrderSearch.setTextSize(16);
        workOrderSearch.setHint("Search address or work order");
        workOrderSearch.setInputType(InputType.TYPE_CLASS_TEXT);
        workOrderSearch.setContentDescription("Search assigned work orders");
        FwhVisualStyle.input(workOrderSearch);
        workOrderSearch.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                renderVisibleWorkOrders();
                if (workOrdersScroll != null) workOrdersScroll.scrollTo(0, 0);
            }
            @Override public void afterTextChanged(Editable e) {}
        });
        LinearLayout.LayoutParams searchParams = matchWrap();
        searchParams.bottomMargin = dp(8);
        workOrdersPane.addView(workOrderSearch, searchParams);

        refreshAssignmentsButton = new Button(this);
        refreshAssignmentsButton.setText(R.string.refresh_assignments);
        refreshAssignmentsButton.setOnClickListener(v -> refreshAssignments());
        FwhVisualStyle.button(refreshAssignmentsButton, false);
        LinearLayout.LayoutParams refreshParams = matchWrap();
        refreshParams.bottomMargin = dp(6);
        workOrdersPane.addView(refreshAssignmentsButton, refreshParams);

        workOrdersScroll = new ScrollView(this);
        workOrdersScroll.setFillViewport(true);
        workOrdersScroll.setSmoothScrollingEnabled(true);
        workOrdersContainer = new LinearLayout(this);
        workOrdersContainer.setOrientation(LinearLayout.VERTICAL);
        workOrdersContainer.setPadding(0, dp(8), 0, dp(10));
        workOrdersScroll.addView(workOrdersContainer);
        workOrdersPane.addView(workOrdersScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        // A detail view uses the already-tested job card and existing action handlers.
        detailPane = new LinearLayout(this);
        detailPane.setOrientation(LinearLayout.VERTICAL);
        detailPane.setPadding(padding, dp(10), padding, dp(10));
        shell.addView(detailPane, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        detailPane.addView(navigationButton("← Work Orders", false,
                () -> showPage(PAGE_WORK_ORDERS)), matchWrap());
        detailHeading = text("Work Order", 22, true);
        detailHeading.setPadding(0, dp(6), 0, dp(4));
        FwhVisualStyle.heading(detailHeading);
        detailPane.addView(detailHeading);
        detailScroll = new ScrollView(this);
        detailContainer = new LinearLayout(this);
        detailContainer.setOrientation(LinearLayout.VERTICAL);
        detailScroll.addView(detailContainer);
        detailPane.addView(detailScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        return shell;
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
                        if (error.statusCode == 403 && runtime.sessions.matches(sessionGeneration,
                                saved.userId, saved.organizationId)) {
                            postIfCurrent(operation, sessionGeneration, () -> showSignedIn(
                                    runtime.sessions.load(), java.util.Collections.emptyList(), false,
                                    "Work access is unavailable. Protected originals can be recovered from this phone."));
                        } else if (error.isAuthenticationRejection()) {
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
                        SupabaseApi.AuthSession authenticated = runtime.sessions.load();
                        postIfCurrent(operation, sessionGeneration,
                                () -> {
                                    passwordInput.setText("");
                                    if (authenticated != null && runtime.sessions.matches(sessionGeneration,
                                            authenticated.userId, authenticated.organizationId))
                                        showSignedIn(authenticated, java.util.Collections.emptyList(), false,
                                                message + " Protected originals can be recovered from this phone.");
                                    else setLoading(false, message);
                                });
                    }
                });
    }

    private void showSignedIn(
            SupabaseApi.AuthSession session,
            List<SupabaseApi.WorkOrder> workOrders,
            boolean serverVerified,
            String message) {
        if (currentSession == null
                || !currentSession.userId.equals(session.userId)
                || !currentSession.organizationId.equals(session.organizationId)) {
            selectedPage = PAGE_HOME;
            downloadedWorkOrders = Collections.emptyList();
            selectedWorkOrderId = "";
            selectedRunId = "";
            selectedAssignmentInstanceId = "";
            workOrderSearch.setText("");
            if (restoredNavigation != null) {
                if (session.userId.equals(restoredNavigation.getString("ui.owner", ""))
                        && session.organizationId.equals(
                                restoredNavigation.getString("ui.org", ""))) {
                    String savedPage = restoredNavigation.getString("ui.page", PAGE_HOME);
                    if (PAGE_HOME.equals(savedPage) || PAGE_WORK_ORDERS.equals(savedPage)
                            || PAGE_DETAIL.equals(savedPage) || PAGE_ACCOUNT.equals(savedPage)) {
                        selectedPage = savedPage;
                    }
                    selectedWorkOrderId = restoredNavigation.getString("ui.wo", "");
                    selectedRunId = restoredNavigation.getString("ui.run", "");
                    selectedAssignmentInstanceId = restoredNavigation.getString("ui.instance", "");
                    workOrderSearch.setText(restoredNavigation.getString("ui.search", ""));
                    savedListScrollY = restoredNavigation.getInt("ui.list_y", -1);
                }
                restoredNavigation = null;
            }
        }
        currentSession = session;
        setLoading(false, message);
        passwordInput.setText("");
        emailInput.setVisibility(View.GONE);
        passwordInput.setVisibility(View.GONE);
        signInButton.setVisibility(View.GONE);
        signOutButton.setVisibility(View.VISIBLE);
        recoverPhotosButton.setVisibility(View.VISIBLE);
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
        showPage(selectedPage);
        if (savedListScrollY >= 0 && PAGE_WORK_ORDERS.equals(selectedPage)) {
            int offset = savedListScrollY;
            savedListScrollY = -1;
            workOrdersScroll.post(() -> workOrdersScroll.scrollTo(0, offset));
        }
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
                        if (error.statusCode == 403 && runtime.sessions.matches(sessionGeneration,
                                session.userId, session.organizationId)) {
                            postIfCurrent(operation, sessionGeneration, () -> showSignedIn(
                                    runtime.sessions.load(), java.util.Collections.emptyList(), false,
                                    "Work access is unavailable. Protected originals can be recovered from this phone."));
                        } else if (error.isAuthenticationRejection()) {
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
        // Only the authenticated account's existing cached/server-authorized work is shown.
        downloadedWorkOrders = new ArrayList<>(workOrders);
        int previousScroll = workOrdersScroll.getScrollY();
        renderVisibleWorkOrders();
        if (PAGE_WORK_ORDERS.equals(selectedPage)) {
            workOrdersScroll.post(() -> workOrdersScroll.scrollTo(0, previousScroll));
        }
        if (PAGE_DETAIL.equals(selectedPage)) renderSelectedWorkOrder();
    }

    private static boolean matchesWorkOrderSearch(
            SupabaseApi.WorkOrder workOrder, String search) {
        if (search == null || search.trim().isEmpty()) return true;
        String needle = search.trim().toLowerCase(Locale.ROOT);
        return workOrder.propertyAddress.toLowerCase(Locale.ROOT).contains(needle)
                || workOrder.woNumber.toLowerCase(Locale.ROOT).contains(needle);
    }

    private void renderVisibleWorkOrders() {
        if (workOrdersContainer == null) return;
        workOrdersContainer.removeAllViews();
        String search = workOrderSearch == null ? "" : workOrderSearch.getText().toString();
        int totalCurrent = 0, totalCompleted = 0, matchedCurrent = 0, matchedCompleted = 0;
        for (SupabaseApi.WorkOrder workOrder : downloadedWorkOrders) {
            if (isCurrentAssignment(workOrder)) {
                totalCurrent++;
                if (matchesWorkOrderSearch(workOrder, search)) matchedCurrent++;
            } else if (workOrder.conflictReason.isEmpty()
                    && isCompletedWork(workOrder.fieldStatus)) {
                totalCompleted++;
                if (matchesWorkOrderSearch(workOrder, search)) matchedCompleted++;
            }
        }
        String summary = currentAssignmentCountText(totalCurrent);
        if (!search.trim().isEmpty()) {
            summary += " · " + (matchedCurrent + matchedCompleted) + " matching";
        }
        assignmentSummaryText.setText(summary);
        homeSummary.setText(currentAssignmentCountText(totalCurrent)
                + " · " + completedCountText(totalCompleted));

        if (matchedCurrent == 0 && search.trim().isEmpty()) {
            workOrdersContainer.addView(text(getString(R.string.no_assignments), 15, false));
        }
        for (SupabaseApi.WorkOrder workOrder : downloadedWorkOrders) {
            if (isCurrentAssignment(workOrder) && matchesWorkOrderSearch(workOrder, search)) {
                addWorkOrderListEntry(workOrder);
            }
        }
        if (matchedCompleted > 0) {
            TextView completedHeading = text(getString(R.string.completed_work_heading), 19, true);
            completedHeading.setPadding(0, dp(14), 0, dp(6));
            workOrdersContainer.addView(completedHeading);
            workOrdersContainer.addView(text(
                    completedCountText(totalCompleted), 13, false));
            for (SupabaseApi.WorkOrder workOrder : downloadedWorkOrders) {
                if (workOrder.conflictReason.isEmpty()
                        && isCompletedWork(workOrder.fieldStatus)
                        && matchesWorkOrderSearch(workOrder, search)) {
                    addWorkOrderListEntry(workOrder);
                }
            }
        }
        if (matchedCurrent + matchedCompleted == 0 && !search.trim().isEmpty()) {
            TextView empty = text("No matching work orders.", 15, false);
            empty.setPadding(0, dp(16), 0, dp(12));
            workOrdersContainer.addView(empty);
        }
    }

    private void addWorkOrderListEntry(SupabaseApi.WorkOrder workOrder) {
        String address = workOrder.propertyAddress.isEmpty()
                ? "Address not provided" : workOrder.propertyAddress;
        String number = workOrder.woNumber.isEmpty() ? "Work order" : "WO " + workOrder.woNumber;
        if (workOrder.currentRunSequence > 1) number += " · Follow-up";
        String status = !workOrder.conflictReason.isEmpty() ? "Needs review"
                : "COMPLETE".equals(workOrder.pendingKind) ? "Field complete — waiting to sync"
                : "START".equals(workOrder.pendingKind) ? "Started — waiting to sync"
                : displayStatus(workOrder.fieldStatus);
        String due = workOrder.dueDate.isEmpty() ? "Not set" : workOrder.dueDate;
        String type = workOrder.workType == null ? "" : workOrder.workType.trim();
        Button row = new Button(this);
        String jobLine = type.isEmpty() ? number : number + " · " + type;
        String rowText = address + "\n" + jobLine + "\n" + status + " · Due " + due;
        SpannableString styledRow = new SpannableString(rowText);
        styledRow.setSpan(new StyleSpan(Typeface.BOLD), 0, address.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        styledRow.setSpan(new RelativeSizeSpan(1.12f), 0, address.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        styledRow.setSpan(new ForegroundColorSpan(FwhVisualStyle.SUBTLE),
                address.length() + 1, rowText.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (!workOrder.conflictReason.isEmpty()) {
            int issueStart = rowText.indexOf(status, address.length() + 1);
            if (issueStart >= 0) styledRow.setSpan(
                    new ForegroundColorSpan(FwhVisualStyle.WARN),
                    issueStart, issueStart + status.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        row.setText(styledRow);
        row.setAllCaps(false);
        row.setTextSize(15);
        row.setMinHeight(dp(94));
        row.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(10), dp(14), dp(10));
        FwhVisualStyle.button(row, false);
        row.setTextSize(15);
        row.setTypeface(Typeface.DEFAULT, Typeface.NORMAL);
        row.setContentDescription("Open " + address + ", " + number
                + ", " + status + ", due " + due);
        LinearLayout.LayoutParams params = matchWrap();
        params.bottomMargin = dp(8);
        row.setLayoutParams(params);
        row.setOnClickListener(v -> selectWorkOrder(workOrder));
        workOrdersContainer.addView(row);
    }

    private void selectWorkOrder(SupabaseApi.WorkOrder workOrder) {
        if (currentSession == null || !downloadedWorkOrders.contains(workOrder)) return;
        selectedWorkOrderId = workOrder.id;
        selectedRunId = workOrder.currentRunId;
        selectedAssignmentInstanceId = workOrder.assignmentInstanceId;
        renderSelectedWorkOrder();
        showPage(PAGE_DETAIL);
        detailScroll.scrollTo(0, 0);
    }

    private void renderSelectedWorkOrder() {
        detailContainer.removeAllViews();
        // No fallback to an earlier or later run of the same WO after a refresh.
        SupabaseApi.WorkOrder selected = null;
        for (SupabaseApi.WorkOrder candidate : downloadedWorkOrders) {
            if (candidate.id.equals(selectedWorkOrderId)
                    && candidate.currentRunId.equals(selectedRunId)
                    && candidate.assignmentInstanceId.equals(selectedAssignmentInstanceId)
                    && (isCurrentAssignment(candidate)
                        || (candidate.conflictReason.isEmpty()
                            && isCompletedWork(candidate.fieldStatus)))) {
                selected = candidate;
                break;
            }
        }
        if (selected == null) {
            detailHeading.setText("Work Order Unavailable");
            detailContainer.addView(text(
                    "This exact assignment is no longer available in your downloaded work."
                    + " Your saved evidence has not been deleted. Return to Work Orders"
                    + " or refresh online; do not continue using an older assignment.", 15, false));
            return;
        }
        detailHeading.setText("Work Order Details");
        addWorkOrderCard(selected);
    }

    private void addWorkOrderCard(SupabaseApi.WorkOrder workOrder) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(18));
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

        TextView propertyLabel = text("PROPERTY", 12, true);
        propertyLabel.setTextColor(FwhVisualStyle.TEAL);
        card.addView(propertyLabel);
        card.addView(text(address, 20, true));
        card.addView(text(workOrder.currentRunSequence > 1
                ? "Follow-up — client " + woNumber : woNumber, 14, true));
        if (workOrder.currentRunSequence > 1 && !workOrder.reopenReason.isEmpty())
            card.addView(text("Follow-up reason: " + workOrder.reopenReason, 14, false));
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
        TextView jobStatus = text("Status: " + status, 14, true);
        if (!workOrder.conflictReason.isEmpty())
            jobStatus.setTextColor(FwhVisualStyle.WARN);
        card.addView(jobStatus);
        if (workOrder.acknowledgmentReceivedAt.isEmpty() && workOrder.acceptPending)
            card.addView(text("Accepted — pending sync", 14, true));
        else if (!workOrder.acknowledgmentReceivedAt.isEmpty())
            card.addView(text("Accepted — confirmed by office", 14, true));
        try { card.addView(text(PhotoRequirements.parse(workOrder.requirementSnapshotJson).summary(), 14, false)); }
        catch (Exception e) { card.addView(text(e.getMessage(),14,true)); }
        Button photos = new Button(this); photos.setText("Photos");
        photos.setOnClickListener(v -> startActivity(new android.content.Intent(this, PhotoActivity.class)
                .putExtra("wo",workOrder.id).putExtra("run",workOrder.currentRunId)));
        styleWorkAction(photos, false);
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
            if (workOrder.acknowledgmentReceivedAt.isEmpty()
                    && !workOrder.acceptPending
                    && !"CANCELLED".equals(workOrder.fieldStatus)
                    && !workOrder.assignmentInstanceId.isEmpty()) {
                Button accept = new Button(this);
                accept.setText("Accept");
                accept.setOnClickListener(v -> {
                    accept.setEnabled(false);
                    queueFieldAction(workOrder, "ACK");
                });
                styleWorkAction(accept, false);
                card.addView(accept);
            }
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
                styleWorkAction(action, true);
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
            styleWorkAction(approve, false);
            card.addView(approve);

            Button decline = new Button(this);
            decline.setText("Decline Reassignment");
            decline.setOnClickListener(v -> respondToReassignment(workOrder.id, false));
            LinearLayout.LayoutParams declineParams = matchWrap();
            declineParams.topMargin = dp(6);
            decline.setLayoutParams(declineParams);
            styleWorkAction(decline, false);
            card.addView(decline);
        }

        if (currentSession != null
                && currentSession.userId.equals(workOrder.assignedUserId)
                && "IN_PROGRESS".equals(workOrder.fieldStatus)
                && !workOrder.teamHandoffRequestId.isEmpty()
                && BuildConfig.FIELD_SYNC_ENABLED) {
            card.addView(text("A manager requests moving office responsibility for this job."
                    + " You remain the Contractor, with the same work and photos."
                    + " Approve or decline online.", 14, true));
            Button approveTeam = new Button(this);
            approveTeam.setText("Approve Office-Team Change");
            approveTeam.setLayoutParams(matchWrap());
            approveTeam.setEnabled(workOrder.pendingKind.isEmpty()
                    && workOrder.conflictReason.isEmpty());
            approveTeam.setOnClickListener(v -> respondToTeamHandoff(
                    workOrder.id, workOrder.teamHandoffRequestId, true));
            styleWorkAction(approveTeam, false);
            card.addView(approveTeam);
            if (!approveTeam.isEnabled())
                card.addView(text("Sync pending work and protect saved photos"
                        + " before approving this office change.", 14, true));
            Button declineTeam = new Button(this);
            declineTeam.setText("Decline Office-Team Change");
            declineTeam.setLayoutParams(matchWrap());
            declineTeam.setOnClickListener(v -> respondToTeamHandoff(
                    workOrder.id, workOrder.teamHandoffRequestId, false));
            styleWorkAction(declineTeam, false);
            card.addView(declineTeam);
        }

        FwhVisualStyle.panel(card);
        detailContainer.addView(card);
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

    private void respondToTeamHandoff(String workOrderId, String requestId, boolean accept) {
        long operation = sessionOperations.capture();
        long sessionGeneration = runtime.sessions.generation();
        SupabaseApi.AuthSession session = currentSession;
        if (session == null || requestId == null || requestId.isEmpty()) {
            statusText.setText("Sign in and refresh before responding to an office change.");
            return;
        }
        progress.setVisibility(View.VISIBLE);
        refreshAssignmentsButton.setEnabled(false);
        statusText.setText(accept ? "Approving office change…" : "Declining office change…");
        executor.execute(() -> {
            try {
                runtime.respondTeamHandoffConsent(session, sessionGeneration,
                        workOrderId, requestId, accept);
                List<SupabaseApi.WorkOrder> workOrders =
                        runtime.refresh(session, sessionGeneration);
                SupabaseApi.AuthSession refreshed = runtime.sessions.load();
                if (refreshed == null) return;
                postIfCurrent(operation, sessionGeneration, () -> {
                    progress.setVisibility(View.GONE);
                    refreshAssignmentsButton.setEnabled(true);
                    showSignedIn(refreshed, workOrders, true, accept
                            ? "Office-team request approved. The manager must still confirm"
                                + " the change; your current work and photos remain yours."
                            : "Office-team request declined. Your assignment is unchanged.");
                });
            } catch (IOException error) {
                showRefreshFailure(operation, sessionGeneration,
                        "Network required to respond to an office-team change.");
            } catch (SupabaseApi.ApiException error) {
                if (error.isAuthenticationRejection()) {
                    runtime.sessions.reject(sessionGeneration);
                    postSessionExpired(operation, sessionGeneration);
                } else {
                    showRefreshFailure(operation, sessionGeneration,
                            safeMessage(error, "Unable to respond to office-team change."));
                }
            } catch (Exception error) {
                showRefreshFailure(operation, sessionGeneration,
                        safeMessage(error, "Unable to respond to office-team change."));
            }
        });
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


    private void checkForUpdates(boolean manual) {
        long now = System.currentTimeMillis();
        android.content.SharedPreferences prefs =
                getSharedPreferences("internal_app_update_checks", MODE_PRIVATE);
        long last = prefs.getLong("last_attempt", 0L);
        if (!manual && last > 0 && now >= last && now - last < 6L * 60 * 60 * 1000) {
            return;
        }
        prefs.edit().putLong("last_attempt", now).apply();
        updateCheckButton.setEnabled(false);
        if (manual) {
            updateStatus.setVisibility(View.VISIBLE);
            updateStatus.setText("Checking for an internal update…");
        }
        updaterExecutor.execute(() -> {
            try {
                UpdateReleasePolicy.Candidate candidate = updater.check();
                mainHandler.post(() -> {
                    if (isDestroyed()) return;
                    availableUpdate = candidate;
                    updateCheckButton.setEnabled(true);
                    updateAppButton.setVisibility(candidate == null ? View.GONE : View.VISIBLE);
                    if (candidate != null) {
                        updateStatus.setVisibility(View.VISIBLE);
                        updateStatus.setText("Internal update available — version " + candidate.versionCode);
                    } else if (manual) {
                        updateStatus.setVisibility(View.VISIBLE);
                        updateStatus.setText("Field Work Hub Internal is up to date.");
                    }
                });
            } catch (Exception error) {
                mainHandler.post(() -> {
                    if (isDestroyed()) return;
                    availableUpdate = null;
                    updateCheckButton.setEnabled(true);
                    updateAppButton.setVisibility(View.GONE);
                    if (manual) {
                        updateStatus.setVisibility(View.VISIBLE);
                        updateStatus.setText("Update check unavailable. Your current app and jobs are safe.");
                    }
                });
            }
        });
    }

    private void confirmUpdateDownload() {
        UpdateReleasePolicy.Candidate candidate = availableUpdate;
        if (candidate == null) return;
        new AlertDialog.Builder(this)
                .setTitle("Update Field Work Hub Internal?")
                .setMessage("Finish taking photos before installing. The app will verify the download "
                        + "and Android will ask you to confirm the update. Your jobs and photos stay on this phone.")
                .setNegativeButton("Not now", (dialog, which) -> {})
                .setPositiveButton("Download update", (dialog, which) -> downloadUpdate(candidate))
                .show();
    }

    private void downloadUpdate(UpdateReleasePolicy.Candidate candidate) {
        updateAppButton.setEnabled(false);
        updateStatus.setVisibility(View.VISIBLE);
        updateStatus.setText("Downloading and verifying the update…");
        updaterExecutor.execute(() -> {
            try {
                File verified = updater.downloadAndVerify(candidate);
                mainHandler.post(() -> {
                    if (isDestroyed()) return;
                    pendingInstallerApk = verified;
                    updateAppButton.setEnabled(true);
                    continueInstaller();
                });
            } catch (Exception error) {
                mainHandler.post(() -> {
                    if (isDestroyed()) return;
                    pendingInstallerApk = null;
                    updateAppButton.setEnabled(true);
                    updateStatus.setText("Update not installed: verification or download failed. "
                            + "Existing jobs and photos are unchanged.");
                });
            }
        });
    }

    private void continueInstaller() {
        if (pendingInstallerApk == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            updateStatus.setText("Allow this app to install updates in Android settings, then return. "
                    + "Nothing has been uninstalled.");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception error) {
                updateStatus.setText("Android did not open installer permissions. "
                        + "Your existing app and data are safe.");
            }
            return;
        }
        File ready = pendingInstallerApk;
        pendingInstallerApk = null; // A cancelled system installer must never reopen automatically.
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", ready);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(install);
            updateStatus.setText("Android installer opened. Confirm Update there when ready.");
        } catch (Exception error) {
            updateStatus.setText("Android could not open the installer. "
                    + "Your current Field Work Hub app was not changed.");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstallerApk != null && Build.VERSION.SDK_INT >= 26
                && getPackageManager().canRequestPackageInstalls()) {
            continueInstaller();
        }
    }

    private void signOut() {
        sessionOperations.invalidate(runtime::signOut);
        showSignedOutUi(getString(R.string.signed_out));
    }

    private void showSignedOutUi(String message) {
        currentSession = null;
        selectedPage = PAGE_HOME;
        selectedWorkOrderId = "";
        selectedRunId = "";
        selectedAssignmentInstanceId = "";
        downloadedWorkOrders = Collections.emptyList();
        savedListScrollY = -1;
        restoredNavigation = null;
        workOrderSearch.setText("");
        detailContainer.removeAllViews();
        mainScroll.setVisibility(View.VISIBLE);
        detailPane.setVisibility(View.GONE);
        homePane.setVisibility(View.GONE);
        workOrdersPane.setVisibility(View.GONE);
        accountPane.setVisibility(View.VISIBLE);
        // Updates remain reachable even before sign-in; Hide only the account's Home link.
        accountPane.getChildAt(0).setVisibility(View.GONE);
        passwordInput.setText("");
        screenTitle.setText(R.string.phase1_title);
        screenIntro.setText(R.string.phase1_intro);
        emailInput.setVisibility(View.VISIBLE);
        passwordInput.setVisibility(View.VISIBLE);
        signInButton.setVisibility(View.VISIBLE);
        signInButton.setEnabled(true);
        signOutButton.setVisibility(View.GONE);
        recoverPhotosButton.setVisibility(View.GONE);
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

    private void styleWorkAction(Button button, boolean primary) {
        FwhVisualStyle.button(button, primary);
        LinearLayout.LayoutParams params =
                button.getLayoutParams() instanceof LinearLayout.LayoutParams
                        ? (LinearLayout.LayoutParams) button.getLayoutParams() : matchWrap();
        params.topMargin = Math.max(params.topMargin, dp(6));
        params.bottomMargin = Math.max(params.bottomMargin, dp(5));
        button.setLayoutParams(params);
    }

    private Button navigationButton(String label, boolean primary, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(16);
        button.setMinHeight(dp(56));
        FwhVisualStyle.button(button, primary);
        LinearLayout.LayoutParams layout = matchWrap();
        layout.bottomMargin = dp(10);
        button.setLayoutParams(layout);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    private void showPage(String page) {
        if (currentSession == null) return;
        boolean changedPage = !page.equals(selectedPage);
        selectedPage = page;
        if (changedPage && mainScroll != null) mainScroll.scrollTo(0, 0);
        mainScroll.setVisibility(
                PAGE_WORK_ORDERS.equals(page) || PAGE_DETAIL.equals(page)
                        ? View.GONE : View.VISIBLE);
        detailPane.setVisibility(PAGE_DETAIL.equals(page) ? View.VISIBLE : View.GONE);
        homePane.setVisibility(PAGE_HOME.equals(page) ? View.VISIBLE : View.GONE);
        workOrdersPane.setVisibility(PAGE_WORK_ORDERS.equals(page) ? View.VISIBLE : View.GONE);
        accountPane.setVisibility(PAGE_ACCOUNT.equals(page) ? View.VISIBLE : View.GONE);
        accountPane.getChildAt(0).setVisibility(View.VISIBLE);
        if (PAGE_WORK_ORDERS.equals(page)) {
            if ("CONTRACTOR".equals(currentSession.role)) {
                screenTitle.setText(R.string.assignments_title);
                screenIntro.setText(R.string.assignments_intro);
            } else {
                // Keep the existing non-contractor presentation unchanged.
                screenTitle.setText(R.string.phase1_title);
                screenIntro.setText(R.string.phase1_intro);
            }
        } else if (PAGE_ACCOUNT.equals(page)) {
            screenTitle.setText("Account & Updates");
            screenIntro.setText("");
        } else {
            screenTitle.setText("Home");
            screenIntro.setText("");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (currentSession != null) {
            outState.putString("ui.owner", currentSession.userId);
            outState.putString("ui.org", currentSession.organizationId);
            outState.putString("ui.page", selectedPage);
            outState.putString("ui.wo", selectedWorkOrderId);
            outState.putString("ui.run", selectedRunId);
            outState.putString("ui.instance", selectedAssignmentInstanceId);
            outState.putString("ui.search", workOrderSearch.getText().toString());
            outState.putInt("ui.list_y", workOrdersScroll.getScrollY());
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    @Deprecated
    public void onBackPressed() {
        if (currentSession != null && PAGE_DETAIL.equals(selectedPage)) {
            showPage(PAGE_WORK_ORDERS);
        } else if (currentSession != null && !PAGE_HOME.equals(selectedPage)) {
            showPage(PAGE_HOME);
        } else {
            super.onBackPressed();
        }
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
            view.setTextColor(FwhVisualStyle.INK);
        } else {
            FwhVisualStyle.body(view);
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
        updaterExecutor.shutdownNow();
        super.onDestroy();
    }
}
