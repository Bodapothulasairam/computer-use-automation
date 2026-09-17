import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { Capability } from "./schema.js";
import { benchmark } from "./benchmark.js";
import { startControl } from "./control-server.js";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    artifact: { type: "string", default: "evidence/capability.json" },
    out: { type: "string", default: "runs/benchmark" },
    count: { type: "string", default: "100" },
    seed: { type: "string", default: "20260916" },
    dir: { type: "string", default: "runs/control" },
    port: { type: "string", default: "4180" },
  },
});
try {
  const artifact = Capability.parse(
    JSON.parse(await readFile(values.artifact!, "utf8")),
  );
  if (positionals[0] === "benchmark") {
    const report = await benchmark(artifact, {
      out: values.out!,
      count: Number(values.count),
      seed: Number(values.seed),
      progress: (done, total) => {
        if (done % 10 === 0 || done === total)
          console.log("Trials completed: " + done + "/" + total);
      },
    });
    console.log(
      JSON.stringify(
        {
          count: report.count,
          passed: report.passed,
          failed: report.failed,
          unsafeSuccesses: report.unsafeSuccesses,
          modelCalls: report.modelCalls,
          p50Ms: report.p50Ms,
          p95Ms: report.p95Ms,
          report: values.out + "/benchmark.json",
        },
        null,
        2,
      ),
    );
    if (report.failed) process.exitCode = 1;
  } else {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error("PORT");
    const control = await startControl({
      dir: values.dir!,
      port,
      bootstrap: artifact,
    });
    console.log(
      "Reviewer console (private, local): " +
        control.origin +
        "/#" +
        control.tokens.reviewer,
    );
    console.log(
      "Runner console (private, local): " +
        control.origin +
        "/#" +
        control.tokens.runner,
    );
    console.log(
      "Use the runner URL fragment as the bearer token for the API. Do not share these URLs.",
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await control.close();
  }
} catch {
  console.error(
    "Operation failed. Check the artifact, options, and whether the local registry is already in use. No secret-bearing errors are printed.",
  );
  process.exitCode = 1;
}
