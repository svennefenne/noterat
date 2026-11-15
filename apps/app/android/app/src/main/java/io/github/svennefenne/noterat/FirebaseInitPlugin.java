package io.github.svennefenne.noterat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts Firebase with the settings the server hands out (decision 12): the household's own Firebase
 * project, not one built into the APK. They're kept, so the next start (and a push that wakes the app
 * when it isn't running) finds Firebase ready: NoteratApplication.
 */
@CapacitorPlugin(name = "FirebaseInit")
public class FirebaseInitPlugin extends Plugin {

    @PluginMethod
    public void initialize(PluginCall call) {
        String appId = call.getString("appId", "");
        String apiKey = call.getString("apiKey", "");
        String projectId = call.getString("projectId", "");
        String senderId = call.getString("senderId", "");
        if (appId.isEmpty() || apiKey.isEmpty() || projectId.isEmpty() || senderId.isEmpty()) {
            call.reject("missing Firebase settings");
            return;
        }
        boolean changed = FirebaseSetup.save(getContext(), appId, apiKey, projectId, senderId);
        boolean running = FirebaseSetup.start(getContext());
        JSObject result = new JSObject();
        // (another project already running in this process: it takes over at the next start)
        result.put("restart", changed && !running);
        call.resolve(result);
    }
}
