package com.inandout.fieldphotoprep.team.internal;
import static org.junit.Assert.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.util.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=34)
public class PhotoRequirementsTest {
    static String id(int n){return String.format(Locale.ROOT,"00000000-0000-0000-0000-%012d",n);}
    static JSONObject configuration(int total,int... counts) throws Exception {
        JSONArray items=new JSONArray();for(int n=0;n<counts.length;n++)items.put(new JSONObject().put("id",id(n+2)).put("label","Item "+n)
                .put("enabled",true).put("minimum",counts[n]).put("instruction","").put("stage","NONE").put("framing","NORMAL").put("order",n));
        return new JSONObject().put("schema",1).put("revision",id(1)).put("total",new JSONObject().put("enabled",total>0).put("minimum",total)).put("items",items);
    }
    @Test public void independentTotalUsesMaximumWithoutAddingItemPositionsTwice() throws Exception {
        PhotoRequirements r=PhotoRequirements.parse(configuration(30,5,5,8,8).toString());assertEquals(30,r.minimumUnique);assertTrue(r.summary().contains("4 additional"));
        assertEquals(40,PhotoRequirements.parse(configuration(30,10,10,10,10).toString()).minimumUnique);
    }
    @Test public void optionalRowsAndFreeDisplayOrderDoNotCreateObligations() throws Exception {
        JSONObject j=configuration(30,4,4);j.getJSONObject("total").put("enabled",false);
        j.getJSONArray("items").getJSONObject(0).put("enabled",false).put("order",9);
        j.getJSONArray("items").getJSONObject(1).put("enabled",false);
        PhotoRequirements r=PhotoRequirements.parse(j.toString());assertEquals(0,r.minimumUnique);assertEquals(2,r.items.size());assertEquals("",r.missing(List.of()));
    }
    @Test public void malformedUnknownDuplicateAndFractionalConfigurationFailsClosed() throws Exception {
        for(int kind=0;kind<5;kind++){
            JSONObject j=configuration(5,2,2);
            if(kind==0)j.put("schema",2);if(kind==1)j.getJSONArray("items").getJSONObject(0).put("minimum",1.5);
            if(kind==2)j.getJSONArray("items").getJSONObject(1).put("id",id(2));
            if(kind==3)j.getJSONArray("items").getJSONObject(1).put("label","ITEM 0");if(kind==4)j.put("walkingRequired",true);
            assertThrows(IllegalStateException.class,()->PhotoRequirements.parse(j.toString()));
        }
    }
    static ProtectedPhoto captured(String item) {
        return new ProtectedPhoto(UUID.randomUUID().toString(), "actor", "org", "wo", "run",
                "assignment", id(1), item, "2026-10-05T12:00:00Z", "original", "prepared");
    }
    @Test public void completedItemsStillExplainAdditionalPhotosNeededForTotal() throws Exception {
        PhotoRequirements r=PhotoRequirements.parse(configuration(8,2,2,2).toString());
        List<ProtectedPhoto> photos=new ArrayList<>();
        for(int n=2;n<=4;n++){photos.add(captured(id(n)));photos.add(captured(id(n)));}
        assertEquals("Total photos: 6/8 — 2 more photos needed.\nUse Extra photos or take more photos for any required item.",r.missing(photos));
        photos.add(captured(""));assertTrue(r.missing(photos).contains("1 more photo needed."));
        photos.add(captured(""));assertEquals("",r.missing(photos));
    }
    @Test public void missingItemIsNamedEvenWhenExtrasMeetTheTotal() throws Exception {
        PhotoRequirements r=PhotoRequirements.parse(configuration(2,2).toString());
        assertEquals("Item 0: 1/2 — 1 more photo needed.",r.missing(List.of(captured(id(2)),captured(""))));
    }

}
