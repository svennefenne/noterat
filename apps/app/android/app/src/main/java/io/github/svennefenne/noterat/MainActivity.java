package io.github.svennefenne.noterat;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Opened again from Recents after its process was killed, Android hands back the intent it was
        // first opened with: a widget's noterat://memos?record=1 would start another recording. Not then.
        Intent intent = getIntent();
        if (intent != null && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) intent.setData(null);
        // (our own plugins, from this app's code rather than npm, are registered by hand)
        registerPlugin(FirebaseInitPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
