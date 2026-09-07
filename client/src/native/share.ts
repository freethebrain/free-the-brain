/* Share target — text shared into the app from any other app. The native half is the in-repo
   ShareTargetPlugin (android/app/src/main/java/app/freethebrain/registry/ShareTargetPlugin.java);
   on the web the plugin resolves to nothing, so the widget simply never receives a share. */
import { registerPlugin, WebPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNative, quietly } from "./platform";

export interface SharedText {
  text: string | null;
  subject?: string | null;
}

interface ShareTargetPlugin {
  consume(): Promise<SharedText>;
  addListener(event: "received", cb: (data: SharedText) => void): Promise<PluginListenerHandle>;
}

class ShareTargetWeb extends WebPlugin implements ShareTargetPlugin {
  async consume(): Promise<SharedText> {
    return { text: null, subject: null };
  }
}

const ShareTarget = registerPlugin<ShareTargetPlugin>("ShareTarget", {
  web: () => new ShareTargetWeb(),
});

/** One line for a capture row: the subject when the body is a bare URL, otherwise the body, whitespace collapsed. */
export function shareToCaptureText(s: SharedText | null | undefined): string | null {
  if (!s || !s.text) return null;
  const body = s.text.replace(/\s+/g, " ").trim();
  if (!body) return null;
  const subject = (s.subject || "").replace(/\s+/g, " ").trim();
  if (subject && /^https?:\/\/\S+$/i.test(body) && subject !== body) return subject + " — " + body;
  return body;
}

/** The share the app was opened with, if any — call once at boot. Always null on the web. */
export async function consumeSharedText(): Promise<string | null> {
  if (!isNative()) return null;
  let out: string | null = null;
  await quietly(async () => {
    out = shareToCaptureText(await ShareTarget.consume());
  }, "consume shared text");
  return out;
}

/** Shares that arrive while the app is already running. No-op on the web. */
export function onSharedText(cb: (text: string) => void): void {
  if (!isNative()) return;
  void quietly(async () => {
    await ShareTarget.addListener("received", (data) => {
      const t = shareToCaptureText(data);
      if (t) cb(t);
    });
  }, "listen for shared text");
}
