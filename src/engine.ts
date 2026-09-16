import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  Capability,
  contract,
  heading,
  type Action,
  type Checkpoint,
  type Observation,
  type RunResult,
} from "./schema.js";
import { Policy, PolicyConfig, Fault, targets } from "./policy.js";
import { Evidence } from "./evidence.js";
import { BrowserSurface } from "./surface.js";
import { Handoff, type HandoffOptions } from "./handoff.js";
import { safeGoal, type Discoverer } from "./model.js";
export type Options = {
  origin: string;
  parameters: Record<string, string>;
  evidenceDir?: string;
  scenario?: string;
  headless?: boolean;
  operator?: HandoffOptions;
  policy?: PolicyConfig;
  entryPath?: string;
};
export async function readPolicy() {
  return PolicyConfig.parse(
    JSON.parse(
      await readFile(new URL("../config/policy.json", import.meta.url), "utf8"),
    ),
  );
}
class Business extends Error {
  constructor(readonly code: "NOT_FOUND" | "VALIDATION") {
    super(code);
  }
}
class Runtime {
  readonly evidence: Evidence;
  surface!: BrowserSurface;
  policy!: Policy;
  step = "initialize";
  observed: Observation | null = null;
  deadline = 0;
  constructor(
    readonly options: Options,
    mode: "discovery" | "replay",
  ) {
    this.evidence = new Evidence(options.evidenceDir ?? "runs", mode);
  }
  async init() {
    await this.evidence.init();
    this.policy = new Policy(
      this.options.origin,
      this.options.policy ?? (await readPolicy()),
    );
    this.deadline = Date.now() + this.policy.config.timeoutMs;
    this.surface = new BrowserSurface(this.policy, this.evidence);
  }
  budget() {
    if (Date.now() > this.deadline) throw new Fault("RUN_TIMEOUT");
  }
  inputs() {
    if (
      Object.keys(this.options.parameters).join() !== "memberId" ||
      typeof this.options.parameters.memberId !== "string" ||
      !/^\d{5}$/.test(this.options.parameters.memberId)
    )
      throw new Fault("INVALID_INPUT");
  }
  async open(entryPath = "/app") {
    this.inputs();
    await this.surface.open(
      this.options.origin + entryPath,
      this.options.scenario,
      this.options.headless ?? true,
    );
  }
  async observe() {
    this.budget();
    this.observed = await this.surface.observe();
    return this.observed;
  }
  async state() {
    const o = await this.observe();
    if (o.status === "not_found") throw new Business("NOT_FOUND");
    if (o.status === "validation") throw new Business("VALIDATION");
    const hard: Record<string, string> = {
      permission: "PERMISSION_DENIED",
      session_expired: "SESSION_EXPIRED",
      app_error: "APPLICATION_ERROR",
      unknown_dialog: "UNEXPECTED_DIALOG",
    };
    if (hard[o.status]) throw new Fault(hard[o.status]!);
    return o;
  }
  async settle(expected: Checkpoint) {
    const until = Math.min(
      this.deadline,
      Date.now() + this.policy.config.stepTimeoutMs,
    );
    let recoveries = 0;
    while (Date.now() <= until) {
      const o = await this.state();
      if (["notice", "transient", "loading"].includes(o.status)) {
        if (recoveries >= this.policy.config.recoveryAttempts)
          throw new Fault("RECOVERY_EXHAUSTED");
        const name = o.status === "notice" ? "Continue" : "Retry";
        const target = targets.find(
          (t) => t.role === "link" && t.name === name,
        )!;
        recoveries++;
        await this.evidence.event("recovery", {
          step: this.step,
          condition: o.status,
          attempt: recoveries,
          action: name,
        });
        await this.surface.perform(
          { kind: "click", target },
          this.options.parameters,
          "automation",
        );
        continue;
      }
      if (await this.surface.check(expected)) return;
      await new Promise((r) => setTimeout(r, 75));
    }
    throw new Fault(
      Date.now() > this.deadline ? "RUN_TIMEOUT" : "CHECKPOINT_TIMEOUT",
    );
  }
  async handoff(
    error: unknown,
    onAction?: (action: Action, observation: Observation) => Promise<void>,
  ): Promise<boolean> {
    if (error instanceof Business) return false;
    if (this.options.operator) {
      const resumed = await new Handoff(
        this.surface,
        this.evidence,
        this.options.operator,
        onAction,
      ).request(code(error), this.step, this.observed);
      if (resumed) {
        this.deadline = Date.now() + this.policy.config.timeoutMs;
        return true;
      }
    }
    return false;
  }
  async failure(error: unknown, expected: string): Promise<RunResult> {
    if (error instanceof Business) {
      const result: RunResult = {
        status: "business_outcome",
        runId: this.evidence.runId,
        code: error.code,
        step: this.step,
      };
      await this.evidence.result(result);
      return result;
    }
    const id = randomUUID();
    // A durable local queue entry remains even when no operator is attached.
    await this.evidence.snapshot(this.observed);
    await this.evidence.event("intervention_queued", {
      capabilityId: "member-savings-balance",
      id,
      reason: code(error),
      step: this.step,
      sessionId: this.surface?.sessionId,
      liveSessionAvailable: false,
    });
    const result: RunResult = {
      status: "failure",
      runId: this.evidence.runId,
      code: code(error),
      step: this.step,
      expected,
      observed: this.observed,
      interventionId: id,
    };
    await this.evidence.result(result);
    return result;
  }
  async success(a: Capability): Promise<RunResult> {
    await this.settle(a.success);
    const member = await this.surface.extract(
      { frame: "workspace", strategy: "table-label", name: "Member number" },
      "string",
    );
    if (member !== this.options.parameters.memberId)
      throw new Fault("OUTPUT_CONTEXT_MISMATCH");
    const outputs: Record<string, string | number> = {};
    for (const [name, output] of Object.entries(a.outputs))
      outputs[name] = await this.surface.extract(output.target, output.type);
    const result: RunResult = {
      status: "success",
      runId: this.evidence.runId,
      outputs,
    };
    await this.evidence.result(result);
    return result;
  }
}
function code(e: unknown) {
  return e instanceof Fault
    ? e.code
    : (e as Error)?.name === "TimeoutError"
      ? "SURFACE_TIMEOUT"
      : (e as Error)?.name === "AbortError"
        ? "RUN_TIMEOUT"
        : "EXECUTION_ERROR";
}

export async function replay(
  raw: unknown,
  options: Options,
): Promise<RunResult> {
  const r = new Runtime(options, "replay");
  await r.init();
  let expected = "Valid capability and input contract";
  try {
    const parsed = Capability.safeParse(raw);
    if (!parsed.success) throw new Fault("INVALID_ARTIFACT");
    const a = parsed.data;
    r.policy.capability(a);
    await r.open(a.application.entryPath);
    for (const step of a.steps) {
      r.step = step.id;
      expected = step.expect.target.name;
      r.budget();
      try {
        await r.state();
        await r.evidence.action(
          step.id,
          step.action,
          "automation",
          "deterministic_replay",
        );
        await r.surface.perform(step.action, options.parameters, "automation");
        await r.settle(step.expect);
      } catch (error) {
        if (!(await r.handoff(error))) throw error;
        // Never repeat a possibly completed write after manual recovery.
        await r.settle(step.expect);
      }
    }
    r.step = "success";
    return await r.success(a);
  } catch (error) {
    return await r.failure(error, expected);
  } finally {
    await r.surface?.close();
  }
}
export async function discover(
  goal: string,
  options: Options,
  makeModel: (e: Evidence) => Discoverer,
): Promise<{ result: RunResult; artifact?: Capability }> {
  const r = new Runtime(options, "discovery");
  await r.init();
  const steps: Capability["steps"] = [];
  try {
    await r.open(options.entryPath ?? "/app");
    const model = makeModel(r.evidence);
    let repeated = 0,
      last = "";
    for (let n = 0; n < r.policy.config.maxSteps; n++) {
      r.step = "discover-" + (n + 1);
      try {
        const observation = await r.state();
        const decision = await model.decide(
          safeGoal(goal, options.parameters),
          observation,
          steps.map((s) => s.action),
          AbortSignal.timeout(Math.max(1, r.deadline - Date.now())),
        );
        if (decision.kind === "escalate") throw new Fault("MODEL_STUCK");
        if (decision.kind === "finish") {
          const artifact = Capability.parse({
            schemaVersion: "1.0",
            id: "member-savings-balance",
            version: "1.0.0",
            description:
              "Look up a member and read the savings balance from the reviewed summary screen.",
            application: {
              product: "legacy-ledger",
              version: "1",
              profile: "ledger-v1",
              entryPath: "/app",
            },
            ...contract,
            steps,
            provenance: {
              kind: model.provenance,
              model: model.model,
              runId: r.evidence.runId,
              createdAt: new Date().toISOString(),
            },
          });
          r.policy.capability(artifact);
          const result = await r.success(artifact);
          await writeFile(
            r.evidence.dir + "/capability.json",
            JSON.stringify(artifact, null, 2),
          );
          return { result, artifact };
        }
        const target = targets.find(
          (t) =>
            t.name === decision.target &&
            (decision.kind === "fill"
              ? t.strategy === "table-label"
              : t.role === "button" || t.role === "link"),
        );
        if (!target) throw new Fault("MODEL_TARGET_INVALID");
        const action: Action =
          decision.kind === "fill"
            ? { kind: "fill", target, parameter: decision.parameter }
            : { kind: "click", target };
        const fingerprint = JSON.stringify(action);
        repeated = fingerprint === last ? repeated + 1 : 0;
        last = fingerprint;
        if (repeated >= 2) throw new Fault("MODEL_DEAD_END");
        if (decision.expected === "none") throw new Fault("MISSING_CHECKPOINT");
        const checkpointTarget =
          action.kind === "fill"
            ? observation.headings.find((t) => t.role === "heading")
            : heading(decision.expected);
        if (!checkpointTarget) throw new Fault("MISSING_CHECKPOINT");
        const expect: Checkpoint = {
          target: checkpointTarget,
          condition: "visible",
        };
        await r.evidence.action(r.step, action, "automation", decision.reason);
        await r.surface.perform(action, options.parameters, "automation");
        steps.push({
          id: "step-" + (steps.length + 1),
          action,
          expect,
          rationale: decision.reason,
        });
        await r.settle(expect);
      } catch (error) {
        if (error instanceof Business) throw error;
        const resumed = await r.handoff(error, async (action, obs) => {
          // Recovery actions stay in the exception policy, not the happy-path flow.
          if (
            ["Restore session", "Continue", "Retry"].includes(
              action.target.name,
            )
          )
            return;
          const target = obs.headings.find((t) =>
            ["Member search", "Member details", "Balance summary"].includes(
              t.name,
            ),
          );
          if (!target) throw new Fault("MANUAL_CHECKPOINT_MISSING");
          r.policy.action(action, "automation");
          steps.push({
            id: "step-" + (steps.length + 1),
            action,
            expect: { target, condition: "visible" },
            rationale: "operator_intervention",
          });
        });
        if (!resumed) throw error;
        repeated = 0;
        last = "";
      }
    }
    throw new Fault("MAX_STEPS");
  } catch (error) {
    return {
      result: await r.failure(error, "Goal verified on Balance summary"),
    };
  } finally {
    await r.surface?.close();
  }
}
