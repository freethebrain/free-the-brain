/* Settings — the API base URL and the owner token, kept in localStorage so the built app is
   runtime-configurable (the deploy bundle is built with VITE_API_BASE="" and pointed at the service
   from the Settings panel). The owner token is the service's "owner-token mode, until Access"
   credential (docs/api-contract.md § Auth); every API request carries it as a bearer.

   Keys are stable — change them and every installed instance forgets its service. */

export const SETTINGS_KEY_API_BASE = "ftb.settings.apiBase";
export const SETTINGS_KEY_OWNER_TOKEN = "ftb.settings.ownerToken";

export interface Settings {
  /** Base URL of the Registry Service, no trailing slash; "" = same origin. */
  apiBase: string;
  /** The owner bearer; "" = none stored. */
  ownerToken: string;
}

/** null = absent; undefined = storage is blocked in this viewer. */
function read(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) {
    /* storage blocked — the value lives for this page load only, via the in-memory copy below */
  }
}

/* In-memory copy, used only while localStorage is blocked, so what was typed this session still holds. */
let mem: Settings | null = null;

export function normaliseBase(s: string): string {
  return s.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

/** The stored settings. `apiBase` falls back to VITE_API_BASE when nothing is stored. */
export function getSettings(): Settings {
  const storedBase = read(SETTINGS_KEY_API_BASE);
  const storedToken = read(SETTINGS_KEY_OWNER_TOKEN);
  if ((storedBase === undefined || storedToken === undefined) && mem) return { ...mem };
  const envBase = (import.meta.env.VITE_API_BASE as string | undefined) || "";
  return {
    apiBase: normaliseBase(storedBase ? storedBase : envBase),
    ownerToken: (storedToken || "").trim(),
  };
}

/** True when the user has stored an API base of their own (as opposed to the build-time default). */
export function hasStoredApiBase(): boolean {
  return !!read(SETTINGS_KEY_API_BASE);
}

export function saveSettings(next: Settings): Settings {
  const clean: Settings = { apiBase: normaliseBase(next.apiBase), ownerToken: next.ownerToken.trim() };
  mem = clean;
  write(SETTINGS_KEY_API_BASE, clean.apiBase);
  write(SETTINGS_KEY_OWNER_TOKEN, clean.ownerToken);
  return clean;
}

export function hasOwnerToken(): boolean {
  return getSettings().ownerToken !== "";
}

/** The Authorization header for API requests, or nothing when no token is stored. */
export function authHeaders(): Record<string, string> {
  const t = getSettings().ownerToken;
  return t ? { Authorization: "Bearer " + t } : {};
}
