import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* The api data mode against a mocked Registry Service: `?src=api` with no VITE_API_BASE hits the same
   origin, which page.route intercepts. */

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "fixture.json"), "utf8"));

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
  expect(lines[0]).toBe("TRIAGE — Master widget — 2026-09-07 (staged from 2026-09-07-0900)");
  expect(lines).toContain("T-101 (Publish the autumn course price list): U=H");
  expect(lines).toContain("T-103 (Fix the downstairs toilet door): status=Done");
  // the pending store is cleared and the registry reloaded from the service
  await expect(page.locator("#sendn")).toHaveText("");
  await expect(page.locator("#prov")).toContainText("2026-09-07-1015");
  expect(await page.locator("#exp").evaluate((el) => getComputedStyle(el).display)).toBe("block");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pto-master-pending::")))).toEqual([]);
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
