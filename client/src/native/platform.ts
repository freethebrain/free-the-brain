/* The one question every native module asks: are we inside the Capacitor shell?
   On the plain web (PWA, dev server, tests) every adapter below is a no-op, so the web code never
   branches on platform itself — it calls the adapter and the adapter decides. */
import { Capacitor } from "@capacitor/core";

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function platform(): "web" | "android" | "ios" {
  try {
    return Capacitor.getPlatform() as "web" | "android" | "ios";
  } catch {
    return "web";
  }
}

/** Swallow a plugin failure: a missing native feature must never break the widget. */
export async function quietly(work: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await work();
  } catch (e) {
    if (typeof console !== "undefined") console.warn("[native] " + what + " failed:", (e as Error).message || e);
  }
}
