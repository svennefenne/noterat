package io.github.svennefenne.noterat;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import java.util.List;

/** The Firebase settings from the server, kept on the phone, and Firebase started with them. */
final class FirebaseSetup {
    private static final String PREFS = "noterat.firebase";

    private FirebaseSetup() {}

    /** Keeps the settings; true if they're new or different. */
    static boolean save(Context context, String appId, String apiKey, String projectId, String senderId) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean same = appId.equals(p.getString("appId", "")) && apiKey.equals(p.getString("apiKey", "")) && projectId.equals(p.getString("projectId", "")) && senderId.equals(p.getString("senderId", ""));
        if (!same) {
            p.edit().putString("appId", appId).putString("apiKey", apiKey).putString("projectId", projectId).putString("senderId", senderId).apply();
        }
        return !same;
    }

    /**
     * Starts Firebase with the kept settings, if there are any and it isn't running yet. True if it runs
     * with them now (false: no settings, or it was already running with others).
     */
    static boolean start(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String appId = p.getString("appId", "");
        if (appId.isEmpty()) return false;
        List<FirebaseApp> apps = FirebaseApp.getApps(context);
        if (!apps.isEmpty()) return appId.equals(FirebaseApp.getInstance().getOptions().getApplicationId());
        FirebaseOptions options = new FirebaseOptions.Builder()
            .setApplicationId(appId)
            .setApiKey(p.getString("apiKey", ""))
            .setProjectId(p.getString("projectId", ""))
            .setGcmSenderId(p.getString("senderId", ""))
            .build();
        FirebaseApp.initializeApp(context, options);
        return true;
    }
}
