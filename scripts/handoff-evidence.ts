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
        // Automated stand-in for a human, using the actual operator web UI and HTTP
        // ownership protocol. The target browser/session remains owned by the engine.
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({
            viewport: { width: 1100, height: 820 },
          });
          await page.goto(i.url + "/#" + i.token);
          await page
            .getByRole("button", { name: "Claim control", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Restore session", exact: true })
            .waitFor();
          assert.ok(
            (await page.locator("#state").innerText()).includes(i.sessionId),
          );
          await page.screenshot({
            path: "evidence/operator-console.png",
            fullPage: true,
          });
          await page
            .getByRole("button", { name: "Restore session", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Balance summary", exact: true })
            .waitFor();
          assert.ok(
            (await page.locator("#state").innerText()).includes(i.sessionId),
          );
          await page
            .getByRole("button", { name: "Resume automation", exact: true })
            .click();
          await page
            .getByText("Control returned. You may close this window.", {
              exact: true,
            })
            .waitFor();
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
        screenshot: "operator-console.png",
      },
      null,
      2,
    ),
  );
  console.log("Operator UI handoff passed: " + result.runId);
} finally {
  await app.close();
}
