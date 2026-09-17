import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export async function runnerDigest() {
  const files = [
    "engine.ts",
    "surface.ts",
    "policy.ts",
    "schema.ts",
    "bindings.ts",
    "benchmark.ts",
    "handoff.ts",
    "model.ts",
    "integrity.ts",
    "registry.ts",
    "control-server.ts",
    "../config/policy.json",
    "../package-lock.json",
  ];
  const sources = await Promise.all(
    files.map(async (file) => [
      file,
      (await readFile(new URL(file, import.meta.url), "utf8")).replace(
        /\r\n/g,
        "\n",
      ),
    ]),
  );
  return digest(sources);
}
