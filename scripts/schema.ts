import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { Capability } from "../src/schema.js";
await mkdir("schema", { recursive: true });
await writeFile(
  "schema/capability.schema.json",
  JSON.stringify(z.toJSONSchema(Capability), null, 2),
);
console.log("schema/capability.schema.json");
