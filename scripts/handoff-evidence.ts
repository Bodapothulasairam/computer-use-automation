import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { startDemo } from "../src/demo-app.js";
import { replay } from "../src/engine.js";
const app = await startDemo();
const artifact = JSON.parse(await readFile("evidence/capability.json", "utf8"));
let failure: unknown;
try {
  const result = await replay(artifact, {
    origin: app.origin,
    parameters: { memberId: "12345" },
    scenario: "session",
    evidenceDir: "evidence",
    operator: {
      timeoutMs: 30000,
      onRequest: async (i) => {
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({
            viewport: { width: 1280, height: 1060 },
            reducedMotion: "reduce",
          });
          await page.goto(i.url + "/#" + i.token);
          const claim = page.getByRole("button", {
            name: "Claim control",
            exact: true,
          });
          const resume = page.getByRole("button", {
            name: "Resume automation",
            exact: true,
          });
          const restore = page.getByRole("button", {
            name: "Restore session",
            exact: true,
          });
          await restore.waitFor();
          assert.equal(await claim.isEnabled(), true);
          assert.equal(await restore.isDisabled(), true);
          assert.equal(await resume.isDisabled(), true);
          await page.screenshot({
            path: "evidence/operator-before-claim.png",
            fullPage: true,
          });
          await claim.click();
          await page.waitForFunction(
            () =>
              document.getElementById("owner")?.textContent ===
                "You have control" &&
              !document.querySelector<HTMLButtonElement>("#controls button")
                ?.disabled,
          );
          assert.equal(await claim.isDisabled(), true);
          assert.equal(await restore.isEnabled(), true);
          assert.equal(await resume.isDisabled(), true);
          assert.ok(
            (await page.locator("#state").textContent())?.includes(i.sessionId),
          );
          await page.screenshot({
            path: "evidence/operator-console.png",
            fullPage: true,
          });
          const premature = await fetch(i.url + "/resume", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + i.token,
              "Content-Type": "application/json",
            },
            body: "{}",
          });
          assert.equal(premature.status, 409);
          assert.equal(
            ((await premature.json()) as any).code,
            "RECOVERY_NOT_VERIFIED",
          );
          await restore.click();
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLButtonElement>("#resume")?.disabled ===
              false,
          );
          assert.equal(await claim.isDisabled(), true);
          assert.equal(await restore.count(), 0);
          assert.ok(
            (await page.locator("#state").textContent())?.includes(i.sessionId),
          );
          await page.screenshot({
            path: "evidence/operator-ready.png",
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          await page.screenshot({
            path: "evidence/operator-mobile.png",
            fullPage: true,
          });
          await resume.click();
          await page
            .getByText("Control returned. You may close this window.", {
              exact: true,
            })
            .waitFor();
          assert.equal(await resume.isDisabled(), true);
        } catch (e) {
          failure = e;
          throw e;
        } finally {
          await browser.close();
        }
      },
    },
  });
  if (failure) throw failure;
  assert.equal(result.status, "success", JSON.stringify(result));
  await writeFile(
    "evidence/handoff-summary.json",
    JSON.stringify(
      {
        runId: result.runId,
        status: result.status,
        operator: "automated operator acting through the real web UI",
        sameSessionVerified: true,
        sequenceVerified: true,
        screenshot: "operator-console.png",
      },
      null,
      2,
    ),
  );
  console.log("Guided operator UI handoff passed: " + result.runId);
} finally {
  await app.close();
}
