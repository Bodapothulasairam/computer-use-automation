import { mkdir, readFile, writeFile, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Capability } from "./schema.js";
import { digest, Scenarios, type BenchmarkReport } from "./benchmark.js";
import { Policy, Fault } from "./policy.js";
import { readPolicy } from "./engine.js";
import { runnerDigest } from "./integrity.js";

export const ReleaseKey = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
    version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/),
  })
  .strict();
const Validation = z
  .object({
    artifactDigest: z.string().length(64),
    runnerDigest: z.string().length(64),
    passed: z.boolean(),
    count: z.number().int(),
    failed: z.number().int(),
    modelCalls: z.number().int(),
    unsafeSuccesses: z.number().int(),
    at: z.string(),
    seed: z.number(),
    runIds: z.array(z.string().uuid()),
  })
  .strict();
const Release = z
  .object({
    artifact: Capability,
    digest: z.string().length(64),
    status: z.enum(["candidate", "validated", "approved"]),
    validation: Validation.optional(),
    createdAt: z.string(),
    approvedAt: z.string().optional(),
  })
  .strict();
const State = z
  .object({
    schemaVersion: z.literal(1),
    releases: z.array(Release),
    active: z.record(z.string(), z.string()),
    history: z.array(
      z.object({
        at: z.string(),
        event: z.enum([
          "import",
          "validate",
          "approve",
          "activate",
          "rollback",
          "invalidate",
        ]),
        id: z.string(),
        version: z.string(),
        digest: z.string(),
      }),
    ),
  })
  .strict();
type State = z.infer<typeof State>;
export type Release = z.infer<typeof Release>;
export class Registry {
  private state: State = {
    schemaVersion: 1,
    releases: [],
    active: {},
    history: [],
  };
  private locked = false;
  private committed: State = structuredClone(this.state);
  private sourceDigest = "";
  constructor(readonly dir: string) {}
  async open() {
    await mkdir(this.dir, { recursive: true });
    try {
      await mkdir(path.join(this.dir, ".lock"));
      this.locked = true;
    } catch {
      throw new Fault("REGISTRY_LOCKED");
    }
    try {
      try {
        this.state = State.parse(
          JSON.parse(
            await readFile(path.join(this.dir, "registry.json"), "utf8"),
          ),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Fault("REGISTRY_CORRUPT");
      }
      this.assertIntegrity();
      this.committed = structuredClone(this.state);
      this.sourceDigest = await runnerDigest();
      let stale = false;
      for (const release of this.state.releases)
        if (
          release.status !== "candidate" &&
          release.validation?.runnerDigest !== this.sourceDigest
        ) {
          release.status = "candidate";
          release.validation!.passed = false;
          delete release.approvedAt;
          if (
            this.state.active[release.artifact.id] === release.artifact.version
          )
            delete this.state.active[release.artifact.id];
          this.history("invalidate", release);
          stale = true;
        }
      if (stale) await this.persist();
    } catch (e) {
      await this.close();
      throw e;
    }
    return this;
  }
  private assertIntegrity() {
    const keys = new Set<string>();
    for (const release of this.state.releases) {
      const key = release.artifact.id + "@" + release.artifact.version;
      if (keys.has(key) || release.digest !== digest(release.artifact))
        throw new Fault("REGISTRY_CORRUPT");
      keys.add(key);
      if (
        release.status !== "candidate" &&
        (!release.validation?.passed ||
          release.validation.artifactDigest !== release.digest ||
          release.validation.count < 38 ||
          release.validation.failed !== 0 ||
          release.validation.modelCalls !== 0 ||
          release.validation.unsafeSuccesses !== 0)
      )
        throw new Fault("REGISTRY_CORRUPT");
    }
    for (const [id, version] of Object.entries(this.state.active))
      if (
        !this.state.releases.some(
          (r) =>
            r.artifact.id === id &&
            r.artifact.version === version &&
            r.status === "approved",
        )
      )
        throw new Fault("REGISTRY_CORRUPT");
  }
  private async persist() {
    try {
      this.assertIntegrity();
      const file = path.join(this.dir, "registry." + randomUUID() + ".tmp");
      await writeFile(file, JSON.stringify(this.state, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(file, path.join(this.dir, "registry.json"));
      this.committed = structuredClone(this.state);
    } catch (e) {
      this.state = structuredClone(this.committed);
      throw e;
    }
  }
  snapshot() {
    this.assertIntegrity();
    return structuredClone(this.state);
  }
  get(id: string, version?: string): Release {
    const selected = version ?? this.state.active[id];
    if (!selected) throw new Fault("NO_ACTIVE_RELEASE");
    ReleaseKey.parse({ id, version: selected });
    this.assertIntegrity();
    const release = this.state.releases.find(
      (r) => r.artifact.id === id && r.artifact.version === selected,
    );
    if (!release) throw new Fault("RELEASE_NOT_FOUND");
    return structuredClone(release);
  }
  private history(event: State["history"][number]["event"], r: Release) {
    this.state.history.push({
      at: new Date().toISOString(),
      event,
      id: r.artifact.id,
      version: r.artifact.version,
      digest: r.digest,
    });
  }
  async import(raw: unknown) {
    const artifact = Capability.parse(raw);
    ReleaseKey.parse({ id: artifact.id, version: artifact.version });
    await new Policy("http://127.0.0.1:1", await readPolicy()).capability(
      artifact,
    );
    if (
      this.state.releases.some(
        (r) =>
          r.artifact.id === artifact.id &&
          r.artifact.version === artifact.version,
      )
    )
      throw new Fault("VERSION_EXISTS");
    const release: Release = {
      artifact,
      digest: digest(artifact),
      status: "candidate",
      createdAt: new Date().toISOString(),
    };
    this.state.releases.push(release);
    this.history("import", release);
    await this.persist();
    return structuredClone(release);
  }
  async validate(
    id: string,
    version: string,
    run: (artifact: Capability) => Promise<BenchmarkReport>,
  ) {
    const release = this.get(id, version);
    if (release.status === "approved") throw new Fault("RELEASE_IMMUTABLE");
    const report = await run(release.artifact);
    if (report.artifactDigest !== release.digest)
      throw new Fault("DIGEST_MISMATCH");
    if (report.runnerDigest !== this.sourceDigest)
      throw new Fault("RUNNER_CHANGED");
    const coverage = new Set(
      report.trials.map((t) => t.scenario + ":" + t.variant),
    );
    const passed =
      report.count >= 38 &&
      report.trials.length === report.count &&
      report.failed === 0 &&
      report.modelCalls === 0 &&
      report.unsafeSuccesses === 0 &&
      report.trials.every(
        (t) => t.passed && t.modelCalls === 0 && !t.unsafeSuccess,
      ) &&
      Scenarios.options.every(
        (s) => coverage.has(s + ":classic") && coverage.has(s + ":cards"),
      );
    const index = this.state.releases.findIndex(
      (r) => r.digest === release.digest,
    );
    const changed = {
      ...release,
      status: passed ? ("validated" as const) : ("candidate" as const),
      validation: {
        artifactDigest: release.digest,
        runnerDigest: report.runnerDigest,
        passed,
        count: report.count,
        failed: report.failed,
        modelCalls: report.modelCalls,
        unsafeSuccesses: report.unsafeSuccesses,
        at: new Date().toISOString(),
        seed: report.seed,
        runIds: report.trials.map((t) => t.runId),
      },
    };
    this.state.releases[index] = changed;
    this.history("validate", changed);
    await this.persist();
    return structuredClone(changed);
  }
  async approve(id: string, version: string) {
    const r = this.get(id, version);
    if (r.status !== "validated" || !r.validation?.passed)
      throw new Fault("VALIDATION_REQUIRED");
    const next = {
      ...r,
      status: "approved" as const,
      approvedAt: new Date().toISOString(),
    };
    this.state.releases[
      this.state.releases.findIndex((x) => x.digest === r.digest)
    ] = next;
    this.history("approve", next);
    await this.persist();
    return next;
  }
  async activate(id: string, version: string, rollback = false) {
    const r = this.get(id, version);
    if (r.status !== "approved") throw new Fault("APPROVAL_REQUIRED");
    if (
      rollback &&
      !this.state.history.some(
        (h) => h.event === "activate" && h.id === id && h.version === version,
      )
    )
      throw new Fault("NOT_PREVIOUSLY_ACTIVE");
    if (this.state.active[id] === version) throw new Fault("ALREADY_ACTIVE");
    this.state.active[id] = version;
    this.history(rollback ? "rollback" : "activate", r);
    await this.persist();
    return r;
  }
  async close() {
    if (this.locked) {
      this.locked = false;
      await rmdir(path.join(this.dir, ".lock"));
    }
  }
}
