package io.github.svennefenne.noterat;

import android.app.Application;

/**
 * Starts Firebase as the app's process starts, with the settings kept from the server, so a push that
 * arrives while the app isn't running can be shown (Firebase's own start-up finds no google-services
 * settings in the APK, on purpose: decision 12).
 */
public class NoteratApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        try {
            FirebaseSetup.start(this);
        } catch (RuntimeException e) {
            // (bad settings mustn't stop the app from opening; push simply stays off)
            android.util.Log.w("Noterat", "Firebase didn't start", e);
        }
    }
}
