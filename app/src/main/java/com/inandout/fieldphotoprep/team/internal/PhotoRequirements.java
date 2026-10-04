package com.inandout.fieldphotoprep.team.internal;

import org.json.*;
import java.util.*;

/** Single item credit; independent total. Unknown configured snapshots fail closed. */
final class PhotoRequirements {
    static final class Item {
        final String id, label, instruction, stage, framing;
        final int minimum, order;
        final boolean enabled;
        Item(JSONObject j) throws JSONException {
            id = uuid(j.getString("id")); label = j.getString("label");
            instruction = j.getString("instruction"); stage = j.getString("stage"); framing = j.getString("framing");
            minimum = integer(j, "minimum", 1000); order = integer(j, "order", 999);
            enabled = bool(j, "enabled");
            keys(j, "id", "label", "instruction", "stage", "framing", "minimum", "order", "enabled");
            if (label.trim().isEmpty() || label.length() > 100 || label.trim().equalsIgnoreCase("Extra")
                    || instruction.length() > 400 || (enabled && minimum == 0)
                    || !Arrays.asList("NONE", "BEFORE", "DURING", "AFTER").contains(stage)
                    || !Arrays.asList("NORMAL", "WIDE", "CLOSEUP").contains(framing)) throw new JSONException("Invalid photo item");
        }
    }
    final String revision;
    final List<Item> items;
    final boolean totalEnabled;
    final int totalMinimum, specifiedMinimum, minimumUnique;
    final boolean configured;
    private PhotoRequirements(String json) throws JSONException {
        JSONObject j = new JSONObject(json);
        configured = j.length() != 0;
        if (!configured) { revision = ""; items = Collections.emptyList(); totalEnabled = false; totalMinimum = specifiedMinimum = minimumUnique = 0; return; }
        keys(j, "schema", "revision", "total", "items");
        if (integer(j, "schema", 1) != 1) throw new JSONException("Unsupported requirements version");
        revision = uuid(j.getString("revision"));
        JSONObject total = j.getJSONObject("total"); keys(total, "enabled", "minimum");
        totalEnabled = bool(total, "enabled"); totalMinimum = integer(total, "minimum", 5000);
        if (totalEnabled && totalMinimum == 0) throw new JSONException("Invalid total minimum");
        JSONArray rows = j.getJSONArray("items");
        if (rows.length() > 100) throw new JSONException("Too many photo items");
        List<Item> values = new ArrayList<>(); Set<String> ids = new HashSet<>(), labels = new HashSet<>(); int sum = 0;
        for (int n = 0; n < rows.length(); n++) {
            Item i = new Item(rows.getJSONObject(n));
            if (!ids.add(i.id) || !labels.add(i.label.trim().toLowerCase(Locale.ROOT))) throw new JSONException("Duplicate photo item");
            values.add(i); if (i.enabled) sum = Math.addExact(sum, i.minimum);
        }
        if (sum > 5000) throw new JSONException("Photo total exceeds limit");
        values.sort(Comparator.comparingInt(i -> i.order)); items = Collections.unmodifiableList(values);
        specifiedMinimum = sum; minimumUnique = Math.max(sum, totalEnabled ? totalMinimum : 0);
    }
    static PhotoRequirements parse(String json) {
        try { return new PhotoRequirements(json); }
        catch (Exception e) { throw new IllegalStateException("Photo requirements need review. Refresh Assignments or contact Admin.", e); }
    }
    Item enabledItem(String id) {
        for (Item i : items) if (i.enabled && i.id.equals(id)) return i;
        return null;
    }
    String missing(List<ProtectedPhoto> photos) {
        Map<String,Integer> counts = new HashMap<>(); int total = 0;
        for (ProtectedPhoto p : photos) {
            if (!p.itemId.isEmpty() && enabledItem(p.itemId) == null) return "A photo has an invalid requirement. Contact Admin.";
            total++; counts.merge(p.itemId, 1, Integer::sum);
        }
        List<String> missing = new ArrayList<>();
        for (Item i : items) if (i.enabled && counts.getOrDefault(i.id,0) < i.minimum)
            missing.add(i.label + ": " + counts.getOrDefault(i.id,0) + "/" + i.minimum);
        if (totalEnabled && total < totalMinimum) missing.add("Total photos: " + total + "/" + totalMinimum);
        return String.join("\n", missing);
    }
    String summary() {
        if (minimumUnique == 0) return "Photos optional. You can still take Extra photos.";
        int additional = Math.max(0, (totalEnabled ? totalMinimum : 0) - specifiedMinimum);
        return specifiedMinimum + " specified photos" + (additional > 0 ? " + at least " + additional + " additional" : "") + ". Minimum " + minimumUnique + " unique photos. Choose any order.";
    }
    static String uuid(String value) throws JSONException {
        try { String id = UUID.fromString(value).toString(); if (!id.equalsIgnoreCase(value)) throw new IllegalArgumentException(); return id; }
        catch (Exception e) { throw new JSONException("Invalid requirement UUID"); }
    }
    private static int integer(JSONObject j, String key, int max) throws JSONException {
        Object v = j.get(key); String raw = v.toString();
        if (!(v instanceof Number) || !raw.matches("0|[1-9][0-9]{0,3}")) throw new JSONException("Invalid whole number");
        int n = Integer.parseInt(raw); if (n > max) throw new JSONException("Count exceeds limit"); return n;
    }
    private static boolean bool(JSONObject j, String key) throws JSONException {
        Object v = j.get(key); if (!(v instanceof Boolean)) throw new JSONException("Invalid enabled flag"); return (Boolean)v;
    }
    private static void keys(JSONObject j, String... allowed) throws JSONException {
        Set<String> a = new HashSet<>(Arrays.asList(allowed));
        Iterator<String> keys = j.keys(); while(keys.hasNext()) if (!a.contains(keys.next())) throw new JSONException("Unsupported requirement field");
        if (j.length() != a.size()) throw new JSONException("Missing requirement field");
    }
}
