import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rename,
  rmdir,
} from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import http from "node:http";
import { startControl } from "../src/control-server.js";
import { Registry } from "../src/registry.js";
import { fixture } from "../src/fixture.js";
import { OpenAIModel } from "../src/model.js";
import { Evidence } from "../src/evidence.js";
import { startDemo } from "../src/demo-app.js";
import { replay, readPolicy } from "../src/engine.js";
import { digest, correct, benchmark } from "../src/benchmark.js";
import { Policy } from "../src/policy.js";

await mkdir("runs/platform-tests", { recursive: true });
const temp = () => mkdtemp("runs/platform-tests/case-");

test("replay rejects construction of a live model client before any network call", () => {
  assert.throws(
    () =>
      new OpenAIModel("irrelevant", "unused", new Evidence("runs", "replay")),
    /MODEL_FORBIDDEN_IN_REPLAY/,
  );
});
test("output contract cannot be weakened or repurposed by an artifact", async () => {
  const p = new Policy("http://127.0.0.1:1", await readPolicy());
  for (const mutate of [
    (a: any) => (a.outputs = {}),
    (a: any) => (a.outputs.savingsBalance.type = "string"),
    (a: any) => (a.outputs.savingsBalance.target = a.outputs.currency.target),
    (a: any) => (a.outputs.savingsBalance.sensitive = false),
  ]) {
    const a = structuredClone(fixture);
    mutate(a);
    assert.throws(() => p.capability(a), /CONTRACT_MISMATCH/);
  }
});
for (const variant of ["classic", "cards"] as const) {
  test(
    "reviewed binding returns exact outputs and ignores page instructions: " +
      variant,
    async () => {
      const app = await startDemo();
      const dir = await temp();
      try {
        const r = await replay(fixture, {
          origin: app.origin,
          parameters: { memberId: "67890" },
          variant,
          scenario: "injection",
          evidenceDir: dir,
        });
        assert.equal(r.status, "success", JSON.stringify(r));
        if (r.status === "success")
          assert.deepEqual(r.outputs, {
            savingsBalance: 9820.5,
            currency: "USD",
          });
        const log = await readFile(
          path.join(dir, r.runId, "events.jsonl"),
          "utf8",
        );
        for (const forbidden of ["PRIVATE_PAGE_CANARY", "67890", "9820.5"])
          assert.ok(!log.includes(forbidden));
        const metrics = JSON.parse(
          await readFile(path.join(dir, r.runId, "metrics.json"), "utf8"),
        );
        assert.equal(metrics.modelCalls, 0);
      } finally {
        await app.close();
      }
    },
  );
  for (const scenario of ["drift", "drift_late"])
    test(
      "unreviewed UI change stops execution: " + variant + " " + scenario,
      async () => {
        const app = await startDemo();
        try {
          const r = await replay(fixture, {
            origin: app.origin,
            parameters: { memberId: "12345" },
            variant,
            scenario,
            evidenceDir: await temp(),
          });
          assert.equal(r.status, "failure");
          if (r.status === "failure") assert.equal(r.code, "UI_DRIFT");
        } finally {
          await app.close();
        }
      },
    );
}
test("registry is exclusive, immutable, restartable and detects artifact tampering", async () => {
  const dir = await temp();
  const a = await new Registry(dir).open();
  try {
    await a.import(fixture);
    await assert.rejects(a.import(fixture), /VERSION_EXISTS/);
    await assert.rejects(new Registry(dir).open(), /REGISTRY_LOCKED/);
    await assert.rejects(
      a.approve(fixture.id, fixture.version),
      /VALIDATION_REQUIRED/,
    );
    await assert.rejects(
      a.activate(fixture.id, fixture.version),
      /APPROVAL_REQUIRED/,
    );
    const returned = a.snapshot();
    returned.releases[0]!.artifact.steps.pop();
    assert.equal(a.get(fixture.id, fixture.version).digest, digest(fixture));
  } finally {
    await a.close();
  }
  const b = await new Registry(dir).open();
  assert.equal(b.snapshot().releases.length, 1);
  await b.close();
  const state = JSON.parse(
    await readFile(path.join(dir, "registry.json"), "utf8"),
  );
  state.releases[0].artifact.description = "tampered";
  await writeFile(path.join(dir, "registry.json"), JSON.stringify(state));
  await assert.rejects(new Registry(dir).open(), /REGISTRY_CORRUPT/);
});

test("control API enforces authentication, role, host, origin, schemas, sizes and route boundaries", async () => {
  const server = await startControl({ dir: await temp(), bootstrap: fixture });
  const api = (
    route: string,
    body?: unknown,
    token = server.tokens.reviewer,
    extra: Record<string, string> = {},
  ) =>
    fetch(server.origin + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal(
      (await fetch(server.origin + "/api/capabilities")).status,
      401,
    );
    assert.equal(
      (await api("/api/capabilities", undefined, "wrong")).status,
      401,
    );
    assert.equal(
      (await api("/api/releases", undefined, server.tokens.runner)).status,
      403,
    );
    for (const action of [
      "import",
      "validate",
      "approve",
      "activate",
      "rollback",
    ])
      assert.equal(
        (await api("/api/releases/" + action, {}, server.tokens.runner)).status,
        403,
      );
    assert.equal(
      (
        await api("/api/session", undefined, server.tokens.reviewer, {
          Origin: "https://attacker.invalid",
        })
      ).status,
      403,
    );
    const forgedHost = await new Promise<number>((resolve) => {
      http.get(
        server.origin + "/api/session",
        {
          headers: {
            Host: "attacker.invalid",
            Authorization: "Bearer " + server.tokens.reviewer,
          },
        },
        (r) => {
          r.resume();
          resolve(r.statusCode!);
        },
      );
    });
    assert.equal(forgedHost, 403);
    assert.equal(
      (
        await api("/api/invoke", {
          id: fixture.id,
          memberId: "12345",
          target: "http://169.254.169.254/",
        })
      ).status,
      400,
    );
    assert.equal(
      (await api("/api/invoke", { id: fixture.id, memberId: "1234" })).status,
      400,
    );
    assert.equal(
      (await api("/api/invoke", { id: fixture.id, memberId: "12345" })).status,
      409,
    );
    assert.equal(
      (
        await api("/api/releases/approve", {
          id: fixture.id,
          version: fixture.version,
          validation: { passed: true },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await api("/api/releases/approve", {
          id: fixture.id,
          version: fixture.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (await api("/api/releases/import", { ...fixture, extra: "forbidden" }))
        .status,
      400,
    );
    assert.equal(
      (await api("/api/invoke", { data: "x".repeat(66000) })).status,
      413,
    );
    assert.equal(
      (
        await api("/api/invoke", {}, server.tokens.reviewer, {
          "Content-Type": "text/plain",
        })
      ).status,
      415,
    );
    assert.equal(
      (await api("/api/runs/00000000-0000-4000-8000-000000000000")).status,
      404,
    );
    assert.equal((await api("/api/runs/..%2f..%2f.env")).status, 404);
    assert.equal(
      (
        await fetch(server.origin + "/api/capabilities", {
          method: "DELETE",
          headers: { Authorization: "Bearer " + server.tokens.runner },
        })
      ).status,
      405,
    );
    const page = await fetch(server.origin + "/");
    assert.match(
      page.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    const spec = (await (await api("/api/openapi")).json()) as any;
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/api/invoke"]);
  } finally {
    await server.close();
  }
});
test("control API has a bounded request rate", async () => {
  const server = await startControl({ dir: await temp(), maxRequests: 2 });
  try {
    await fetch(server.origin);
    await fetch(server.origin);
    const r = await fetch(server.origin);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "60");
  } finally {
    await server.close();
  }
});

test("failed registry persistence restores the last committed in-memory state", async () => {
  const dir = await temp();
  const registry = await new Registry(dir).open();
  try {
    await registry.import(fixture);
    const stateFile = path.join(dir, "registry.json");
    await rename(stateFile, stateFile + ".backup");
    await mkdir(stateFile);
    const next = structuredClone(fixture);
    next.version = "1.1.0";
    await assert.rejects(registry.import(next));
    assert.equal(registry.snapshot().releases.length, 1);
    await rmdir(stateFile);
    await rename(stateFile + ".backup", stateFile);
  } finally {
    await registry.close();
  }
});
test("malformed and disconnected requests release the mutation lease", async () => {
  const server = await startControl({ dir: await temp() });
  try {
    const headers = {
      Authorization: "Bearer " + server.tokens.reviewer,
      "Content-Type": "application/json",
    };
    assert.equal(
      (
        await fetch(server.origin + "/api/releases/import", {
          method: "POST",
          headers,
          body: "{invalid",
        })
      ).status,
      400,
    );
    const partial = http.request(server.origin + "/api/releases/import", {
      method: "POST",
      headers: { ...headers, "Content-Length": "1000" },
    });
    partial.on("error", () => {});
    partial.write("{");
    await new Promise((r) => setTimeout(r, 50));
    const busy = await fetch(server.origin + "/api/releases/import", {
      method: "POST",
      headers,
      body: JSON.stringify(fixture),
    });
    assert.equal(busy.status, 409);
    partial.destroy();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      (
        await fetch(server.origin + "/api/releases/import", {
          method: "POST",
          headers,
          body: JSON.stringify(fixture),
        })
      ).status,
      201,
    );
  } finally {
    await server.close();
  }
});
test("benchmark repeats its seeded schedule without hiding failures and rejects incorrect success", async () => {
  const reports = [];
  for (let i = 0; i < 2; i++)
    reports.push(
      await benchmark(fixture, { out: await temp(), count: 2, seed: 42 }),
    );
  assert.deepEqual(
    reports[0]!.trials.map((t) => [t.scenario, t.variant, t.delayMs]),
    reports[1]!.trials.map((t) => [t.scenario, t.variant, t.delayMs]),
  );
  assert.equal(reports[0]!.passed + reports[0]!.failed, 2);
  assert.equal(reports[0]!.modelCalls, 0);
  assert.equal(
    correct(
      {
        status: "success",
        runId: "unused",
        outputs: { savingsBalance: 999, currency: "USD" },
      },
      "normal",
      "12345",
    ),
    false,
  );
  assert.equal(
    correct(
      {
        status: "success",
        runId: "unused",
        outputs: { savingsBalance: 1250.75, currency: "USD" },
      },
      "permission",
      "12345",
    ),
    false,
  );
  await assert.rejects(benchmark(fixture, { out: await temp(), count: 0 }));
});

test("complete release lifecycle, both layouts, API replay, rollback and actual console states", async () => {
  const dir = await temp();
  const server = await startControl({ dir, bootstrap: fixture });
  const browser = await chromium.launch();
  const api = async (
    route: string,
    body?: unknown,
    token = server.tokens.reviewer,
  ) => {
    const response = await fetch(server.origin + "/api/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  const wait = async (id: string) => {
    const until = Date.now() + 180000;
    while (Date.now() < until) {
      const { data } = await api("jobs/" + id);
      if (data.status !== "running") {
        assert.equal(data.status, "complete", JSON.stringify(data));
        return data;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw Error("Job deadline");
  };
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.origin + "/#" + server.tokens.reviewer);
    await page.getByText("Reviewer session", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => location.hash), "");
    assert.equal(
      await page
        .getByRole("button", { name: "Approve release", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Run approved workflow", exact: true })
        .isDisabled(),
      true,
    );
    await mkdir("runs/platform-screenshots", { recursive: true });
    await page.screenshot({
      path: "runs/platform-screenshots/01-candidate.png",
      fullPage: true,
    });
    // Start validation through the real reviewer UI; then inspect the server result.
    await page
      .getByRole("button", { name: "Validate 38 scenarios", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .getElementById("notice")
        ?.textContent?.includes("Validation is running"),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Approve release", exact: true })
        .isDisabled(),
      true,
    );
    let jobs = (await api("jobs")).data;
    assert.equal(jobs.length, 1);
    assert.equal(
      (
        await api("releases/approve", {
          id: fixture.id,
          version: fixture.version,
        })
      ).status,
      409,
    );
    const validation = await wait(jobs[0].id);
    assert.equal(
      validation.result.status,
      "validated",
      JSON.stringify(validation.result.validation),
    );
    assert.equal(validation.result.validation.count, 38);
    await page.waitForFunction(
      () => !(document.getElementById("approve") as HTMLButtonElement).disabled,
    );
    await page
      .getByRole("button", { name: "Approve release", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !(document.getElementById("activate") as HTMLButtonElement).disabled,
    );
    await page
      .getByRole("button", { name: "Activate release", exact: true })
      .click();
    await page.waitForFunction(
      () => !(document.getElementById("run") as HTMLButtonElement).disabled,
    );
    await page.locator("#member").fill("1234");
    assert.equal(await page.locator("#run").isDisabled(), true);
    await page.locator("#member").fill("67890");
    await page.locator("#variant").selectOption("cards");
    await page.locator("#scenario").selectOption("handoff");
    await page.locator("#run").click();
    await page.waitForFunction(() =>
      document
        .getElementById("notice")
        ?.textContent?.includes("Running the approved"),
    );
    jobs = (await api("jobs")).data;
    const run = await wait(jobs[jobs.length - 1].id);
    assert.deepEqual(run.result.outputs, {
      savingsBalance: 9820.5,
      currency: "USD",
    });
    await page.waitForFunction(
      () =>
        document.getElementById("result")?.textContent === "Outcome: success",
    );
    await page.screenshot({
      path: "runs/platform-screenshots/02-evidence.png",
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
      path: "runs/platform-screenshots/03-mobile.png",
      fullPage: true,
    });
    const saved = (await api("runs/" + run.runId)).data;
    assert.equal(saved.result.outputs.savingsBalance, "[REDACTED]");
    assert.equal(saved.metrics.modelCalls, 0);
    assert.ok(saved.events.some((e: any) => e.event === "control_claimed"));
    const candidate = structuredClone(fixture);
    candidate.version = "1.1.0";
    candidate.description = "<img src=x onerror=alert(1)> candidate";
    assert.equal((await api("releases/import", candidate)).status, 201);
    assert.equal(
      (
        await api("releases/activate", {
          id: candidate.id,
          version: candidate.version,
        })
      ).status,
      409,
    );
    const validate2 = await api("releases/validate", {
      id: candidate.id,
      version: candidate.version,
    });
    assert.equal(validate2.status, 202);
    assert.equal((await wait(validate2.data.id)).result.status, "validated");
    assert.equal(
      (
        await api("releases/approve", {
          id: candidate.id,
          version: candidate.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api("releases/rollback", {
          id: candidate.id,
          version: candidate.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await api("releases/activate", {
          id: candidate.id,
          version: candidate.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api("releases/rollback", {
          id: fixture.id,
          version: fixture.version,
        })
      ).status,
      200,
    );
    const catalog = (await api("capabilities", undefined, server.tokens.runner))
      .data;
    assert.equal(catalog[0].version, fixture.version);
    // Runner can invoke but cannot review or modify releases.
    const replayJob = await api(
      "invoke",
      { id: fixture.id, memberId: "12345", variant: "classic" },
      server.tokens.runner,
    );
    assert.equal(replayJob.status, 202);
    assert.equal((await wait(replayJob.data.id)).result.status, "success");
    await page
      .locator("#release")
      .selectOption(candidate.id + "@" + candidate.version);
    await page
      .locator("summary")
      .filter({ hasText: "Review artifact" })
      .click();
    assert.equal(await page.locator("#artifact img").count(), 0);
    assert.equal(errors.length, 0, errors.join("\n"));
    const registryText = await readFile(
      path.join(dir, "registry", "registry.json"),
      "utf8",
    );
    assert.ok(!registryText.includes(server.tokens.reviewer));
  } finally {
    await browser.close();
    await server.close();
  }
  // A runner revision changes the meaning of validation: revoke old approvals at startup.
  const stateFile = path.join(dir, "registry", "registry.json");
  const persisted = JSON.parse(await readFile(stateFile, "utf8"));
  for (const release of persisted.releases)
    if (release.validation) release.validation.runnerDigest = "0".repeat(64);
  await writeFile(stateFile, JSON.stringify(persisted));
  const restarted = await startControl({ dir });
  try {
    assert.equal(Object.keys(restarted.registry.snapshot().active).length, 0);
    assert.ok(
      restarted.registry
        .snapshot()
        .releases.every((r) => r.status === "candidate"),
    );
    assert.ok(
      restarted.registry
        .snapshot()
        .history.some((h) => h.event === "invalidate"),
    );
  } finally {
    await restarted.close();
  }
});
