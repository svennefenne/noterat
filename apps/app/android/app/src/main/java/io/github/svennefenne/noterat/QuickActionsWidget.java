package io.github.svennefenne.noterat;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * The quick-actions widget: four buttons into the app (a new voice memo, the scanner, a new note, the
 * lists), each opening a noterat:// link that the app follows (src/lib/deepLinks.ts), as the launcher's
 * shortcuts do. It shows nothing from the app, so nothing private is on the home screen and there's
 * nothing to keep up to date: its buttons are only set when it's placed (and when the system asks again).
 */
public class QuickActionsWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_actions);
        views.setOnClickPendingIntent(R.id.quick_memo, open(context, "noterat://memos?record=1"));
        views.setOnClickPendingIntent(R.id.quick_scan, open(context, "noterat://scans?scan=1"));
        views.setOnClickPendingIntent(R.id.quick_note, open(context, "noterat://notes?new=1"));
        views.setOnClickPendingIntent(R.id.quick_lists, open(context, "noterat://lists"));
        manager.updateAppWidget(widgetIds, views);
    }

    /** The app, opened at a link. (MainActivity is singleTask: an app that's running gets the link.) */
    private static PendingIntent open(Context context, String link) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // (one request code will do: the links differ, so each button still gets a PendingIntent of its own)
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
