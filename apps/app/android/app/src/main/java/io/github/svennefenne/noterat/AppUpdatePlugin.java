package io.github.svennefenne.noterat;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The app's updates from its own server (decision 16): a newer APK is downloaded into the app's cache and
 * checked against the SHA-256 the server gave, then Android's installer is opened on it. Android always
 * asks before installing an app from outside a store, and the first time it asks for the right to.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private File dir() {
        return new File(getContext().getCacheDir(), "updates");
    }

    private File apk(int build) {
        return new File(dir(), "noterat-" + build + ".apk");
    }

    /** url, sha256, build: the APK in the cache, checked (one downloaded before is used again). */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String sha256 = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        int build = call.getInt("build", 0);
        if (!(url.startsWith("https://") || url.startsWith("http://")) || !sha256.matches("[0-9a-f]{64}") || build <= 0) {
            call.reject("not an update");
            return;
        }
        io.execute(() -> {
            File done = apk(build);
            try {
                if (done.isFile() && sha256.equals(sha256Of(done))) {
                    call.resolve(new JSObject());
                    return;
                }
                clean();
                if (!dir().mkdirs() && !dir().isDirectory()) throw new IOException("no room for it");
                File part = new File(dir(), "download.part");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(60000);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try {
                    if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
                    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            md.update(buf, 0, n);
                            out.write(buf, 0, n);
                        }
                    }
                } finally {
                    c.disconnect();
                }
                if (!sha256.equals(hex(md.digest()))) {
                    part.delete();
                    throw new IOException("the download isn't the one the server named");
                }
                if (!part.renameTo(done)) throw new IOException("couldn't keep the download");
                call.resolve(new JSObject());
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "the download failed");
            }
        });
    }

    /**
     * build: Android's installer on the downloaded APK. Without the right to install apps yet, Android's
     * setting for it opens instead ({allowed: false}); back from there, this is asked again.
     */
    @PluginMethod
    public void install(PluginCall call) {
        Context ctx = getContext();
        File f = apk(call.getInt("build", 0));
        if (!f.isFile()) {
            call.reject("not downloaded");
            return;
        }
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(allow);
            result.put("allowed", false);
            call.resolve(result);
            return;
        }
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
        result.put("allowed", true);
        call.resolve(result);
    }

    /** Downloads no longer needed (the app is up to date). */
    @PluginMethod
    public void clean(PluginCall call) {
        io.execute(() -> {
            clean();
            call.resolve();
        });
    }

    private void clean() {
        File[] old = dir().listFiles();
        if (old != null) for (File f : old) f.delete();
    }

    private static String sha256Of(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        return hex(md.digest());
    }

    private static String hex(byte[] bytes) {
        StringBuilder s = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) s.append(String.format(Locale.ROOT, "%02x", b));
        return s.toString();
    }
}
