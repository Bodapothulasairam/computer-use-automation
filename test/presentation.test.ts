import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { startDemo } from "../src/demo-app.js";
import { presentationOptions } from "../src/presentation.js";
import { BrowserSurface } from "../src/surface.js";
import { Evidence } from "../src/evidence.js";
import { Policy } from "../src/policy.js";
import { readPolicy } from "../src/engine.js";
import { memberTarget } from "../src/schema.js";

test("headed presentation has readable defaults and bounded overrides", () => {
  assert.deepEqual(presentationOptions(true), {
    actionDelayMs: 2000,
    finalHoldMs: 5000,
  });
  assert.deepEqual(presentationOptions(false), {
    actionDelayMs: 0,
    finalHoldMs: 0,
  });
  assert.deepEqual(presentationOptions(true, "0", "12000"), {
    actionDelayMs: 0,
    finalHoldMs: 12000,
  });
  for (const value of ["-1", "abc", "Infinity", "10001", "1.5"])
    assert.throws(() => presentationOptions(true, value));
  assert.throws(() => presentationOptions(true, "2000", "30001"));
});
test("presentation delays an action and holds the final browser view", async () => {
  const app = await startDemo();
  const evidence = new Evidence("runs/presentation-tests", "replay");
  await evidence.init();
  const surface = new BrowserSurface(
    new Policy(app.origin, await readPolicy()),
    evidence,
    { actionDelayMs: 120, finalHoldMs: 150 },
  );
  try {
    await surface.open(app.origin + "/app");
    const begin = performance.now();
    await surface.perform(
      { kind: "fill", target: memberTarget, parameter: "memberId" },
      { memberId: "12345" },
      "automation",
    );
    assert.ok(performance.now() - begin >= 110);
    assert.match(
      await surface.page.locator("[data-run-status]").innerText(),
      /Member number/,
    );
    assert.equal(
      await surface.page
        .frameLocator('iframe[name="workspace"]')
        .locator("[data-active-action]")
        .count(),
      0,
    );
    await surface.presentStatus("Lookup complete");
    assert.equal(
      await surface.page.locator("[data-run-status]").innerText(),
      "Lookup complete",
    );
    const closing = performance.now();
    await surface.close();
    assert.ok(performance.now() - closing >= 140);
  } finally {
    if (surface.owner !== "closed") await surface.close();
    await app.close();
  }
});
test("member workspace stays readable at desktop and mobile widths", async () => {
  const app = await startDemo(),
    browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await mkdir("runs/ui", { recursive: true });
    for (const [width, height, label] of [
      [1440, 1000, "desktop"],
      [390, 844, "mobile"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(app.origin + "/app");
      const frame = page.frameLocator('iframe[name="workspace"]');
      await frame.getByRole("textbox", { name: "Member number" }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        label,
      );
      const workspace = page.frame({ name: "workspace" })!;
      assert.equal(
        await workspace.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        label + " iframe",
      );
      await page.screenshot({
        path: "runs/ui/member-search-" + label + ".png",
        fullPage: true,
      });
      await frame.getByRole("textbox", { name: "Member number" }).fill("12345");
      await frame.getByRole("button", { name: "Search", exact: true }).click();
      await frame
        .getByRole("link", { name: "Balance summary", exact: true })
        .click();
      await frame
        .getByRole("heading", { name: "Balance summary", exact: true })
        .waitFor();
      assert.equal(
        await workspace.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        label + " summary",
      );
      await page.screenshot({
        path: "runs/ui/balance-summary-" + label + ".png",
        fullPage: true,
      });
    }
  } finally {
    await browser.close();
    await app.close();
  }
});
