package app.freethebrain.registry;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ShareTarget — the inbound half of the share sheet.
 *
 * MainActivity carries an ACTION_SEND text/plain intent filter (AndroidManifest.xml), so "Share" from any
 * app opens Free the Brain with the text. BridgeActivity re-delivers the launch intent through
 * onNewIntent (BridgeActivity.load()), and singleTask launch mode routes later shares through the same
 * hook, so one override covers cold start and a running app alike.
 *
 * The text is held here until the web side consumes it: at boot it calls consume(); while running it
 * listens for "received". A received share is delivered exactly once, whichever path takes it, and the
 * activity's intent is neutralised afterwards so a configuration change cannot replay it.
 *
 * Why not the send-intent community plugin: it launches a second BridgeActivity — a second copy of the
 * whole web app that finishes on pause — which the client's localStorage-keyed pending store does not
 * expect (a capture typed there would not be restored by the main instance).
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private String pendingText = null;
    private String pendingSubject = null;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!take(intent)) {
            return;
        }
        if (hasListeners("received")) {
            JSObject data = payload();
            pendingText = null;
            pendingSubject = null;
            notifyListeners("received", data);
        }
        // otherwise it waits for consume()
    }

    /** Returns the pending share, if any, and forgets it: {@code {text: string|null, subject: string|null}}. */
    @PluginMethod
    public void consume(PluginCall call) {
        JSObject data = payload();
        pendingText = null;
        pendingSubject = null;
        call.resolve(data);
    }

    private JSObject payload() {
        JSObject ret = new JSObject();
        ret.put("text", pendingText);
        ret.put("subject", pendingSubject);
        return ret;
    }

    /** Reads a text/plain ACTION_SEND intent into the pending slot. True when something was taken. */
    private boolean take(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return false;
        }
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) {
            return false;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) {
            return false;
        }
        pendingText = text.trim();
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        pendingSubject = subject == null || subject.trim().isEmpty() ? null : subject.trim();
        // Never replay this share: a recreated activity would otherwise see it again via getIntent().
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_SUBJECT);
        return true;
    }
}
