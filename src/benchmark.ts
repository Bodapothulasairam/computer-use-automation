import { digest, runnerDigest } from "./integrity.js";
export { digest } from "./integrity.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { replay, readPolicy } from "./engine.js";
import { startDemo } from "./demo-app.js";
import type { Capability, RunResult } from "./schema.js";
import type { Variant } from "./bindings.js";
import type { HandoffOptions } from "./handoff.js";
import { targets, Fault } from "./policy.js";

export const Scenarios = z.enum([
  "normal",
  "not_found",
  "invalid",
  "validation",
  "notice",
  "transient",
  "slow",
  "session",
  "handoff",
  "permission",
  "app_error",
  "unknown_dialog",
  "ambiguous",
  "wrong_member",
  "bad_output",
  "drift",
  "drift_late",
  "injection",
  "recovery_exhausted",
]);
export type Scenario = z.infer<typeof Scenarios>;
const expected: Partial<Record<Scenario, string>> = {
  not_found: "NOT_FOUND",
  invalid: "INVALID_INPUT",
  validation: "VALIDATION",
  session: "SESSION_EXPIRED",
  permission: "PERMISSION_DENIED",
  app_error: "APPLICATION_ERROR",
  unknown_dialog: "UNEXPECTED_DIALOG",
  ambiguous: "AMBIGUOUS_TARGET",
  wrong_member: "OUTPUT_CONTEXT_MISMATCH",
  bad_output: "OUTPUT_TYPE_MISMATCH",
  drift: "UI_DRIFT",
  drift_late: "UI_DRIFT",
  recovery_exhausted: "RECOVERY_EXHAUSTED",
};
export const automaticOperator: HandoffOptions = {
  timeoutMs: 10000,
  async onRequest(i) {
    const api = async (route: string, body: unknown) => {
      const response = await fetch(i.url + route, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + i.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Fault("TEST_OPERATOR_FAILED");
    };
    await api("/claim", {});
    await api("/action", {
      action: {
        kind: "click",
        target: targets.find((t) => t.name === "Restore session"),
      },
    });
    await api("/resume", {});
  },
};
export function outcome(result: RunResult) {
  return result.status === "success" ? "SUCCESS" : result.code;
}
export function correct(result: RunResult, scenario: Scenario, member: string) {
  if (expected[scenario])
    return (
      outcome(result) === expected[scenario] &&
      result.status ===
        (["not_found", "validation"].includes(scenario)
          ? "business_outcome"
          : "failure")
    );
  return (
    result.status === "success" &&
    result.outputs.savingsBalance === (member === "12345" ? 1250.75 : 9820.5) &&
    result.outputs.currency === "USD" &&
    Object.keys(result.outputs).length === 2
  );
}
export async function scenarioOptions(scenario: Scenario, member: string) {
  return {
    scenario:
      scenario === "handoff"
        ? "session"
        : scenario === "recovery_exhausted"
          ? "notice"
          : scenario === "invalid" || scenario === "not_found"
            ? "normal"
            : scenario,
    parameters: {
      memberId:
        scenario === "not_found"
          ? "00000"
          : scenario === "invalid"
            ? "1234"
            : member,
    },
    operator: scenario === "handoff" ? automaticOperator : undefined,
    policy:
      scenario === "recovery_exhausted"
        ? { ...(await readPolicy()), recoveryAttempts: 0 }
        : undefined,
  };
}
export type Trial = {
  index: number;
  scenario: Scenario;
  variant: Variant;
  delayMs: number;
  runId: string;
  expected: string;
  actual: string;
  passed: boolean;
  unsafeSuccess: boolean;
  durationMs: number;
  modelCalls: number;
  recoveries: number;
};
export type BenchmarkReport = {
  schemaVersion: 1;
  artifactDigest: string;
  runnerDigest: string;
  seed: number;
  count: number;
  passed: number;
  failed: number;
  unsafeSuccesses: number;
  modelCalls: number;
  recoveryAttempts: number;
  correctOutcomeRate: number;
  recoveryEligible: number;
  recoverySucceeded: number;
  recoveryRate: number | null;
  p50Ms: number;
  p95Ms: number;
  createdAt: string;
  environment: { node: string; platform: string; arch: string };
  operator: string;
  trials: Trial[];
};
export async function benchmark(
  artifact: Capability,
  options: {
    out: string;
    count?: number;
    seed?: number;
    progress?: (done: number, total: number) => void;
  },
) {
  const count = z
    .number()
    .int()
    .min(1)
    .max(1000)
    .parse(options.count ?? 100);
  const sourceDigest = await runnerDigest();
  const seed = z
    .number()
    .int()
    .min(0)
    .max(0xffffffff)
    .parse(options.seed ?? 20260916);
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const cases = Scenarios.options.flatMap((scenario) =>
    (["classic", "cards"] as const).map((variant) => ({ scenario, variant })),
  );
  // Seeded shuffle without dropping any scenario in a full cycle.
  for (let i = cases.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cases[i], cases[j]] = [cases[j]!, cases[i]!];
  }
  await mkdir(options.out, { recursive: true });
  const app = await startDemo();
  const trials: Trial[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const { scenario, variant } = cases[i % cases.length]!;
      const member = i % 2 ? "67890" : "12345";
      const delayMs = Math.floor(random() * 81);
      const result = await replay(artifact, {
        origin: app.origin,
        evidenceDir: options.out,
        variant,
        delayMs,
        ...(await scenarioOptions(scenario, member)),
      });
      const metrics = JSON.parse(
        await readFile(
          options.out + "/" + result.runId + "/metrics.json",
          "utf8",
        ),
      );
      const passed =
        correct(result, scenario, member) && metrics.modelCalls === 0;
      trials.push({
        index: i + 1,
        scenario,
        variant,
        delayMs,
        runId: result.runId,
        expected: expected[scenario] ?? "SUCCESS",
        actual: outcome(result),
        passed,
        unsafeSuccess:
          result.status === "success" && !correct(result, scenario, member),
        durationMs: metrics.durationMs,
        modelCalls: metrics.modelCalls,
        recoveries: metrics.recoveryAttempts,
      });
      options.progress?.(i + 1, count);
    }
  } finally {
    await app.close();
  }
  const latencies = trials.map((t) => t.durationMs).sort((a, b) => a - b);
  const recoveryTrials = trials.filter((t) =>
    ["notice", "transient", "slow", "handoff"].includes(t.scenario),
  );
  const report: BenchmarkReport = {
    schemaVersion: 1,
    artifactDigest: digest(artifact),
    runnerDigest: sourceDigest,
    seed,
    count,
    passed: trials.filter((t) => t.passed).length,
    failed: trials.filter((t) => !t.passed).length,
    unsafeSuccesses: trials.filter((t) => t.unsafeSuccess).length,
    modelCalls: trials.reduce((n, t) => n + t.modelCalls, 0),
    recoveryAttempts: trials.reduce((n, t) => n + t.recoveries, 0),
    correctOutcomeRate: trials.filter((t) => t.passed).length / count,
    recoveryEligible: recoveryTrials.length,
    recoverySucceeded: recoveryTrials.filter((t) => t.passed).length,
    recoveryRate: recoveryTrials.length
      ? recoveryTrials.filter((t) => t.passed).length / recoveryTrials.length
      : null,
    p50Ms: latencies[Math.ceil(count * 0.5) - 1]!,
    p95Ms: latencies[Math.ceil(count * 0.95) - 1]!,
    createdAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    operator: "automated stand-in; no human participation claimed",
    trials,
  };
  await writeFile(
    options.out + "/benchmark.json",
    JSON.stringify(report, null, 2),
  );
  return report;
}
