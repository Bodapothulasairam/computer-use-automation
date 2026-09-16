import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { startDemo } from "../src/demo-app.js";
import { replay, discover, readPolicy } from "../src/engine.js";
import { fixture } from "../src/fixture.js";
import { Capability, memberTarget, heading } from "../src/schema.js";
import { Policy, Fault, targets } from "../src/policy.js";
import { BrowserSurface } from "../src/surface.js";
import { Evidence } from "../src/evidence.js";
import { Decision, safeGoal } from "../src/model.js";
const base = "runs/tests";
await mkdir(base, { recursive: true });
const app = await startDemo();
test.after(() => app.close());
const opts = (scenario = "normal", memberId = "12345") => ({
  origin: app.origin,
  parameters: { memberId },
  evidenceDir: base,
  scenario,
});
async function events(runId: string) {
  return readFile(base + "/" + runId + "/events.jsonl", "utf8");
}

test("artifact rejects unknown versions, dangling inputs, extra data, duplicate ids", () => {
  assert.equal(Capability.safeParse(fixture).success, true);
  for (const patch of [
    { schemaVersion: "2" },
    { secret: "CANARY" },
    { steps: [...fixture.steps, fixture.steps[0]] },
    { inputs: {} },
  ])
    assert.equal(Capability.safeParse({ ...fixture, ...patch }).success, false);
});
test("policy restricts scheme, origin, exact routes, query keys, target and irreversible action", async () => {
  const p = new Policy(app.origin, await readPolicy());
  p.url(app.origin + "/legacy/member?member=12345");
  for (const url of [
    "https://example.com/app",
    app.origin + "/app/evil",
    app.origin + "/app?token=secret",
    "javascript:alert(1)",
    app.origin.replace("127.0.0.1", "localhost") + "/app",
    app.origin + "/legacy/transfer",
    app.origin.replace("http://", "http://user:pass@") + "/app",
  ])
    assert.throws(() => p.url(url), Fault);
  assert.throws(
    () =>
      p.action(
        {
          kind: "click",
          target: targets.find((t) => t.name === "Transfer funds")!,
        },
        "automation",
      ),
    /RISKY_ACTION_BLOCKED/,
  );
  assert.throws(
    () =>
      p.action(
        {
          kind: "click",
          target: targets.find((t) => t.name === "Transfer funds")!,
        },
        "human",
      ),
    /RISKY_ACTION_BLOCKED/,
  );
  assert.throws(
    () => p.target({ ...memberTarget, name: "Password" }),
    /TARGET_DENIED/,
  );
});
test("replay returns typed live outputs for a different parameter, without any model", async () => {
  const result = await replay(fixture, opts("normal", "67890"));
  assert.equal(result.status, "success", JSON.stringify(result));
  if (result.status === "success")
    assert.deepEqual(result.outputs, {
      savingsBalance: 9820.5,
      currency: "USD",
    });
  const log = await events(result.runId);
  assert.ok(!log.includes("model_decision"));
  assert.ok(!log.includes("67890"));
  assert.ok(!log.includes("9820.5"));
});
test("not found is a business outcome, not a failure or escalation", async () => {
  const r = await replay(fixture, opts("normal", "00000"));
  assert.equal(r.status, "business_outcome");
  if (r.status === "business_outcome") assert.equal(r.code, "NOT_FOUND");
  assert.ok(!(await events(r.runId)).includes("intervention"));
});
test("application validation is a business outcome", async () => {
  const r = await replay(fixture, opts("validation"));
  assert.equal(r.status, "business_outcome");
  if (r.status === "business_outcome") assert.equal(r.code, "VALIDATION");
});
test("invalid parameters fail before interacting with a browser", async () => {
  const r = await replay(fixture, opts("normal", "PII_CANARY_9002221234"));
  assert.equal(r.status, "failure");
  if (r.status === "failure") assert.equal(r.code, "INVALID_INPUT");
  assert.ok(!(await events(r.runId)).includes("PII_CANARY"));
});
for (const scenario of ["notice", "transient", "slow"])
  test("bounded recovery: " + scenario, async () => {
    const r = await replay(fixture, opts(scenario));
    assert.equal(r.status, "success", JSON.stringify(r));
    assert.ok((await events(r.runId)).includes('"recovery"'));
  });
for (const [scenario, code] of [
  ["permission", "PERMISSION_DENIED"],
  ["session", "SESSION_EXPIRED"],
  ["app_error", "APPLICATION_ERROR"],
  ["unknown_dialog", "UNEXPECTED_DIALOG"],
  ["ambiguous", "AMBIGUOUS_TARGET"],
])
  test(
    "hard failure has context and redacted snapshot: " + scenario,
    async () => {
      const r = await replay(fixture, opts(scenario));
      assert.equal(r.status, "failure", JSON.stringify(r));
      if (r.status === "failure") {
        assert.equal(r.code, code);
        assert.equal(r.step, "step-2" === r.step ? "step-2" : "step-3");
        assert.ok(r.interventionId);
      }
      const snapshot = await readFile(
        base + "/" + r.runId + "/failure.snapshot.json",
        "utf8",
      );
      assert.ok(snapshot.includes("redacted-semantic-dom-v1"));
      assert.ok(!snapshot.includes("12345"));
      assert.ok(!snapshot.includes("Demo Member"));
    },
  );
test("forged checkpoint cannot declare success early", async () => {
  const bad = structuredClone(fixture);
  bad.success.target = heading("Member search");
  const r = await replay(bad, opts());
  assert.equal(r.status, "failure");
  if (r.status === "failure") assert.equal(r.code, "CHECKPOINT_DENIED");
});
test("missing final transition fails its checkpoint", async () => {
  const bad = structuredClone(fixture);
  bad.steps.pop();
  const r = await replay(bad, {
    ...opts(),
    policy: { ...(await readPolicy()), stepTimeoutMs: 250 },
  });
  assert.equal(r.status, "failure");
  if (r.status === "failure") assert.equal(r.code, "CHECKPOINT_TIMEOUT");
});
test("zero recovery allowance stops on the interstitial", async () => {
  const r = await replay(fixture, {
    ...opts("notice"),
    policy: { ...(await readPolicy()), recoveryAttempts: 0 },
  });
  assert.equal(r.status, "failure");
  if (r.status === "failure") assert.equal(r.code, "RECOVERY_EXHAUSTED");
});
test("live takeover keeps session identity, denies unowned actions, records manual action and resumes", async () => {
  let called = 0,
    operatorError: unknown;
  const r = await replay(fixture, {
    ...opts("session"),
    operator: {
      timeoutMs: 15000,
      onRequest: async (i) => {
        try {
          called++;
          const api = async (path: string, data?: unknown) =>
            fetch(i.url + path, {
              method: data ? "POST" : "GET",
              headers: {
                Authorization: "Bearer " + i.token,
                "Content-Type": "application/json",
              },
              body: data ? JSON.stringify(data) : undefined,
            });
          assert.equal((await fetch(i.url + "/state")).status, 401);
          const before = (await (await api("/state")).json()) as any;
          assert.equal(before.owner, "paused");
          assert.equal(before.sessionId, i.sessionId);
          assert.equal(before.observation.route, "/legacy/member");
          assert.equal(before.observation.headings.length, 1);
          assert.equal((await api("/resume", {})).status, 409);
          const restore = {
            kind: "click",
            target: targets.find((t) => t.name === "Restore session")!,
          };
          assert.equal((await api("/action", { action: restore })).status, 409);
          assert.equal((await api("/claim", {})).status, 200);
          assert.equal((await api("/claim", {})).status, 409);
          const premature = await api("/resume", {});
          assert.equal(premature.status, 409);
          assert.equal(
            ((await premature.json()) as any).code,
            "RECOVERY_NOT_VERIFIED",
          );
          assert.equal(
            (
              await api("/action", {
                action: {
                  kind: "click",
                  target: targets.find((t) => t.name === "Transfer funds")!,
                },
              })
            ).status,
            409,
          );
          assert.equal((await api("/action", { action: restore })).status, 200);
          const after = (await (await api("/state")).json()) as any;
          assert.equal(after.sessionId, before.sessionId);
          assert.equal(after.observation.status, "ready");
          assert.equal((await api("/resume", {})).status, 200);
        } catch (e) {
          operatorError = e;
          throw e;
        }
      },
    },
  });
  if (operatorError) throw operatorError;
  assert.equal(called, 1);
  assert.equal(r.status, "success", JSON.stringify(r));
  const log = await events(r.runId);
  for (const event of [
    "intervention_requested",
    "control_claimed",
    "operator_intervention",
    "control_released",
  ])
    assert.ok(log.includes(event));
});
test("operator timeout fails closed", async () => {
  const r = await replay(fixture, {
    ...opts("session"),
    operator: { timeoutMs: 100, onRequest: () => {} },
  });
  assert.equal(r.status, "failure");
});
test("browser enforces ownership and blocks direct external network requests", async () => {
  const evidence = new Evidence(base, "replay");
  await evidence.init();
  const s = new BrowserSurface(
    new Policy(app.origin, await readPolicy()),
    evidence,
  );
  try {
    await s.open(app.origin + "/app");
    s.owner = "paused";
    await assert.rejects(
      s.perform(
        { kind: "fill", target: memberTarget, parameter: "memberId" },
        { memberId: "12345" },
        "automation",
      ),
      /CONTROL_NOT_OWNED/,
    );
    s.owner = "automation";
    await s.page.goto("https://example.com/").catch(() => {});
    assert.equal(s.networkViolation, true);
  } finally {
    await s.close();
  }
});
test("discovery records only successful observed actions; fixture provenance is explicit", async () => {
  const answers = [
    {
      kind: "fill",
      target: "Member number",
      parameter: "memberId",
      expected: "Member search",
      reason: "enter_input",
    },
    {
      kind: "click",
      target: "Search",
      parameter: "none",
      expected: "Member details",
      reason: "open_member",
    },
    {
      kind: "click",
      target: "Balance summary",
      parameter: "none",
      expected: "Balance summary",
      reason: "read_summary",
    },
    {
      kind: "finish",
      target: "none",
      parameter: "none",
      expected: "none",
      reason: "goal_verified",
    },
  ];
  let calls = 0;
  const r = await discover("Find member 12345 savings balance", opts(), () => ({
    model: "test-only",
    provenance: "test-fixture",
    decide: async (goal, obs) => {
      assert.ok(!goal.includes("12345"));
      assert.ok(obs.headings.length);
      return Decision.parse(answers[calls++]);
    },
  }));
  assert.equal(r.result.status, "success", JSON.stringify(r.result));
  assert.equal(calls, 4);
  assert.equal(r.artifact?.steps.length, 3);
  assert.equal(r.artifact?.provenance.kind, "test-fixture");
});
test("discovery does not trust a premature finish and does not emit an artifact", async () => {
  const r = await discover("Read balance", opts(), () => ({
    model: "test-only",
    provenance: "test-fixture",
    decide: async () =>
      Decision.parse({
        kind: "finish",
        target: "none",
        parameter: "none",
        expected: "none",
        reason: "goal_verified",
      }),
  }));
  assert.equal(r.result.status, "failure");
  assert.equal(r.artifact, undefined);
});
test("goal redacts declared input and common numeric/email data", () => {
  const goal = safeGoal("Find 12345 for test@example.com phone 555-123-4567", {
    memberId: "12345",
  });
  assert.ok(!goal.includes("12345"));
  assert.ok(!goal.includes("test@example.com"));
  assert.ok(!goal.includes("555-123-4567"));
});
test("all saved test evidence excludes synthetic PII and credential canaries", async () => {
  for (const dir of await readdir(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of await readdir(base + "/" + dir.name)) {
      const text = await readFile(base + "/" + dir.name + "/" + file, "utf8");
      for (const secret of [
        "12345",
        "67890",
        "Demo Member",
        "PII_CANARY_9002221234",
        "sk-test-secret",
      ])
        assert.ok(
          !text.includes(secret),
          dir.name + "/" + file + " leaked " + secret,
        );
    }
  }
});

test("discovery resumes after manual UI actions and the resulting artifact replays", async () => {
  let calls = 0,
    operatorError: unknown;
  const d = await discover(
    "Read savings balance",
    {
      ...opts(),
      operator: {
        timeoutMs: 10000,
        onRequest: async (i) => {
          try {
            const api = (path: string, data: unknown) =>
              fetch(i.url + path, {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + i.token,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(data),
              });
            assert.equal((await api("/claim", {})).status, 200);
            assert.equal(
              (
                await api("/action", {
                  action: {
                    kind: "fill",
                    target: memberTarget,
                    parameter: "memberId",
                  },
                  parameters: { memberId: "12345" },
                })
              ).status,
              200,
            );
            assert.equal(
              (
                await api("/action", {
                  action: {
                    kind: "click",
                    target: targets.find((t) => t.name === "Search")!,
                  },
                })
              ).status,
              200,
            );
            assert.equal((await api("/resume", {})).status, 200);
          } catch (e) {
            operatorError = e;
            throw e;
          }
        },
      },
    },
    () => ({
      model: "test-only",
      provenance: "test-fixture",
      decide: async () => {
        calls++;
        return Decision.parse(
          calls === 1
            ? {
                kind: "escalate",
                target: "none",
                parameter: "none",
                expected: "none",
                reason: "blocked",
              }
            : calls === 2
              ? {
                  kind: "click",
                  target: "Balance summary",
                  parameter: "none",
                  expected: "Balance summary",
                  reason: "read_summary",
                }
              : {
                  kind: "finish",
                  target: "none",
                  parameter: "none",
                  expected: "none",
                  reason: "goal_verified",
                },
        );
      },
    }),
  );
  if (operatorError) throw operatorError;
  assert.equal(d.result.status, "success", JSON.stringify(d.result));
  assert.equal(d.artifact?.steps.length, 3);
  assert.equal(d.artifact?.steps[0]?.rationale, "operator_intervention");
  assert.equal(
    (await replay(d.artifact, opts("normal", "67890"))).status,
    "success",
  );
});
test("discovery stops at its step budget", async () => {
  const r = await discover(
    "Read balance",
    { ...opts(), policy: { ...(await readPolicy()), maxSteps: 1 } },
    () => ({
      model: "test-only",
      provenance: "test-fixture",
      decide: async () =>
        Decision.parse({
          kind: "fill",
          target: "Member number",
          parameter: "memberId",
          expected: "Member search",
          reason: "enter_input",
        }),
    }),
  );
  assert.equal(r.result.status, "failure");
  if (r.result.status === "failure") assert.equal(r.result.code, "MAX_STEPS");
  assert.equal(r.artifact, undefined);
});
test("run deadline fails closed", async () => {
  const r = await replay(fixture, {
    ...opts(),
    policy: { ...(await readPolicy()), timeoutMs: 100 },
  });
  assert.equal(r.status, "failure");
  if (r.status === "failure") assert.equal(r.code, "RUN_TIMEOUT");
});

for (const [scenario, expected] of [
  ["wrong_member", "OUTPUT_CONTEXT_MISMATCH"],
  ["bad_output", "OUTPUT_TYPE_MISMATCH"],
])
  test("output validation: " + scenario, async () => {
    const r = await replay(fixture, opts(scenario));
    assert.equal(r.status, "failure");
    if (r.status === "failure") assert.equal(r.code, expected);
  });
