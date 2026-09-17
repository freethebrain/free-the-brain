import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Owner-token mode: the mocked service answers 401 unless the request carries the owner bearer. The
   app must not fall back to the fixture; it must say "Open Settings and paste your owner token", and
   once the token is saved in Settings every request must carry it. Verified by computed style and by
   the headers the mock sees, never by class presence. */

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "fixture.json"), "utf8"));
const TOKEN = "owner-secret-for-e2e";
const KEY_TOKEN = "ftb.settings.ownerToken";
const KEY_BASE = "ftb.settings.apiBase";

const style = (page: Page, sel: string, prop: string) => page.locator(sel).evaluate((el, p) => getComputedStyle(el as Element).getPropertyValue(p), prop);

/** A service in owner-token mode: 401 without the right bearer, CORS answered for any origin the page uses. */
async function mockOwnerService(page: Page) {
  const seen: { path: string; method: string; authorization: string | undefined }[] = [];
  const cors = (origin: string | undefined) => ({
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, If-Match, X-Actor, X-Source, X-Human-Judgment",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  await page.route("**/api/v1/**", (route) => {
    const req = route.request();
    const headers = req.headers();
    const path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(headers.origin) });
    seen.push({ path, method: req.method(), authorization: headers.authorization });
    if (headers.authorization !== "Bearer " + TOKEN) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        headers: cors(headers.origin),
        body: JSON.stringify({ error: "unauthorized", detail: "this service is in owner-token mode (until Access)" }),
      });
    }
    if (path.endsWith("/registry")) return route.fulfill({ status: 200, contentType: "application/json", headers: cors(headers.origin), body: JSON.stringify(fixture) });
    if (path.endsWith("/judgments/text")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors(headers.origin), body: JSON.stringify({ applied: 1, rejected: [], delta_stamp: "2026-09-08-2100" }) });
    }
    return route.fulfill({ status: 404, headers: cors(headers.origin), body: "" });
  });
  return seen;
}

test("no token stored + 401: the notice asks for the owner token, Settings opens, no fixture is shown", async ({ page }) => {
  const seen = await mockOwnerService(page);
  await page.goto("/?src=api");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#notice")).toContainText("Open Settings and paste your owner token");
  expect(await style(page, "#notice", "display")).toBe("flex");
  // not the fixture: the provenance line says live and the portfolio is empty
  await expect(page.locator("#prov")).toContainText("live");
  await expect(page.locator("#prov")).not.toContainText("fixture");
  await expect(page.locator('.tab[data-tab="portfolio"] .n')).toHaveText("0");
  // the settings panel is open (computed style), with the token field empty
  expect(await style(page, "#settings", "display")).not.toBe("none");
  expect(await page.locator("#set-token").inputValue()).toBe("");
  expect(await page.locator("#set-token").getAttribute("type")).toBe("password");
  expect(seen.map((s) => s.authorization)).toEqual([undefined]);
});

test("saving the token in Settings reloads live and every request carries the bearer; the keys are stable", async ({ page }) => {
  const seen = await mockOwnerService(page);
  await page.goto("/?src=api");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await page.locator("#set-token").fill(TOKEN);
  await page.locator("#set-save").click();
  await expect(page.locator('.tab[data-tab="portfolio"] .n')).toHaveText("25");
  await expect(page.locator("#prov")).toContainText("live");
  expect(await style(page, "#settings", "display")).toBe("none");
  expect(await style(page, "#notice", "display")).toBe("none");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY_TOKEN)).toBe(TOKEN);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY_BASE)).toBeNull();

  // a judgment: the POST carries the same bearer
  await page.locator('.chead[data-cat="Art College"]').click();
  await page.locator('.done-t[data-done="T-103"]').click();
  await page.locator("#sendbtn").click();
  await expect(page.locator("#copystate")).toHaveText("Recorded 1 judgment · delta 2026-09-08-2100");
  const post = seen.find((s) => s.path.endsWith("/judgments/text"));
  expect(post?.authorization).toBe("Bearer " + TOKEN);
  // two unauthenticated loads (goto + reload), then the save's reload and the post-send reload with the bearer
  expect(seen.filter((s) => s.path.endsWith("/registry")).map((s) => s.authorization)).toEqual([undefined, undefined, "Bearer " + TOKEN, "Bearer " + TOKEN]);

  // and it survives a reload: straight to live, no notice
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator('.tab[data-tab="portfolio"] .n')).toHaveText("25");
  expect(await style(page, "#notice", "display")).toBe("none");
  expect(await style(page, "#settings", "display")).toBe("none");
});

test("a stored API base is used for every request and selects api mode even on localhost", async ({ page }) => {
  const seen = await mockOwnerService(page);
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/")) urls.push(r.url());
  });
  await page.goto("/?src=fixture");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(
    ([kb, kt, t]) => {
      localStorage.clear();
      localStorage.setItem(kb, "http://127.0.0.1:9797/");
      localStorage.setItem(kt, t);
    },
    [KEY_BASE, KEY_TOKEN, TOKEN],
  );
  await page.goto("/");
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#prov")).toContainText("live");
  await expect(page.locator('.tab[data-tab="portfolio"] .n')).toHaveText("25");
  expect(urls.filter((u) => !u.includes("OPTIONS"))).toContain("http://127.0.0.1:9797/api/v1/registry");
  expect(seen.map((s) => s.authorization)).toEqual(["Bearer " + TOKEN]);
  // the gear opens the panel showing the stored base
  await page.locator("#setbtn").click();
  expect(await style(page, "#settings", "display")).not.toBe("none");
  expect(await page.locator("#set-api").inputValue()).toBe("http://127.0.0.1:9797");
  await page.locator("#set-cancel").click();
  expect(await style(page, "#settings", "display")).toBe("none");
});

test("a wrong stored token: the notice says the token was refused and Settings opens", async ({ page }) => {
  await mockOwnerService(page);
  await page.goto("/?src=fixture");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(
    ([kt]) => {
      localStorage.clear();
      localStorage.setItem(kt, "stale-token");
    },
    [KEY_TOKEN],
  );
  await page.goto("/?src=api");
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#notice")).toContainText("refused the stored owner token");
  await expect(page.locator("#notice")).toContainText("Open Settings and paste your owner token");
  expect(await style(page, "#settings", "display")).not.toBe("none");
});
