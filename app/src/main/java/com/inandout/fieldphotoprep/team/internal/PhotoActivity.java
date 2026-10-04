package com.inandout.fieldphotoprep.team.internal;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleOwner;
import androidx.lifecycle.LifecycleRegistry;

import java.io.File;
import java.util.List;
import java.util.Locale;

/** Any-order photo items, one CameraX owner and a durable reservation before each shutter. */
public final class PhotoActivity extends Activity implements LifecycleOwner {
    private static final long ZOOM_SLIDER_HIDE_DELAY_MS = 2600L;
    private static final int ZOOM_SLIDER_STEPS = 1000;

    private final LifecycleRegistry lifecycle = new LifecycleRegistry(this);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TeamRuntime runtime;
    private SupabaseApi.AuthSession session;
    private long generation;
    private String wo, run, item = "";
    private LinearLayout root, content;
    private TextView message, counter;
    private ProcessCameraProvider provider;
    private Camera camera;
    private Preview cameraPreview;
    private ImageCapture capture;
    private PreviewView previewView;
    private FrameLayout cameraRoot;
    private TextView cameraStatus, zoomText;
    private Button shutter, done, flashButton, torchButton, wideButton, oneXButton, threeXButton;
    private LinearLayout zoomSliderPanel;
    private SeekBar zoomSlider;
    private ScaleGestureDetector zoomGestureDetector;
    private ZoomState zoomState;
    private CameraSelector physicalWideSelector;
    private float physicalWideRatio = 1f;
    private float logicalWideRatio = 1f;
    private boolean logicalWideAvailable;
    private boolean physicalWideSuppressed;
    private boolean activePhysicalWide;
    private float activeIntrinsicRatio = 1f;
    private boolean threeXAvailable;
    private boolean busy, cameraScreen, torch, updatingZoomSlider, zoomSliderTracking;
    private long cameraEpoch;
    private int flash = ImageCapture.FLASH_MODE_AUTO;
    private PhotoRequirements requirements;
    private final Runnable hideZoomSliderRunnable = () -> {
        if (!zoomSliderTracking && zoomSliderPanel != null) zoomSliderPanel.setVisibility(View.GONE);
    };
    private final androidx.room.InvalidationTracker.Observer observer = new androidx.room.InvalidationTracker.Observer(
            "protected_photos", "field_actions", "cached_work_orders") {
        @Override public void onInvalidated(java.util.Set<String> tables) {
            ui(() -> { if (cameraScreen) updateCounter(); else showItems(); });
        }
    };

    @NonNull @Override public Lifecycle getLifecycle() { return lifecycle; }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_CREATE);
        runtime = TeamRuntime.get(this);
        session = runtime.sessions.load();
        generation = runtime.sessions.generation();
        wo = getIntent().getStringExtra("wo");
        run = getIntent().getStringExtra("run");
        if (session == null || wo == null || run == null) { finish(); return; }
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(12), dp(12), dp(12), dp(12));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(dp(12), insets.getSystemWindowInsetTop() + dp(12), dp(12),
                    insets.getSystemWindowInsetBottom() + dp(12));
            return insets;
        });
        message = new TextView(this);
        message.setTextSize(15);
        root.addView(message);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        TeamDatabase.getInstance(this).getInvalidationTracker().addObserver(observer);
        showItems();
    }

    @Override protected void onStart() { super.onStart(); lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_START); }
    @Override protected void onResume() { super.onResume(); lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_RESUME); if (content != null && !cameraScreen) showItems(); }
    @Override protected void onPause() { lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE); super.onPause(); }
    @Override protected void onStop() { lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_STOP); super.onStop(); }
    @Override protected void onDestroy() {
        lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY);
        TeamDatabase.getInstance(this).getInvalidationTracker().removeObserver(observer);
        if (provider != null) provider.unbindAll();
        handler.removeCallbacks(hideZoomSliderRunnable);
        super.onDestroy();
    }

    @Override public void onConfigurationChanged(@NonNull Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (!cameraScreen || !current()) return;
        buildCameraUi();
        if (cameraPreview != null && previewView != null) {
            cameraPreview.setSurfaceProvider(previewView.getSurfaceProvider());
            cameraPreview.setTargetRotation(getWindowManager().getDefaultDisplay().getRotation());
        }
        if (capture != null) capture.setTargetRotation(getWindowManager().getDefaultDisplay().getRotation());
        if (camera != null) cameraStatus.setText("Ready. Take a photo or choose another view.");
        updateCameraUi();
    }

    private boolean current() {
        return !isDestroyed() && !isFinishing() && runtime.sessions.matches(generation, session.userId, session.organizationId);
    }
    private void ui(Runnable work) { runOnUiThread(() -> { if (current()) work.run(); else if (!isDestroyed()) finish(); }); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private Button button(String label, LinearLayout target, Runnable work) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        target.addView(b);
        b.setOnClickListener(v -> work.run());
        return b;
    }
    private TextView text(String value, LinearLayout target) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(17);
        t.setPadding(0, dp(5), 0, dp(5));
        target.addView(t);
        return t;
    }

    private void showItems() {
        cameraEpoch++;
        cameraScreen = false;
        if (provider != null) provider.unbindAll();
        camera = null;
        cameraPreview = null;
        capture = null;
        torch = false;
        setContentView(root);
        runtime.photos.io.execute(() -> {
            CachedWorkOrder row = runtime.dao.find(session.userId, session.organizationId, wo, run);
            if (row == null) { ui(this::finish); return; }
            List<ProtectedPhoto> photos = runtime.dao.photos(session.userId, session.organizationId, wo, run);
            try {
                PhotoRequirements req = PhotoRequirements.parse(row.requirementSnapshotJson);
                List<FieldAction> actions = runtime.dao.actions(session.userId, session.organizationId);
                ui(() -> renderItems(row, req, photos, actions));
            } catch (Exception e) { ui(() -> { content.removeAllViews(); message.setText(e.getMessage()); }); }
        });
    }

    private void renderItems(CachedWorkOrder row, PhotoRequirements req, List<ProtectedPhoto> photos, List<FieldAction> actions) {
        requirements = req;
        content.removeAllViews();
        message.setText(row.woNumber + " · Photos");
        ScrollView scroll = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(list);
        content.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        text(req.summary(), list);
        int total = 0;
        for (ProtectedPhoto p : photos) if (p.readable()) total++;
        text("Saved photos: " + total + " · Delivery pending", list);
        boolean started = !row.startedAt.isEmpty(), complete = false;
        for (FieldAction a : actions) if (a.workOrderId.equals(wo) && a.runId.equals(run)) {
            if ("START".equals(a.kind)) started = true;
            if ("COMPLETE".equals(a.kind)) complete = true;
        }
        boolean frozen = complete || photos.stream().anyMatch(p -> !p.finishSetId.isEmpty());
        if (frozen) text("Finish saved. Originals are protected while delivery is pending.", list);
        if (!row.conflictReason.isEmpty()) text("Needs review. Your photos are preserved. Contact Admin.", list);
        if (!BuildConfig.FIELD_SYNC_ENABLED) text("Recovery mode: saved evidence is read only.", list);
        boolean editable = started && BuildConfig.FIELD_SYNC_ENABLED && !frozen && row.conflictReason.isEmpty()
                && !"FIELD_COMPLETE".equals(row.fieldStatus) && !"CANCELLED".equals(row.fieldStatus);
        for (PhotoRequirements.Item i : req.items) if (i.enabled) {
            int count = 0;
            for (ProtectedPhoto p : photos) if (p.readable() && p.itemId.equals(i.id)) count++;
            Button b = button((count >= i.minimum ? "✓ " : "") + i.label + "  " + count + "/" + i.minimum, list, () -> { item = i.id; openCamera(); });
            b.setEnabled(editable);
        }
        Button extra = button("Extra photos", list, () -> { item = ""; openCamera(); });
        extra.setEnabled(editable);
        for (ProtectedPhoto p : photos) if (!"DISCARDED".equals(p.state)) {
            LinearLayout rowView = new LinearLayout(this);
            rowView.setOrientation(LinearLayout.HORIZONTAL);
            list.addView(rowView);
            ImageView thumbnail = new ImageView(this);
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 16;
            thumbnail.setImageBitmap(BitmapFactory.decodeFile(p.originalPath, options));
            rowView.addView(thumbnail, new LinearLayout.LayoutParams(dp(64), dp(64)));
            PhotoRequirements.Item i = req.enabledItem(p.itemId);
            Button review = button((i == null ? "Extra" : i.label) + " · " + ("WAITING".equals(p.state) ? "Saved" : p.state), rowView, () -> review(p, editable));
            review.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        }
        button("Back to work order", content, this::finish);
    }

    private void review(ProtectedPhoto p, boolean editable) {
        ImageView image = new ImageView(this);
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = 4;
        image.setImageBitmap(BitmapFactory.decodeFile(p.originalPath, o));
        image.setAdjustViewBounds(true);
        AlertDialog.Builder dialog = new AlertDialog.Builder(this).setTitle("Saved photo").setView(image).setPositiveButton("Keep", null);
        if (editable && p.finishSetId.isEmpty() && !"CAPTURING".equals(p.state)) dialog.setNegativeButton("Discard…", (d, w) -> new AlertDialog.Builder(this)
                .setTitle("Discard this photo?").setMessage("This removes this photo and its count. You can take a replacement before Finish.")
                .setNegativeButton("Keep", null).setPositiveButton("Discard", (dd, ww) -> runtime.photos.io.execute(() -> {
                    try { runtime.photos.discard(session, generation, p.id); ui(this::showItems); }
                    catch (Exception e) { ui(() -> message.setText(e.getMessage())); }
                })).show());
        dialog.show();
    }

    private void openCamera() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 8);
            return;
        }
        cameraScreen = true;
        long epoch = ++cameraEpoch;
        PhotoRequirements.Item selected = requirements.enabledItem(item);
        buildCameraUi();
        com.google.common.util.concurrent.ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            if (!current() || !cameraScreen || cameraEpoch != epoch) return;
            try {
                provider = future.get();
                bindCamera(CameraSelector.DEFAULT_BACK_CAMERA, 1f, false, false);
                discoverCameraCapabilities();
                if (selected != null && "WIDE".equals(selected.framing)) selectWidePreset();
                shutter.setEnabled(BuildConfig.FIELD_SYNC_ENABLED);
                updateCounter();
                updateCameraUi();
            } catch (Exception e) {
                cameraStatus.setText("Camera unavailable. Your saved photos are protected.");
            }
        }, androidx.core.content.ContextCompat.getMainExecutor(this));
    }

    private void buildCameraUi() {
        boolean landscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        cameraRoot = new FrameLayout(this);
        cameraRoot.setBackgroundColor(Color.BLACK);
        previewView = new PreviewView(this);
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        cameraRoot.addView(previewView, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(10), dp(6), dp(10), dp(6));
        top.setBackgroundColor(Color.argb(165, 0, 0, 0));
        PhotoRequirements.Item selected = requirements.enabledItem(item);
        LinearLayout itemBlock = new LinearLayout(this);
        itemBlock.setOrientation(LinearLayout.VERTICAL);
        TextView title = cameraText(selected == null ? "Extra photos" : selected.label, 15, true);
        itemBlock.addView(title);
        if (selected != null && !selected.instruction.isEmpty()) itemBlock.addView(cameraText(selected.instruction, 12, false));
        top.addView(itemBlock, new LinearLayout.LayoutParams(0, -2, 1));
        flashButton = compactButton("Flash Auto");
        flashButton.setText(flash == ImageCapture.FLASH_MODE_AUTO ? "Flash Auto" : flash == ImageCapture.FLASH_MODE_ON ? "Flash On" : "Flash Off");
        flashButton.setOnClickListener(v -> cycleFlash());
        top.addView(flashButton);
        torchButton = compactButton(torch ? "Torch On" : "Torch Off");
        torchButton.setOnClickListener(v -> toggleTorch());
        LinearLayout.LayoutParams torchParams = new LinearLayout.LayoutParams(-2, -2);
        torchParams.leftMargin = dp(6);
        top.addView(torchButton, torchParams);
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(-1, -2, Gravity.TOP);
        if (landscape) topParams.rightMargin = dp(116);
        cameraRoot.addView(top, topParams);
        cameraStatus = cameraText("Starting camera…", 14, false);
        cameraStatus.setGravity(Gravity.CENTER);
        cameraStatus.setPadding(dp(10), dp(5), dp(10), dp(5));
        cameraStatus.setBackground(rounded(Color.argb(130, 0, 0, 0), 18));
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        statusParams.topMargin = dp(60);
        if (landscape) statusParams.rightMargin = dp(116);
        cameraRoot.addView(cameraStatus, statusParams);
        buildZoomSlider(landscape);
        if (landscape) buildLandscapeControls(); else buildPortraitControls();
        cameraRoot.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(cameraRoot);
        zoomGestureDetector = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector detector) { return applyPinchZoom(detector.getScaleFactor()); }
        });
        previewView.setOnTouchListener((view, event) -> zoomGestureDetector != null && zoomGestureDetector.onTouchEvent(event));
    }

    private void buildZoomSlider(boolean landscape) {
        zoomSliderPanel = new LinearLayout(this);
        zoomSliderPanel.setOrientation(LinearLayout.VERTICAL);
        zoomSliderPanel.setPadding(dp(14), dp(8), dp(14), dp(8));
        zoomSliderPanel.setBackground(rounded(Color.argb(190, 0, 0, 0), 18));
        zoomSliderPanel.setVisibility(View.GONE);
        zoomText = cameraText("Zoom 1×", 15, false);
        zoomText.setGravity(Gravity.CENTER);
        zoomSliderPanel.addView(zoomText, new LinearLayout.LayoutParams(-1, -2));
        zoomSlider = new SeekBar(this);
        zoomSlider.setMax(ZOOM_SLIDER_STEPS);
        zoomSlider.setContentDescription("Camera zoom slider");
        zoomSlider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (fromUser && !updatingZoomSlider && camera != null) {
                    camera.getCameraControl().setLinearZoom(progress / (float) ZOOM_SLIDER_STEPS);
                    showZoomSlider();
                }
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { zoomSliderTracking = true; handler.removeCallbacks(hideZoomSliderRunnable); }
            @Override public void onStopTrackingTouch(SeekBar bar) { zoomSliderTracking = false; scheduleZoomSliderHide(); }
        });
        zoomSliderPanel.addView(zoomSlider, new LinearLayout.LayoutParams(-1, -2));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(landscape ? dp(320) : -1, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        params.setMargins(dp(16), 0, landscape ? dp(132) : dp(16), dp(landscape ? 16 : 142));
        cameraRoot.addView(zoomSliderPanel, params);
    }

    private void buildPortraitControls() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(10), dp(7), dp(10), dp(8));
        panel.setBackgroundColor(Color.argb(175, 0, 0, 0));
        panel.addView(makeZoomPresets(false), new LinearLayout.LayoutParams(-1, -2));
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        done = cameraButton("Done");
        done.setOnClickListener(v -> { if (!busy) showItems(); });
        actions.addView(done, new LinearLayout.LayoutParams(0, dp(56), 1));
        shutter = makeShutter();
        LinearLayout.LayoutParams shutterParams = new LinearLayout.LayoutParams(dp(72), dp(72));
        shutterParams.setMargins(dp(8), 0, dp(8), 0);
        actions.addView(shutter, shutterParams);
        counter = cameraText("0 saved", 13, false);
        counter.setGravity(Gravity.CENTER);
        actions.addView(counter, new LinearLayout.LayoutParams(0, dp(56), 1));
        panel.addView(actions, new LinearLayout.LayoutParams(-1, -2));
        cameraRoot.addView(panel, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
    }

    private void buildLandscapeControls() {
        LinearLayout rail = new LinearLayout(this);
        rail.setOrientation(LinearLayout.VERTICAL);
        rail.setGravity(Gravity.CENTER_HORIZONTAL);
        rail.setPadding(dp(7), dp(7), dp(7), dp(7));
        rail.setBackgroundColor(Color.argb(180, 0, 0, 0));
        rail.addView(makeZoomPresets(true), new LinearLayout.LayoutParams(-1, 0, 1));
        shutter = makeShutter();
        rail.addView(shutter, new LinearLayout.LayoutParams(dp(68), dp(68)));
        done = cameraButton("Done");
        done.setOnClickListener(v -> { if (!busy) showItems(); });
        LinearLayout.LayoutParams doneParams = new LinearLayout.LayoutParams(-1, dp(46));
        doneParams.topMargin = dp(6);
        rail.addView(done, doneParams);
        counter = cameraText("0 saved", 12, false);
        counter.setGravity(Gravity.CENTER);
        rail.addView(counter, new LinearLayout.LayoutParams(-1, -2));
        cameraRoot.addView(rail, new FrameLayout.LayoutParams(dp(112), -1, Gravity.RIGHT));
    }

    private LinearLayout makeZoomPresets(boolean vertical) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(vertical ? LinearLayout.VERTICAL : LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        wideButton = cameraButton("Wide");
        wideButton.setOnClickListener(v -> selectWidePreset());
        oneXButton = cameraButton("1×");
        oneXButton.setOnClickListener(v -> selectDefaultPreset(1f));
        threeXButton = cameraButton("3×");
        threeXButton.setOnClickListener(v -> selectDefaultPreset(3f));
        row.addView(wideButton, new LinearLayout.LayoutParams(-2, dp(40)));
        LinearLayout.LayoutParams margin1 = new LinearLayout.LayoutParams(-2, dp(40));
        if (vertical) margin1.topMargin = dp(5); else margin1.leftMargin = dp(7);
        row.addView(oneXButton, margin1);
        LinearLayout.LayoutParams margin3 = new LinearLayout.LayoutParams(-2, dp(40));
        if (vertical) margin3.topMargin = dp(5); else margin3.leftMargin = dp(7);
        row.addView(threeXButton, margin3);
        return row;
    }

    private Button compactButton(String label) {
        Button b = cameraButton(label);
        b.setTextSize(12);
        b.setMinHeight(dp(38));
        b.setPadding(dp(8), 0, dp(8), 0);
        return b;
    }
    private Button cameraButton(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(13);
        b.setAllCaps(false);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setMinHeight(dp(38));
        b.setMinimumHeight(0);
        b.setPadding(dp(9), 0, dp(9), 0);
        b.setBackground(rounded(Color.argb(180, 38, 38, 38), 20));
        return b;
    }
    private Button makeShutter() {
        Button b = new Button(this);
        b.setText("");
        b.setContentDescription("Take photo");
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(Color.WHITE);
        d.setStroke(dp(4), Color.LTGRAY);
        b.setBackground(d);
        b.setOnClickListener(v -> take());
        b.setEnabled(false);
        return b;
    }
    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        return d;
    }
    private TextView cameraText(String text, int size, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.WHITE);
        t.setTextSize(size);
        if (bold) t.setTypeface(null, android.graphics.Typeface.BOLD);
        return t;
    }

    private void bindCamera(CameraSelector selector, float intrinsicRatio, boolean physicalWide, boolean discover) throws Exception {
        if (provider == null) throw new IllegalStateException("Camera provider is not ready.");
        if (camera != null && torch) {
            try { camera.getCameraControl().enableTorch(false); } catch (RuntimeException ignored) { }
        }
        torch = false;
        int rotation = getWindowManager().getDefaultDisplay().getRotation();
        Preview usePreview = new Preview.Builder().build();
        ImageCapture useCapture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).setFlashMode(flash).build();
        usePreview.setTargetRotation(rotation);
        useCapture.setTargetRotation(rotation);
        usePreview.setSurfaceProvider(previewView.getSurfaceProvider());
        provider.unbindAll();
        Camera bound = provider.bindToLifecycle(this, selector, usePreview, useCapture);
        cameraPreview = usePreview;
        camera = bound;
        capture = useCapture;
        activePhysicalWide = physicalWide;
        activeIntrinsicRatio = validRatio(intrinsicRatio);
        bound.getCameraInfo().getZoomState().observe(this, state -> {
            if (camera != bound || state == null) return;
            zoomState = state;
            if (!activePhysicalWide) {
                logicalWideRatio = state.getMinZoomRatio();
                logicalWideAvailable = CameraLensMath.isUltraWide(logicalWideRatio);
                threeXAvailable = state.getMaxZoomRatio() >= 2.95f;
            }
            updateZoomControls();
        });
        if (discover) discoverCameraCapabilities();
        cameraStatus.setText("Ready. Take a photo or choose another view.");
        updateCameraUi();
    }

    private void discoverCameraCapabilities() {
        logicalWideAvailable = false;
        physicalWideSelector = null;
        physicalWideRatio = 1f;
        if (camera == null) return;
        ZoomState state = camera.getCameraInfo().getZoomState().getValue();
        if (state != null) {
            logicalWideRatio = state.getMinZoomRatio();
            logicalWideAvailable = CameraLensMath.isUltraWide(logicalWideRatio);
            threeXAvailable = state.getMaxZoomRatio() >= 2.95f;
        }
        if (logicalWideAvailable || physicalWideSuppressed) return;
        CameraInfo best = null;
        float bestRatio = 1f;
        try {
            for (CameraInfo info : camera.getCameraInfo().getPhysicalCameraInfos()) {
                float ratio = intrinsicRatio(info);
                if (isBackCamera(info) && CameraLensMath.isUltraWide(ratio) && (best == null || ratio < bestRatio)) {
                    best = info;
                    bestRatio = ratio;
                }
            }
        } catch (RuntimeException ignored) { }
        if (best == null && provider != null) {
            try {
                for (CameraInfo info : provider.getAvailableCameraInfos()) {
                    float ratio = intrinsicRatio(info);
                    if (isBackCamera(info) && CameraLensMath.isUltraWide(ratio) && (best == null || ratio < bestRatio)) {
                        best = info;
                        bestRatio = ratio;
                    }
                }
            } catch (RuntimeException ignored) { }
        }
        if (best != null) {
            try { physicalWideSelector = best.getCameraSelector(); physicalWideRatio = bestRatio; }
            catch (RuntimeException ignored) { physicalWideSelector = null; physicalWideRatio = 1f; }
        }
        updateCameraUi();
    }

    private boolean isBackCamera(CameraInfo info) {
        try { return info.getLensFacing() == CameraSelector.LENS_FACING_BACK; }
        catch (RuntimeException error) { return false; }
    }
    private float intrinsicRatio(CameraInfo info) {
        try { float value = info.getIntrinsicZoomRatio(); return validRatio(value); }
        catch (RuntimeException error) { return 1f; }
    }
    private float validRatio(float value) { return value > 0f && !Float.isNaN(value) && !Float.isInfinite(value) ? value : 1f; }

    private void selectWidePreset() {
        if (!BuildConfig.FIELD_SYNC_ENABLED || busy || camera == null) return;
        showZoomSlider();
        if (logicalWideAvailable) {
            if (activePhysicalWide) bindDefaultAt(logicalWideRatio);
            else camera.getCameraControl().setZoomRatio(logicalWideRatio);
            return;
        }
        if (physicalWideSelector == null || physicalWideSuppressed) {
            cameraStatus.setText("Wide lens unavailable to this app. Use 1× and stand farther back.");
            return;
        }
        try {
            bindCamera(physicalWideSelector, physicalWideRatio, true, false);
            cameraStatus.setText("Wide camera " + formatRatio(physicalWideRatio) + ".");
        } catch (Exception error) {
            physicalWideSuppressed = true;
            physicalWideSelector = null;
            cameraStatus.setText("Wide camera could not open. Normal camera restored.");
            bindDefaultAt(1f);
        }
    }
    private void bindDefaultAt(float ratio) {
        try {
            bindCamera(CameraSelector.DEFAULT_BACK_CAMERA, 1f, false, true);
            ZoomState state = camera == null ? null : camera.getCameraInfo().getZoomState().getValue();
            if (state != null) camera.getCameraControl().setZoomRatio(Math.max(state.getMinZoomRatio(), Math.min(state.getMaxZoomRatio(), ratio)));
        }
        catch (Exception error) { cameraStatus.setText("Normal camera could not open."); }
    }
    private void selectDefaultPreset(float ratio) {
        if (!BuildConfig.FIELD_SYNC_ENABLED || busy || camera == null) return;
        if (activePhysicalWide) { bindDefaultAt(ratio); return; }
        ZoomState state = camera.getCameraInfo().getZoomState().getValue();
        if (state != null) camera.getCameraControl().setZoomRatio(Math.max(state.getMinZoomRatio(), Math.min(state.getMaxZoomRatio(), ratio)));
        showZoomSlider();
    }

    private boolean applyPinchZoom(float scale) {
        if (!BuildConfig.FIELD_SYNC_ENABLED || busy || camera == null) return false;
        ZoomState state = camera.getCameraInfo().getZoomState().getValue();
        if (state == null) return false;
        float next = Math.max(state.getMinZoomRatio(), Math.min(state.getMaxZoomRatio(), state.getZoomRatio() * scale));
        camera.getCameraControl().setZoomRatio(next);
        showZoomSlider();
        return true;
    }
    private void updateZoomControls() {
        if (zoomState == null || zoomText == null) return;
        float effective = CameraLensMath.effectiveRatio(activeIntrinsicRatio, zoomState.getZoomRatio());
        zoomText.setText("Zoom " + formatRatio(effective));
        updatingZoomSlider = true;
        zoomSlider.setProgress(Math.round(zoomState.getLinearZoom() * ZOOM_SLIDER_STEPS));
        updatingZoomSlider = false;
        updateCameraUi();
    }
    private void updateCameraUi() {
        if (shutter == null) return;
        boolean enabled = BuildConfig.FIELD_SYNC_ENABLED && camera != null && !busy;
        shutter.setEnabled(enabled);
        if (done != null) done.setEnabled(!busy);
        boolean hasFlash = camera != null && camera.getCameraInfo().hasFlashUnit();
        if (flashButton != null) {
            flashButton.setText(!hasFlash ? "Flash —" : flash == ImageCapture.FLASH_MODE_AUTO ? "Flash Auto" : flash == ImageCapture.FLASH_MODE_ON ? "Flash On" : "Flash Off");
            flashButton.setEnabled(hasFlash && !busy);
        }
        if (torchButton != null) {
            torchButton.setText(!hasFlash ? "Torch —" : torch ? "Torch On" : "Torch Off");
            torchButton.setEnabled(hasFlash && !busy);
        }
        if (wideButton != null) {
            boolean available = logicalWideAvailable || (physicalWideSelector != null && !physicalWideSuppressed);
            wideButton.setVisibility(available ? View.VISIBLE : View.GONE);
            if (available) wideButton.setText(formatRatio(logicalWideAvailable ? logicalWideRatio : physicalWideRatio));
        }
        if (oneXButton != null) oneXButton.setEnabled(camera != null && !busy);
        if (threeXButton != null) {
            threeXButton.setVisibility(threeXAvailable ? View.VISIBLE : View.GONE);
            threeXButton.setEnabled(threeXAvailable && camera != null && !busy);
        }
    }
    private String formatRatio(float ratio) {
        if (Math.abs(ratio - Math.round(ratio)) < 0.04f) return Math.round(ratio) + "×";
        return String.format(Locale.US, "%.1f×", ratio);
    }
    private void showZoomSlider() {
        if (zoomSliderPanel == null) return;
        zoomSliderPanel.setVisibility(View.VISIBLE);
        scheduleZoomSliderHide();
    }
    private void scheduleZoomSliderHide() {
        if (zoomSliderPanel == null || zoomSliderTracking) return;
        handler.removeCallbacks(hideZoomSliderRunnable);
        handler.postDelayed(hideZoomSliderRunnable, ZOOM_SLIDER_HIDE_DELAY_MS);
    }
    private void cycleFlash() {
        if (capture == null || camera == null || !camera.getCameraInfo().hasFlashUnit() || busy) return;
        flash = flash == ImageCapture.FLASH_MODE_AUTO ? ImageCapture.FLASH_MODE_ON : flash == ImageCapture.FLASH_MODE_ON ? ImageCapture.FLASH_MODE_OFF : ImageCapture.FLASH_MODE_AUTO;
        capture.setFlashMode(flash);
        flashButton.setText(flash == ImageCapture.FLASH_MODE_AUTO ? "Flash Auto" : flash == ImageCapture.FLASH_MODE_ON ? "Flash On" : "Flash Off");
    }
    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit() || busy) return;
        torch = !torch;
        camera.getCameraControl().enableTorch(torch);
        torchButton.setText(torch ? "Torch On" : "Torch Off");
    }

    private void take() {
        if (busy || capture == null || !current() || !BuildConfig.FIELD_SYNC_ENABLED) return;
        busy = true;
        updateCameraUi();
        ImageCapture owner = capture;
        runtime.photos.io.execute(() -> {
            try {
                ProtectedPhoto p = runtime.photos.reserve(session, generation, wo, run, item);
                runOnUiThread(() -> {
                    if (!current() || !cameraScreen || capture != owner) { runtime.photos.io.execute(() -> runtime.photos.captured(p.id)); return; }
                    owner.setTargetRotation(getWindowManager().getDefaultDisplay().getRotation());
                    try {
                        owner.takePicture(new ImageCapture.OutputFileOptions.Builder(new File(p.originalPath)).build(), androidx.core.content.ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
                            @Override public void onImageSaved(@NonNull ImageCapture.OutputFileResults result) { saved(p.id); }
                            @Override public void onError(@NonNull ImageCaptureException error) { saved(p.id); }
                        });
                    } catch (RuntimeException e) { saved(p.id); }
                });
            } catch (Exception e) {
                ui(() -> { busy = false; cameraStatus.setText(e.getMessage()); updateCameraUi(); });
            }
        });
    }
    private void saved(String id) {
        runtime.photos.io.execute(() -> {
            runtime.photos.captured(id);
            ProtectedPhoto p = runtime.dao.photo(id);
            ui(() -> {
                busy = false;
                if (cameraScreen) {
                    cameraStatus.setText(p != null && p.readable() ? "Saved. Take another photo or tap Done." : "Photo did not save correctly. Check saved photos.");
                    updateCounter();
                    updateCameraUi();
                }
            });
        });
    }
    private void updateCounter() {
        runtime.photos.io.execute(() -> {
            int n = 0;
            for (ProtectedPhoto p : runtime.dao.photos(session.userId, session.organizationId, wo, run)) if (p.readable() && p.itemId.equals(item)) n++;
            int count = n;
            ui(() -> {
                if (cameraScreen && counter != null) {
                    PhotoRequirements.Item selected = requirements.enabledItem(item);
                    counter.setText(selected == null ? count + " saved" : count + "/" + selected.minimum + " saved");
                }
            });
        });
    }
    @Override public void onRequestPermissionsResult(int request, @NonNull String[] permissions, @NonNull int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == 8 && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) openCamera();
        else message.setText("Camera permission is needed to take photos. Saved photos remain protected.");
    }
}
