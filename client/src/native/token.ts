/* Token storage — a stub for the day the service issues a bearer token (v1 has none: Cloudflare
   Access fronts the API, ADR-1). Kept behind one tiny interface so the swap to a keystore-backed
   plugin is a one-file change.

   @capacitor/preferences is SharedPreferences on Android — private to the app and excluded from
   nothing; it is NOT hardware-backed secure storage. Good enough for a stub; when a real token
   exists, replace the implementation with a Keystore-backed plugin before shipping it. */
import { isNative, quietly } from "./platform";

const KEY = "ftb.token";

export async function getToken(): Promise<string | null> {
  if (!isNative()) return null;
  let out: string | null = null;
  await quietly(async () => {
    const { Preferences } = await import("@capacitor/preferences");
    out = (await Preferences.get({ key: KEY })).value;
  }, "read token");
  return out;
}

export async function setToken(value: string): Promise<void> {
  if (!isNative()) return;
  await quietly(async () => {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: KEY, value });
  }, "store token");
}

export async function clearToken(): Promise<void> {
  if (!isNative()) return;
  await quietly(async () => {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key: KEY });
  }, "clear token");
}
