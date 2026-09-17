import { readdir, readFile } from "node:fs/promises";
import { parse } from "dotenv";
import assert from "node:assert/strict";
const roots = [
  "src",
  "test",
  "scripts",
  "config",
  "schema",
  "evidence",
  ".github",
];
const files = [
  "README.md",
  "REPORT.md",
  "REQUIREMENTS.md",
  ".env.example",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".gitignore",
  "LICENSE",
  "ARCHITECTURE.md",
  "SECURITY_REVIEW.md",
  "MANUAL_TESTS.md",
];
async function walk(dir: string) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) await walk(p);
    else files.push(p);
  }
}
for (const dir of roots) await walk(dir);
const local = parse(await readFile(".env", "utf8").catch(() => ""));
const source = local.SOURCE_ENV_FILE
  ? parse(await readFile(local.SOURCE_ENV_FILE, "utf8"))
  : {};
const secrets = [
  process.env.OPENAI_API_KEY,
  local.OPENAI_API_KEY,
  source.OPENAI_API_KEY,
].filter((s): s is string => !!s && s.length > 10);
let checked = 0;
for (const file of files) {
  if (/\.(png|webm)$/.test(file)) continue;
  const text = await readFile(file, "utf8").catch(() => "");
  for (const secret of secrets)
    assert.ok(!text.includes(secret), "A secret is present in " + file);
  assert.ok(
    !/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(text),
    "Key-shaped data in " + file,
  );
  if (file.startsWith("evidence/") && file.endsWith(".jsonl"))
    for (const value of ["12345", "67890", "Demo Member"])
      assert.ok(!text.includes(value), "Unredacted data in " + file);
  checked++;
}
console.log(
  "Secret and evidence audit passed for " +
    checked +
    " text files. No values printed.",
);
