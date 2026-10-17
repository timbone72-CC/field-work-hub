package com.inandout.fieldphotoprep.team.internal;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.*;
import java.io.OutputStream;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Owner-scoped, bounded local evidence selection; exports through the existing PhotoOwner. */
public final class PhotoRecoveryActivity extends Activity {
    private static final int CREATE_ARCHIVE = 71;
    private TeamRuntime runtime;
    private SupabaseApi.AuthSession owner;
    private long generation;
    private int offset;
    private TextView status;
    private LinearLayout rows;
    private Button previous, next, export, cancel;
    private final Set<String> selected = new LinkedHashSet<>();
    private ArrayList<String> pending;
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private boolean busy;
    private boolean exporting;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        runtime = TeamRuntime.get(this); owner = runtime.sessions.load();
        generation = runtime.sessions.generation();
        if (owner == null) { finish(); return; }
        if (saved != null) {
            if (!owner.userId.equals(saved.getString("owner"))
                    || !owner.organizationId.equals(saved.getString("org"))
                    || generation != saved.getLong("generation")) { finish(); return; }
            offset = saved.getInt("offset", 0);
            pending = saved.getStringArrayList("pending");
        }
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        content.setBackgroundColor(FwhVisualStyle.CANVAS);
        int pad = (int)(20 * getResources().getDisplayMetrics().density); content.setPadding(pad,pad,pad,pad);
        TextView title = new TextView(this); title.setText("Recover my photos"); title.setTextSize(24);
        FwhVisualStyle.heading(title); title.setPadding(0, 0, 0, pad / 2); content.addView(title);
        status = new TextView(this);
        status.setText("Copy protected originals from this phone. This does not finish or deliver work. Choose up to 25 photos per export; save the ZIP to a location you control.");
        FwhVisualStyle.body(status); status.setTextSize(14); status.setPadding(0, 0, 0, pad / 2); content.addView(status);
        rows = new LinearLayout(this); rows.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this); scroll.addView(rows);
        content.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        previous = button(content,"Previous photos",()->{offset=Math.max(0,offset-25);load();});
        next = button(content,"Next photos",()->{offset+=25;load();});
        export = button(content,"Export selected originals",this::chooseDestination);
        cancel = button(content,"Cancel export",()->cancelled.set(true)); cancel.setVisibility(android.view.View.GONE);
        button(content,"Back",this::finish);
        setContentView(content); load();
    }
    private Button button(LinearLayout parent,String label,Runnable action) {
        Button b=new Button(this);
        b.setText(label);
        FwhVisualStyle.button(b, "Export selected originals".equals(label));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = FwhVisualStyle.dp(this, 6);
        b.setOnClickListener(v->action.run());
        parent.addView(b, params);
        return b;
    }
    private boolean current() { return runtime.sessions.matches(generation,owner.userId,owner.organizationId); }
    private void load() {
        if (!current()) { finish(); return; }
        selected.clear(); rows.removeAllViews(); setBusy(true);
        runtime.photos.io.execute(()->{
            try {
                List<ProtectedPhoto> page=runtime.sessions.local(generation,owner,
                    ()->runtime.dao.recoveryPhotos(owner.userId,owner.organizationId,26,offset));
                Map<String,String> labels=new HashMap<>();
                for(ProtectedPhoto p:page) {
                    CachedWorkOrder work=runtime.dao.find(owner.userId,owner.organizationId,p.workOrderId,p.runId);
                    labels.put(p.id,work==null?"Retained photo":work.woNumber+" — "+work.propertyAddress);
                }
                runOnUiThread(()->{
                    if (!current() || isFinishing() || isDestroyed()) return;
                    setBusy(false); previous.setEnabled(offset>0); next.setEnabled(page.size()>25);
                    for(ProtectedPhoto p:page.subList(0,Math.min(25,page.size()))) {
                        CheckBox row=new CheckBox(this);
                        row.setText(labels.get(p.id)+"\n"+p.capturedAt+" · Photo "+p.id.substring(0,8)
                                + ("PROBLEM".equals(p.state)?"\nOriginal may need recovery; copied as stored.":""));
                        row.setTextColor(FwhVisualStyle.INK);
                        row.setTextSize(14);
                        row.setPadding(FwhVisualStyle.dp(this, 10), FwhVisualStyle.dp(this, 10),
                                FwhVisualStyle.dp(this, 10), FwhVisualStyle.dp(this, 10));
                        FwhVisualStyle.panel(row);
                        LinearLayout.LayoutParams photoParams = new LinearLayout.LayoutParams(-1, -2);
                        photoParams.bottomMargin = FwhVisualStyle.dp(this, 8);
                        row.setOnCheckedChangeListener((button,checked)->{
                            if(checked)selected.add(p.id);else selected.remove(p.id);
                            export.setEnabled(!selected.isEmpty()&&!busy&&pending==null);
                        }); rows.addView(row, photoParams);
                    }
                    if(page.isEmpty())status.setText("No retained originals on this page. Cloud recovery is separate; unsynchronized photos can only be recovered from their original phone.");
                    if(pending!=null||exporting)setBusy(true);
                });
            } catch(Exception e) { runOnUiThread(()->{if(current()){setBusy(false);status.setText("Unable to list originals. Photos remain protected.");}}); }
        });
    }
    private void chooseDestination() {
        if(!current() || selected.isEmpty() || busy || pending!=null)return;
        pending=new ArrayList<>(selected); setBusy(true);
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/zip").putExtra(Intent.EXTRA_TITLE,"FWH-recovery-"+UUID.randomUUID()+".zip");
        try { startActivityForResult(intent,CREATE_ARCHIVE); }
        catch(Exception e){pending=null;setBusy(false);status.setText("No file picker is available. Originals remain protected.");}
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request!=CREATE_ARCHIVE)return;
        if(pending==null || !current()){pending=null;setBusy(false);return;}
        if(result!=RESULT_OK || data==null || data.getData()==null){pending=null;setBusy(false);status.setText("Export cancelled. Originals remain protected.");return;}
        Uri target=data.getData(); ArrayList<String> ids=pending;pending=null;cancelled.set(false);exporting=true;setBusy(true);
        cancel.setVisibility(android.view.View.VISIBLE);status.setText("Copying originals… Keep this screen open.");
        runtime.photos.io.execute(()->{
            boolean success=false;
            try {
                if(!current())throw new SessionCoordinator.SessionChanged();
                try(OutputStream out=getContentResolver().openOutputStream(target,"w")) {
                    if(out==null)throw new java.io.IOException("Destination unavailable");
                    OutputStream guarded=new java.io.FilterOutputStream(out){
                        @Override public void write(int b)throws java.io.IOException {write(new byte[]{(byte)b},0,1);}
                        @Override public void write(byte[] b,int off,int len)throws java.io.IOException {
                            if(cancelled.get())throw new java.io.InterruptedIOException();out.write(b,off,len);
                        }
                    };
                    runtime.photos.exportOriginals(owner,generation,ids,guarded);
                }
                success=current()&&!cancelled.get();
            } catch(Exception e) { /* No paths, tokens, or photo bytes in logs. */ }
            final boolean complete=success;
            runOnUiThread(()->{
                if(!current()||isFinishing()||isDestroyed())return;
                exporting=false;setBusy(false);cancel.setVisibility(android.view.View.GONE);
                status.setText(complete?"Export saved. Originals remain on this phone."
                        :"Export incomplete. The selected file may be partial; discard it and retry. Originals remain protected.");
            });
        });
    }
    private void setBusy(boolean value){busy=value;previous.setEnabled(!value&&offset>0);next.setEnabled(!value);export.setEnabled(!value&&!selected.isEmpty());rows.setEnabled(!value);
        for(int i=0;i<rows.getChildCount();i++)rows.getChildAt(i).setEnabled(!value);}
    @Override protected void onSaveInstanceState(Bundle out){
        super.onSaveInstanceState(out);if(owner==null)return;out.putString("owner",owner.userId);out.putString("org",owner.organizationId);
        out.putLong("generation",generation);out.putInt("offset",offset);if(pending!=null)out.putStringArrayList("pending",pending);
    }
    @Override protected void onDestroy(){cancelled.set(true);super.onDestroy();}
}
