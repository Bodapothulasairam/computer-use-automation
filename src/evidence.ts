import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Observation, RunResult, Action } from "./schema.js";

// Deliberate allowlist: never serialize Error objects, model free text, input values,
// page text, URLs with queries, screenshots, response bodies, or extracted outputs.
export class Evidence {
  readonly started = performance.now();
  modelCalls = 0;
  recoveryAttempts = 0;
  actions = 0;
  readonly runId = randomUUID();
  readonly dir: string;
  constructor(
    base: string,
    readonly mode: "discovery" | "replay",
  ) {
    this.dir = path.join(base, this.runId);
  }
  async init() {
    await mkdir(this.dir, { recursive: true });
    await this.event("start", { mode: this.mode });
  }
  async event(event: string, data: Record<string, unknown> = {}) {
    if (event === "recovery") this.recoveryAttempts++;
    if (event === "action") this.actions++;
    await appendFile(
      path.join(this.dir, "events.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        runId: this.runId,
        event,
        ...data,
      }) + "\n",
    );
  }
  async action(step: string, a: Action, actor: string, reason: string) {
    await this.event("action", {
      step,
      actor,
      kind: a.kind,
      target: a.target,
      parameter: a.kind === "fill" ? a.parameter : undefined,
      reason,
    });
  }
  async snapshot(observation: Observation | null) {
    await writeFile(
      path.join(this.dir, "failure.snapshot.json"),
      JSON.stringify(
        { format: "redacted-semantic-dom-v1", observation },
        null,
        2,
      ),
    );
  }
  async result(result: RunResult) {
    const safe =
      result.status === "success"
        ? {
            ...result,
            outputs: Object.fromEntries(
              Object.keys(result.outputs).map((k) => [k, "[REDACTED]"]),
            ),
          }
        : result;
    await writeFile(
      path.join(this.dir, "result.json"),
      JSON.stringify(safe, null, 2),
    );
    await this.event("finish", {
      status: result.status,
      code: "code" in result ? result.code : undefined,
    });
    await writeFile(
      path.join(this.dir, "metrics.json"),
      JSON.stringify(
        {
          mode: this.mode,
          durationMs: Math.round(performance.now() - this.started),
          modelCalls: this.modelCalls,
          recoveryAttempts: this.recoveryAttempts,
          actions: this.actions,
        },
        null,
        2,
      ),
    );
  }
}
