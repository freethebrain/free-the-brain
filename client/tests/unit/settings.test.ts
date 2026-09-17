import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiBase, apiFetch, pickMode } from "../../src/data/loader";
import {
  SETTINGS_KEY_API_BASE,
  SETTINGS_KEY_OWNER_TOKEN,
  authHeaders,
  getSettings,
  hasOwnerToken,
  hasStoredApiBase,
  normaliseBase,
  saveSettings,
} from "../../src/persist/settings";

/* A minimal localStorage on the node global, so the module's storage path is what runs. */
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    keys: () => [...m.keys()],
  };
}

let store: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  store = fakeStorage();
  (globalThis as unknown as { localStorage: unknown }).localStorage = store;
});
afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe("settings — the stable localStorage keys", () => {
  it("uses the documented keys and nothing else", () => {
    saveSettings({ apiBase: "https://api.example.com/", ownerToken: " tok " });
    expect(store.keys().sort()).toEqual(["ftb.settings.apiBase", "ftb.settings.ownerToken"]);
    expect(SETTINGS_KEY_API_BASE).toBe("ftb.settings.apiBase");
    expect(SETTINGS_KEY_OWNER_TOKEN).toBe("ftb.settings.ownerToken");
    expect(store.getItem(SETTINGS_KEY_API_BASE)).toBe("https://api.example.com");
    expect(store.getItem(SETTINGS_KEY_OWNER_TOKEN)).toBe("tok");
  });
  it("normalises the base: trims, drops trailing slashes and a pasted /api/v1", () => {
    expect(normaliseBase("  https://x.dev/api/v1/ ")).toBe("https://x.dev");
    expect(normaliseBase("https://x.dev///")).toBe("https://x.dev");
    expect(normaliseBase("")).toBe("");
  });
  it("an empty value removes the key, so the build-time default applies again", () => {
    saveSettings({ apiBase: "https://x.dev", ownerToken: "t" });
    expect(hasStoredApiBase()).toBe(true);
    expect(hasOwnerToken()).toBe(true);
    saveSettings({ apiBase: "", ownerToken: "" });
    expect(store.keys()).toEqual([]);
    expect(hasStoredApiBase()).toBe(false);
    expect(hasOwnerToken()).toBe(false);
    expect(getSettings()).toEqual({ apiBase: "", ownerToken: "" });
  });
  it("authHeaders carries the token as a bearer, or nothing", () => {
    expect(authHeaders()).toEqual({});
    saveSettings({ apiBase: "", ownerToken: "secret" });
    expect(authHeaders()).toEqual({ Authorization: "Bearer secret" });
  });
  it("survives a blocked localStorage for the session", () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    saveSettings({ apiBase: "https://x.dev", ownerToken: "t" });
    expect(getSettings()).toEqual({ apiBase: "https://x.dev", ownerToken: "t" });
  });
});

describe("loader — settings drive the base URL, the mode and the bearer", () => {
  it("apiBase is the stored base and a stored base selects api mode even on localhost", () => {
    expect(apiBase()).toBe("");
    expect(pickMode({ search: "", hostname: "localhost" })).toBe("fixture");
    saveSettings({ apiBase: "https://x.dev", ownerToken: "" });
    expect(apiBase()).toBe("https://x.dev");
    expect(pickMode({ search: "", hostname: "localhost" })).toBe("api");
    expect(pickMode({ search: "?src=fixture", hostname: "localhost" })).toBe("fixture");
  });
  it("apiFetch targets the stored base with the bearer, credentials included, caller headers kept", async () => {
    saveSettings({ apiBase: "https://x.dev/", ownerToken: "secret" });
    const calls: { url: string; init: RequestInit }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    try {
      await apiFetch("/api/v1/registry", { headers: { Accept: "application/json" } });
    } finally {
      globalThis.fetch = orig;
    }
    expect(calls[0].url).toBe("https://x.dev/api/v1/registry");
    expect(calls[0].init.credentials).toBe("include");
    expect(calls[0].init.headers).toEqual({ Authorization: "Bearer secret", Accept: "application/json" });
  });
  it("apiFetch sends no Authorization header when no token is stored", async () => {
    const calls: RequestInit[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      calls.push(init);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    try {
      await apiFetch("/api/v1/health");
    } finally {
      globalThis.fetch = orig;
    }
    expect(calls[0].headers).toEqual({});
  });
});
