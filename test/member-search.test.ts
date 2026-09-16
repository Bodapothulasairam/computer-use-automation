import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { startDemo } from "../src/demo-app.js";

test("member search requires exactly five digits before click or Enter can submit", async () => {
  const app = await startDemo();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const submissions: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/legacy/member")
        submissions.push(url.searchParams.get("member")!);
    });
    await page.goto(app.origin + "/app");
    const frame = page.frameLocator('iframe[name="workspace"]');
    const input = frame.getByRole("textbox", { name: "Member number" });
    const search = frame.getByRole("button", { name: "Search", exact: true });
    await input.waitFor();
    assert.equal(
      await input.getAttribute("placeholder"),
      "5 digits (e.g. 12345)",
    );
    assert.equal(await search.isDisabled(), true);
    await input.fill("1234");
    assert.equal(await search.isDisabled(), true);
    await mkdir("runs", { recursive: true });
    await page.screenshot({
      path: "runs/member-search-invalid.png",
      fullPage: true,
    });
    const box = await search.boundingBox();
    assert.ok(box);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await input.press("Enter");
    assert.equal(
      await frame
        .getByRole("heading", { name: "Member search", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await frame
        .getByRole("heading", { name: "Validation error", exact: true })
        .count(),
      0,
    );
    for (const invalid of ["", "12a45", "12 45", "?????"]) {
      await input.fill(invalid);
      assert.equal(await search.isDisabled(), true, JSON.stringify(invalid));
    }
    await input.fill("12345");
    assert.equal(await search.isEnabled(), true);
    await input.press("Backspace");
    assert.equal(await input.inputValue(), "1234");
    assert.equal(await search.isDisabled(), true);
    await input.press("5");
    assert.equal(await search.isEnabled(), true);
    await search.click();
    await frame
      .getByRole("heading", { name: "Member details", exact: true })
      .waitFor();
    assert.deepEqual(
      submissions,
      ["12345"],
      "Invalid input must not reach the member endpoint",
    );
    await page.goto(app.origin + "/app");
    await input.fill("67890");
    await input.press("Enter");
    await frame
      .getByRole("heading", { name: "Member details", exact: true })
      .waitFor();
    assert.deepEqual(submissions, ["12345", "67890"]);
  } finally {
    await browser.close();
    await app.close();
  }
});
test("direct requests still validate member numbers on the server", async () => {
  const app = await startDemo();
  try {
    const response = await fetch(app.origin + "/legacy/member?member=1234");
    assert.match(await response.text(), /<h2>Validation error<\/h2>/);
  } finally {
    await app.close();
  }
});
