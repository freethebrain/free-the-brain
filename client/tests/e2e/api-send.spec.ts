import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* The api data mode against a mocked Registry Service: `?src=api` with no VITE_API_BASE hits the same
   origin, which page.route intercepts. */

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "fixture.json"), "utf8"));

/* Every API request must carry `credentials: "include"` so the Cloudflare Access cookie travels when the
   app and the API are on different origins. The route handler cannot see the fetch init, so a shim
   installed before the app boots records the credentials mode of every fetch by URL. */
async function recordFetchInits(page: Page) {
  await page.addInitScript(() => {
    const log: { url: string; credentials: string | undefined }[] = [];
    (window as unknown as { __fetches: typeof log }).__fetches = log;
    const orig = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      log.push({ url, credentials: init?.credentials ?? (input instanceof Request ? input.credentials : undefined) });
      return orig(input, init);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __fetches: { url: string; credentials: string | undefined }[] }).__fetches);
}

async function mockService(page: Page, opts: { judgments?: (body: string) => { status: number; body: unknown } } = {}) {
  const posted: { body: string; headers: Record<string, string> }[] = [];
  let stamp = "2026-09-07-0900";
  await page.route("**/api/v1/registry", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...fixture, stamp }) });
  });
  await page.route("**/api/v1/judgments/text", (route) => {
    const body = route.request().postData() || "";
    posted.push({ body, headers: route.request().headers() });
    const r = opts.judgments ? opts.judgments(body) : { status: 200, body: { applied: 2, rejected: [], delta_stamp: "2026-09-07-1015" } };
    if (r.status === 200) stamp = "2026-09-07-1015";
    route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  return posted;
}

async function judgeTwo(page: Page) {
  await page.locator('.chead[data-cat="Art College"]').click();
  await page.locator('.done-t[data-done="T-103"]').click();
  const item = page.locator('.item[data-id="T-101"]');
  await item.locator('.i1[data-tgl="T-101"]').click();
  await item.locator('.sq[data-id="T-101"][data-ax="u"][data-v="H"]').click();
  await expect(page.locator("#sendn")).toHaveText("2");
}

test("api mode: Send POSTs the results text with the attestation headers, then clears and reloads", async ({ page }) => {
  const posted = await mockService(page);
  const fetches = await recordFetchInits(page);
  await page.goto("/?src=api");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#prov")).toContainText("live");
  await judgeTwo(page);
  await page.locator("#sendbtn").click();
  await expect(page.locator("#copystate")).toHaveText("Recorded 2 judgments · delta 2026-09-07-1015");
  expect(posted).toHaveLength(1);
  expect(posted[0].headers["x-actor"]).toBe("ftb");
  expect(posted[0].headers["x-human-judgment"]).toBe("true");
  expect(posted[0].headers["content-type"]).toContain("text/plain");
  const lines = posted[0].body.split("\n");
  // TODAY in api mode is the device clock in Europe/Sofia, so the day is not pinned here
  expect(lines[0]).toMatch(/^TRIAGE — Master widget — \d{4}-\d{2}-\d{2} \(staged from 2026-09-07-0900\)$/);
  expect(lines).toContain("T-101 (Publish the autumn course price list): U=H");
  expect(lines).toContain("T-103 (Fix the downstairs toilet door): status=Done");
  // the pending store is cleared and the registry reloaded from the service
  await expect(page.locator("#sendn")).toHaveText("");
  await expect(page.locator("#prov")).toContainText("2026-09-07-1015");
  expect(await page.locator("#exp").evaluate((el) => getComputedStyle(el).display)).toBe("block");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pto-master-pending::")))).toEqual([]);
  // after a live send there is nothing to paste: the helper line says so
  await expect(page.locator("#expnote")).toHaveText("Recorded — your judgments are in the registry.");
  // every API request — the registry loads and the judgments POST — carried credentials: "include"
  const api = (await fetches()).filter((f) => f.url.includes("/api/v1/"));
  expect(api.map((f) => f.url.replace(/^.*\/api\/v1/, ""))).toEqual(["/registry", "/judgments/text", "/registry"]);
  expect(api.map((f) => f.credentials)).toEqual(["include", "include", "include"]);
});

test("api mode: a failed send keeps every judgment and falls back to the clipboard panel with the error", async ({ page }) => {
  await mockService(page, { judgments: () => ({ status: 403, body: { error: "covenant", detail: "human_judgment missing" } }) });
  await page.goto("/?src=api");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await judgeTwo(page);
  await page.locator("#sendbtn").click();
  await expect(page.locator("#copystate")).toContainText("Send failed — HTTP 403 — covenant: human_judgment missing. Judgments kept.");
  expect(await page.locator("#exp").evaluate((el) => getComputedStyle(el).display)).toBe("block");
  // the clipboard flow is the fallback, so its paste instruction is the helper line
  await expect(page.locator("#expnote")).toContainText("Paste this into the chat");
  expect(await page.locator("#exptext").inputValue()).toContain("T-103 (Fix the downstairs toilet door): status=Done");
  await expect(page.locator("#sendn")).toHaveText("2");
  // still there after a reload
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#sendn")).toHaveText("2");
});

test("api mode: an unreachable service falls back to the fixture and says so", async ({ page }) => {
  await page.route("**/api/v1/registry", (route) => route.abort("connectionrefused"));
  await page.goto("/?src=api");
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#notice")).toContainText("could not be reached");
  await expect(page.locator("#prov")).toContainText("fixture");
  await expect(page.locator('.tab[data-tab="portfolio"] .n')).toHaveText("25");
});
