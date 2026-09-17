import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { startControl } from "../src/control-server.js";
import { startDemo } from "../src/demo-app.js";

// Records actual UI interaction. All accounts are synthetic; tokens never appear
// inside page screenshots/video. Validation happens before the short recording.
const out = "evidence/platform";
await mkdir(out, { recursive: true });
await mkdir("runs/platform-recording", { recursive: true });
const control = await startControl({
  dir: await mkdtemp("runs/platform-recording/session-"),
  bootstrap: JSON.parse(await readFile("evidence/capability.json", "utf8")),
});
const browser = await chromium.launch();
try {
  const api = async (route: string, body?: unknown) => {
    const response = await fetch(control.origin + "/api/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + control.tokens.reviewer,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(response.ok);
    return (await response.json()) as any;
  };
  const release = control.registry.snapshot().releases[0]!.artifact;
  const job = await api("releases/validate", {
    id: release.id,
    version: release.version,
  });
  let finished: any;
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    finished = await api("jobs/" + job.id);
    if (finished.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(finished.status, "complete");
  assert.equal(finished.result.validation.passed, true);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: {
      dir: "runs/platform-recording",
      size: { width: 1440, height: 1000 },
    },
  });
  const page = await context.newPage();
  const video = page.video()!;
  await page.goto(control.origin + "/#" + control.tokens.reviewer);
  await page.waitForFunction(
    () => !(document.getElementById("approve") as HTMLButtonElement).disabled,
  );
  await page.screenshot({
    path: out + "/console-validated.png",
    fullPage: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page
    .getByRole("button", { name: "Approve release", exact: true })
    .click();
  await page.waitForFunction(
    () => !(document.getElementById("activate") as HTMLButtonElement).disabled,
  );
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page
    .getByRole("button", { name: "Activate release", exact: true })
    .click();
  await page.waitForFunction(
    () => !(document.getElementById("run") as HTMLButtonElement).disabled,
  );
  await page.locator("#variant").selectOption("cards");
  await page.locator("#scenario").selectOption("handoff");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.locator("#run").click();
  await page.waitForFunction(
    () => document.getElementById("result")?.textContent === "Outcome: success",
  );
  await page.waitForFunction(
    () => !(document.getElementById("run") as HTMLButtonElement).disabled,
  );
  await page.screenshot({
    path: out + "/console-evidence.png",
    fullPage: true,
  });
  await page
    .getByRole("heading", { name: "Execution evidence", exact: true })
    .scrollIntoViewIfNeeded();
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await page
    .locator("#timeline")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: out + "/console-mobile.png", fullPage: true });
  await context.close();
  await video.saveAs(out + "/walkthrough.webm");
  await writeFile(
    out + "/walkthrough.json",
    JSON.stringify(
      {
        operator: "automated UI demonstration",
        validationCases: 38,
        passed: true,
        video: "walkthrough.webm",
        scenario: "handoff",
        variant: "cards",
      },
      null,
      2,
    ),
  );
  const app = await startDemo(0, "cards");
  try {
    const cardPage = await browser.newPage({
      viewport: { width: 1280, height: 950 },
    });
    await cardPage.goto(app.origin + "/app");
    const frame = cardPage.frameLocator('iframe[name="workspace"]');
    await frame.getByRole("textbox", { name: "Member ID" }).fill("12345");
    await frame.getByRole("button", { name: "Look up", exact: true }).click();
    await frame
      .getByRole("link", { name: "Savings overview", exact: true })
      .click();
    await frame
      .getByRole("heading", { name: "Savings overview", exact: true })
      .waitFor();
    await cardPage.screenshot({
      path: out + "/cards-layout.png",
      fullPage: true,
    });
  } finally {
    await app.close();
  }
  console.log(
    "Recorded real release approval, activation, card replay, handoff and evidence viewer.",
  );
} finally {
  await browser.close();
  await control.close();
}
