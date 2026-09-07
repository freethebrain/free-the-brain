import { expect, test, type Locator, type Page } from "@playwright/test";

/* The "+ Capture" box in the controls row: reachable on every tab, one input, Enter adds a row to the
   same capture store the Triage tab uses (reserved IDs first, then extras), so it lands in Send
   results under NEW TASKS. Verified by computed style, per the render spec's standing rule. */

const style = (loc: Locator, prop: string) => loc.evaluate((el, p) => getComputedStyle(el as Element).getPropertyValue(p), prop);

async function open(page: Page) {
  await page.goto("/?src=fixture");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
}

test("+ Capture on the Portfolio tab reveals the box; Enter adds a capture row that Send results carries", async ({ page }) => {
  await open(page);
  // default tab is Portfolio, not Triage
  expect(await style(page.locator('.tab[data-tab="portfolio"]'), "box-shadow")).not.toBe("none");
  const box = page.locator("#quickcap");
  expect(await style(box, "display")).toBe("none");
  await page.locator("#capbtn").click();
  expect(await style(box, "display")).toBe("flex");
  await expect(page.locator("#quickbox")).toBeFocused();
  await page.locator("#quickbox").fill("Order more clay");
  await page.locator("#quickbox").press("Enter");
  // the row is pending: the Send count shows it and the input is ready for the next one
  await expect(page.locator("#sendn")).toHaveText("1");
  await expect(page.locator("#quickstate")).toHaveText("T-122 captured · pending until sent");
  await expect(page.locator("#quickbox")).toHaveValue("");
  expect(await style(page.locator("#clearbtn"), "display")).not.toBe("none");
  // a second one fills the next reserved slot; the tab did not change
  await page.locator("#quickbox").fill("Ask Sasho for the second quote");
  await page.locator("#quickbox").press("Enter");
  await expect(page.locator("#sendn")).toHaveText("2");
  expect(await style(page.locator('.tab[data-tab="portfolio"]'), "box-shadow")).not.toBe("none");
  // the same store the Triage tab renders
  await page.locator('.tab[data-tab="triage"]').click();
  await expect(page.locator('input[data-cap="0"]')).toHaveValue("Order more clay");
  await expect(page.locator('input[data-cap="1"]')).toHaveValue("Ask Sasho for the second quote");
  // and Send results carries both under NEW TASKS
  await page.locator("#sendbtn").click();
  expect(await style(page.locator("#exp"), "display")).toBe("block");
  const lines = (await page.locator("#exptext").inputValue()).split("\n");
  expect(lines).toContain("NEW TASKS:");
  expect(lines).toContain("T-122: Order more clay");
  expect(lines).toContain("T-123: Ask Sasho for the second quote");
  // fixture mode: the clipboard flow's paste instruction
  await expect(page.locator("#expnote")).toContainText("Paste this into the chat");
  // the box toggles closed again
  await page.locator("#capbtn").click();
  expect(await style(box, "display")).toBe("none");
});

test("+ Capture past the reserved block adds extra IDs and survives a reload", async ({ page }) => {
  await open(page);
  await page.locator("#capbtn").click();
  for (const t of ["one", "two", "three", "four"]) {
    await page.locator("#quickbox").fill(t);
    await page.locator("#quickbox").press("Enter");
  }
  await expect(page.locator("#quickstate")).toHaveText("T-125 captured · pending until sent");
  await expect(page.locator("#sendn")).toHaveText("4");
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#sendn")).toHaveText("4");
  await page.locator('.tab[data-tab="triage"]').click();
  await expect(page.locator('input[data-cap="3"]')).toHaveValue("four");
});
