import http from "node:http";
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { readFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { Registry, ReleaseKey } from "./registry.js";
import { benchmark, Scenarios, scenarioOptions } from "./benchmark.js";
import { Variant } from "./bindings.js";
import { replay } from "./engine.js";
import { Fault } from "./policy.js";
import { startDemo } from "./demo-app.js";
import { consoleHtml, consoleScript } from "./console-ui.js";
import { openapi } from "./openapi.js";

const Invoke = z
  .object({
    id: ReleaseKey.shape.id,
    memberId: z.string().regex(/^[0-9]{5}$/),
    variant: Variant.default("classic"),
    scenario: Scenarios.exclude(["invalid"]).default("normal"),
  })
  .strict();
type Job = {
  id: string;
  kind: "validation" | "replay";
  status: "running" | "complete" | "failed";
  progress: number;
  total: number;
  runId?: string;
  code?: string;
  result?: unknown;
};
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function startControl(options: {
  dir: string;
  port?: number;
  bootstrap?: unknown;
  maxRequests?: number;
}) {
  await mkdir(options.dir, { recursive: true });
  const registry = await new Registry(
    path.join(options.dir, "registry"),
  ).open();
  let app: Awaited<ReturnType<typeof startDemo>>;
  try {
    if (options.bootstrap && !registry.snapshot().releases.length)
      await registry.import(options.bootstrap);
    app = await startDemo();
  } catch (e) {
    await registry.close();
    throw e;
  }
  const runDir = path.join(options.dir, "runs");
  await mkdir(runDir, { recursive: true });
  const tokens = {
    reviewer: randomBytes(32).toString("hex"),
    runner: randomBytes(32).toString("hex"),
  };
  const jobs = new Map<string, Job>();
  const known = new Set<string>();
  for (const r of registry.snapshot().releases)
    for (const id of r.validation?.runIds ?? []) known.add(id);
  let busy = false,
    closing = false;
  let pending: Promise<void> | undefined;
  let origin = "";
  let windowStart = Date.now(),
    requests = 0;
  const finishJob = (job: Job, task: () => Promise<unknown>) => {
    if (jobs.size >= 100) {
      const oldest = jobs.keys().next().value;
      if (oldest) jobs.delete(oldest);
    }
    jobs.set(job.id, job);
    busy = true;
    pending = (async () => {
      try {
        job.result = await task();
        job.status = "complete";
      } catch (e) {
        job.status = "failed";
        job.code = e instanceof Fault ? e.code : "EXECUTION_ERROR";
      } finally {
        busy = false;
      }
    })();
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const reply = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.host !== new URL(origin).host) {
        reply(403, { code: "HOST_DENIED" });
        return;
      }
      if (req.headers.origin && req.headers.origin !== origin) {
        reply(403, { code: "ORIGIN_DENIED" });
        return;
      }
      if (Date.now() - windowStart > 60000) {
        requests = 0;
        windowStart = Date.now();
      }
      if (++requests > (options.maxRequests ?? 600)) {
        res.setHeader("Retry-After", "60");
        reply(429, { code: "RATE_LIMITED" });
        return;
      }
      if (closing) {
        reply(503, { code: "SHUTTING_DOWN" });
        return;
      }
      const route = req.url ?? "";
      if (req.method === "GET" && (route === "/" || route === "/console.js")) {
        res.setHeader(
          "Content-Type",
          route === "/"
            ? "text/html; charset=utf-8"
            : "text/javascript; charset=utf-8",
        );
        res.end(route === "/" ? consoleHtml : consoleScript);
        return;
      }
      const auth = req.headers.authorization ?? "";
      const role = equal(auth, "Bearer " + tokens.reviewer)
        ? "reviewer"
        : equal(auth, "Bearer " + tokens.runner)
          ? "runner"
          : null;
      if (!role) {
        reply(401, { code: "UNAUTHORIZED" });
        return;
      }
      if (req.method === "GET") {
        if (route === "/api/session") {
          reply(200, { role });
          return;
        }
        if (route === "/api/openapi") {
          reply(200, openapi);
          return;
        }
        if (route === "/api/capabilities") {
          reply(
            200,
            Object.entries(registry.snapshot().active).map(([id, version]) => {
              const r = registry.get(id, version);
              return {
                id,
                version,
                digest: r.digest,
                inputs: r.artifact.inputs,
                outputs: r.artifact.outputs,
              };
            }),
          );
          return;
        }
        if (route === "/api/releases") {
          if (role !== "reviewer") {
            reply(403, { code: "ROLE_DENIED" });
            return;
          }
          reply(200, registry.snapshot());
          return;
        }
        if (route === "/api/jobs") {
          reply(200, [...jobs.values()].slice(-50));
          return;
        }
        const jobMatch = /^\/api\/jobs\/([0-9a-f-]{36})$/.exec(route);
        if (jobMatch) {
          const job = jobs.get(jobMatch[1]!);
          reply(job ? 200 : 404, job ?? { code: "NOT_FOUND" });
          return;
        }
        const runMatch = /^\/api\/runs\/([0-9a-f-]{36})$/.exec(route);
        if (runMatch) {
          const id = z.string().uuid().parse(runMatch[1]);
          if (!known.has(id)) {
            reply(404, { code: "NOT_FOUND" });
            return;
          }
          const read = async (name: string) => {
            const file = path.join(runDir, id, name);
            try {
              if ((await stat(file)).size > 2_000_000)
                throw new Fault("EVIDENCE_TOO_LARGE");
              return await readFile(file, "utf8");
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
              throw e;
            }
          };
          const [events, result, metrics] = await Promise.all([
            read("events.jsonl"),
            read("result.json"),
            read("metrics.json"),
          ]);
          reply(200, {
            runId: id,
            events: (events ?? "")
              .split("\n")
              .filter(Boolean)
              .flatMap((line) => {
                try {
                  return [JSON.parse(line)];
                } catch {
                  return [];
                }
              }),
            result: result ? JSON.parse(result) : null,
            metrics: metrics ? JSON.parse(metrics) : null,
          });
          return;
        }
        reply(404, { code: "NOT_FOUND" });
        return;
      }
      if (req.method !== "POST") {
        reply(405, { code: "METHOD_DENIED" });
        return;
      }
      const mutation = [
        "/api/releases/import",
        "/api/releases/validate",
        "/api/releases/approve",
        "/api/releases/activate",
        "/api/releases/rollback",
      ].includes(route);
      if (!mutation && route !== "/api/invoke") {
        reply(404, { code: "NOT_FOUND" });
        return;
      }
      if (mutation && role !== "reviewer") {
        reply(403, { code: "ROLE_DENIED" });
        return;
      }
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          req.headers["content-type"] ?? "",
        )
      ) {
        reply(415, { code: "JSON_REQUIRED" });
        return;
      }
      if (busy) {
        reply(409, { code: "EXECUTION_IN_PROGRESS" });
        return;
      }
      // Take the lease before awaiting the request body so parallel requests cannot race.
      busy = true;
      let transferred = false;
      try {
        let length = 0;
        const parts: Buffer[] = [];
        if (Number(req.headers["content-length"] ?? 0) > 65536) {
          reply(413, { code: "BODY_TOO_LARGE" });
          return;
        }
        for await (const part of req) {
          length += part.length;
          if (length > 65536) {
            reply(413, { code: "BODY_TOO_LARGE" });
            return;
          }
          parts.push(part);
        }
        const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
        if (route === "/api/releases/import") {
          reply(201, await registry.import(body));
          return;
        }
        if (route === "/api/invoke") {
          const input = Invoke.parse(body);
          const release = registry.get(input.id);
          if (release.status !== "approved")
            throw new Fault("APPROVAL_REQUIRED");
          const job: Job = {
            id: randomUUID(),
            kind: "replay",
            status: "running",
            progress: 0,
            total: 1,
          };
          transferred = true;
          finishJob(job, async () => {
            const result = await replay(release.artifact, {
              origin: app.origin,
              evidenceDir: runDir,
              variant: input.variant,
              ...(await scenarioOptions(input.scenario, input.memberId)),
              onRun: (id) => {
                job.runId = id;
                known.add(id);
              },
            });
            job.progress = 1;
            // Typed outputs remain in this authenticated process response only.
            // /api/runs always serves redacted disk evidence.
            return result;
          });
          reply(202, job);
          return;
        }
        const { id, version } = ReleaseKey.parse(body);
        if (route === "/api/releases/validate") {
          const job: Job = {
            id: randomUUID(),
            kind: "validation",
            status: "running",
            progress: 0,
            total: 38,
          };
          transferred = true;
          finishJob(job, async () =>
            registry.validate(id, version, async (artifact) => {
              const report = await benchmark(artifact, {
                out: runDir,
                count: 38,
                seed: 20260916,
                progress: (done, total) => {
                  job.progress = done;
                  job.total = total;
                },
              });
              for (const t of report.trials) known.add(t.runId);
              return report;
            }),
          );
          reply(202, job);
          return;
        }
        const result = route.endsWith("/approve")
          ? await registry.approve(id, version)
          : await registry.activate(id, version, route.endsWith("/rollback"));
        reply(200, result);
      } finally {
        if (!transferred) busy = false;
      }
    } catch (e) {
      reply(e instanceof Fault ? 409 : 400, {
        code: e instanceof Fault ? e.code : "INVALID_REQUEST",
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.timeout = 10000;
  server.maxHeadersCount = 30;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
  } catch (e) {
    await app.close();
    await registry.close();
    throw e;
  }
  origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  return {
    origin,
    tokens,
    registry,
    close: async () => {
      closing = true;
      await pending;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await app.close();
      await registry.close();
    },
  };
}
