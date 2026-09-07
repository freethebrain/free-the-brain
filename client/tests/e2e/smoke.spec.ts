import { expect, test, type Locator, type Page } from "@playwright/test";

/* Standing rule from the render spec: verify behaviour by COMPUTED STYLE, never by class or node presence.
   The first smoke test of the widget passed while it was broken because it only checked that a class
   had been applied. */

const style = (loc: Locator, prop: string) => loc.evaluate((el, p) => getComputedStyle(el as Element).getPropertyValue(p), prop);

async function open(page: Page) {
  await page.goto("/?src=fixture");
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
}

test("Portfolio: opening a card and tapping a row expands it (the .det element is display:block)", async ({ page }) => {
  await open(page);
  await expect(page.locator("#prov")).toContainText("2026-09-07-0900");
  await page.locator('.chead[data-cat="Art College"]').click();
  const item = page.locator('.item[data-id="T-101"]');
  const det = item.locator(".det");
  expect(await style(det, "display")).toBe("none");
  await item.locator('.i1[data-tgl="T-101"]').click();
  expect(await style(det, "display")).toBe("block");
  // the note and the editor are visible
  await expect(det).toContainText("Draft exists");
  expect(await style(det.locator(".ed"), "display")).toBe("block");
});

test("Editor: a status chip turns on, the row shows pending, and the row element is not replaced", async ({ page }) => {
  await open(page);
  await page.locator('.chead[data-cat="Art College"]').click();
  const item = page.locator('.item[data-id="T-101"]');
  await item.locator('.i1[data-tgl="T-101"]').click();
  // hold a reference to the live element and to the chip we are about to click
  const handle = await item.elementHandle();
  const chipHandle = await item.locator('.chip[data-st="T-101"][data-v="2"]').elementHandle();
  const before = await chipHandle!.evaluate((el) => getComputedStyle(el).backgroundColor);
  await chipHandle!.click();
  const after = await chipHandle!.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).not.toBe(before);
  expect(after).toBe("rgb(6, 118, 71)"); // --green in the light theme: the chip is really "on"
  const chipText = await chipHandle!.evaluate((el) => getComputedStyle(el).color);
  expect(chipText).toBe("rgb(255, 255, 255)"); // --card
  // the pending chip is painted in the row's right-hand cluster
  const pend = item.locator(".pendchip");
  const pendBox = await pend.boundingBox();
  expect(pendBox!.width).toBeGreaterThan(0); // laid out, not merely present
  expect(await style(pend, "color")).toBe("rgb(14, 147, 132)"); // --teal
  await expect(pend).toHaveText("pending");
  // the element under the cursor was never rebuilt
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
  expect(await chipHandle!.evaluate((el) => el.isConnected)).toBe(true);
  // the editor is still open and the row still expanded
  expect(await style(item.locator(".det"), "display")).toBe("block");
  // the status mini in the row reflects the pending status
  await expect(item.locator(".ir .mini").last()).toHaveText("Active");
  // tapping the same chip again undoes it
  await chipHandle!.click();
  expect(await chipHandle!.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(before);
  await expect(item.locator(".pendchip")).toHaveCount(0);
});

test("One-tap done circle strikes the row through without expanding it", async ({ page }) => {
  await open(page);
  await page.locator('.chead[data-cat="Personal / Admin"]').click();
  const item = page.locator('.item[data-id="T-116"]');
  const name = item.locator(".iname");
  expect(await style(name, "text-decoration-line")).toBe("none");
  const handle = await item.elementHandle();
  await item.locator('.done-t[data-done="T-116"]').click();
  expect(await style(name, "text-decoration-line")).toBe("line-through");
  expect(parseFloat(await style(name, "opacity"))).toBeCloseTo(0.55, 2);
  expect(await style(item.locator('.done-t[data-done="T-116"]'), "background-color")).toBe("rgb(6, 118, 71)");
  expect(await style(item.locator(".det"), "display")).toBe("none"); // closing never requires expanding
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.locator("#sendn")).toHaveText("1");
  await expect(page.locator("#sum .pend").first()).toHaveText("1");
});

test("Send results serialises the judged rows in the output contract", async ({ page }) => {
  await open(page);
  await page.locator('.chead[data-cat="Art College"]').click();
  const item = page.locator('.item[data-id="T-101"]');
  await item.locator('.i1[data-tgl="T-101"]').click();
  await item.locator('.sq[data-id="T-101"][data-ax="u"][data-v="M"]').click();
  await item.locator('.sq[data-id="T-101"][data-ax="i"][data-v="H"]').click();
  await item.locator('.chip[data-st="T-101"][data-v="2"]').click();
  // move the date: mode keep -> move, type SB, +1 week
  await item.locator('.dlmode[data-dm="T-101"]').click();
  expect(await style(item.locator(".dlline .dlx"), "display")).toBe("flex");
  await item.locator('.ty[data-ty="T-101"][data-v="SB"]').click();
  await item.locator('input.num[data-id="T-101"][data-f="w"]').fill("1");
  await expect(item.locator('input.dlpick[data-id="T-101"]')).toHaveValue("2026-09-14");
  await item.locator('input.clar[data-nt="T-101"]').fill("studio fee confirmed");
  // and a one-tap done on another row, plus a capture on the Triage tab
  await page.locator('.done-t[data-done="T-103"]').click();
  await page.locator('.tab[data-tab="triage"]').click();
  await page.locator('input[data-cap="0"]').fill("Order more clay");
  await page.locator("#sendbtn").click();
  const exp = page.locator("#exp");
  expect(await style(exp, "display")).toBe("block");
  const txt = await page.locator("#exptext").inputValue();
  const lines = txt.split("\n");
  expect(lines[0]).toBe("TRIAGE — Master widget — 2026-09-07 (staged from 2026-09-07-0900)");
  expect(lines).toContain("T-101 (Publish the autumn course price list): U=M I=H status=Active deadline=SB 2026-09-14 note: studio fee confirmed");
  expect(lines).toContain("T-103 (Fix the downstairs toilet door): status=Done");
  expect(lines).toContain("NEW TASKS:");
  expect(lines).toContain("T-122: Order more clay");
  expect(txt).not.toContain("T-102"); // untouched rows emit nothing
  expect(txt).not.toContain("UNJUDGED");
  // judgments survive a reload (keyed by stamp)
  await page.reload();
  await page.waitForSelector("body[data-ready='1']");
  await expect(page.locator("#notice")).toContainText("Restored");
  await expect(page.locator("#sendn")).toHaveText("3");
});

test("Radar and Eisenhower follow the DL/SO/SB semantics of the fixture", async ({ page }) => {
  await open(page);
  await page.locator('.tab[data-tab="radar"]').click();
  const heads = await page.locator(".sec .shead").evaluateAll((els) => els.map((e) => e.textContent || ""));
  expect(heads.map((h) => h.split("·")[0].trim())).toEqual([
    "Overdue",
    "Today and tomorrow",
    "This fortnight",
    "Passed, not overdue",
    "Dated, further out",
    "Dormant start-ons",
    "No date",
  ]);
  const overdue = page.locator(".sec").first();
  await expect(overdue.locator(".item")).toHaveCount(3); // T-107 (13d), T-103 (SB, Planned), T-101 (4d)
  await expect(overdue.locator(".item").first()).toHaveAttribute("data-id", "T-107");
  expect(await style(overdue.locator(".shead"), "color")).toBe("rgb(180, 35, 24)"); // --red
  await page.locator('.tab[data-tab="eisen"]').click();
  await expect(page.locator(".band").nth(4).locator(".bcount")).toHaveText("6"); // Unjudged: no scores
});

test("Phone-first chrome: at 400px the tab bar is fixed to the bottom and Send stays reachable", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 760 });
  await open(page);
  const bar = page.locator("#tabbar");
  expect(await style(bar, "position")).toBe("fixed");
  const box = await bar.boundingBox();
  expect(box!.y + box!.height).toBeCloseTo(760, 0);
  const send = page.locator("#sendbtn");
  expect(await style(send, "position")).toBe("fixed");
  expect(await style(send, "background-color")).toBe("rgb(142, 157, 250)"); // --brand-periwinkle
  await expect(page.locator('.tab[data-tab="triage"]')).toBeVisible();
  await page.locator('.tab[data-tab="done"]').click();
  await expect(page.locator(".dsum")).toBeVisible();
});
