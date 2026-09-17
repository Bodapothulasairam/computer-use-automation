import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { startDemo } from "./demo-app.js";
import { discover, replay } from "./engine.js";
import { loadModelConfig, OpenAIModel } from "./model.js";
import { fixture } from "./fixture.js";
import { presentationOptions } from "./presentation.js";
import { Variant } from "./bindings.js";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    goal: { type: "string" },
    target: { type: "string" },
    member: { type: "string", default: "12345" },
    artifact: { type: "string" },
    out: { type: "string", default: "runs" },
    scenario: { type: "string", default: "normal" },
    operator: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    "action-delay-ms": { type: "string" },
    "final-hold-ms": { type: "string" },
    port: { type: "string", default: "4173" },
    variant: { type: "string", default: "classic" },
  },
});
const command = positionals[0] ?? "demo";
let app: Awaited<ReturnType<typeof startDemo>> | undefined;
try {
  const variant = Variant.parse(values.variant);
  if (command === "app") {
    app = await startDemo(Number(values.port), variant);
    console.log("Synthetic sandbox: " + app.origin + "/app");
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } else {
    const presentation = presentationOptions(
      values.headed!,
      values["action-delay-ms"],
      values["final-hold-ms"],
    );
    if (!values.target) app = await startDemo();
    const target = values.target
      ? new URL(values.target)
      : new URL(app!.origin + "/app");
    const options = {
      origin: target.origin,
      entryPath: target.pathname,
      parameters: { memberId: values.member! },
      evidenceDir: values.out,
      scenario: command === "handoff" ? "session" : values.scenario,
      headless: !values.headed,
      presentation,
      variant,
      operator: values.operator || command === "handoff" ? {} : undefined,
    };
    if (command === "discover" || command === "demo") {
      console.log("Discovering the workflow in the live application...");
      const config = await loadModelConfig();
      const d = await discover(
        values.goal ??
          "Look up member {memberId} and read the current savings balance and currency from the balance summary.",
        options,
        (e) => new OpenAIModel(config.key, config.model, e),
      );
      console.log(JSON.stringify(d.result, null, 2));
      if (d.artifact) {
        await mkdir(values.out!, { recursive: true });
        await writeFile(
          values.out + "/capability.json",
          JSON.stringify(d.artifact, null, 2),
        );
        console.log("Saved capability: " + values.out + "/capability.json");
        if (command === "demo") {
          const results = [];
          for (const [member, scenario] of [
            ["67890", "normal"],
            ["00000", "normal"],
            ["12345", "notice"],
            ["12345", "permission"],
          ] as const) {
            console.log(
              "Replay scenario: " +
                scenario +
                (member === "00000" ? " (member not found)" : ""),
            );
            const result = await replay(d.artifact, {
              ...options,
              parameters: { memberId: member },
              scenario,
            });
            results.push(result);
            console.log(JSON.stringify(result, null, 2));
          }
          await writeFile(
            values.out + "/demo-summary.json",
            JSON.stringify(
              {
                discoveryRun: d.result.runId,
                replays: results.map((r) => ({
                  runId: r.runId,
                  status: r.status,
                  code: "code" in r ? r.code : undefined,
                })),
              },
              null,
              2,
            ),
          );
        }
      } else process.exitCode = 1;
    } else if (command === "replay" || command === "handoff") {
      const artifact = values.artifact
        ? JSON.parse(await readFile(values.artifact, "utf8"))
        : fixture;
      const result = await replay(artifact, options);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "failure") process.exitCode = 1;
    } else throw Error("Unknown command");
  }
} catch {
  console.error(
    "Command failed. Check configuration and local evidence. Secret-bearing errors are not printed.",
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
