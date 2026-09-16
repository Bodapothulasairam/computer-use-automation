import { z } from "zod";

export const Target = z
  .object({
    frame: z.literal("workspace"),
    strategy: z.enum(["role", "table-label"]),
    role: z.enum(["button", "link", "heading"]).optional(),
    name: z.string().min(1).max(80),
  })
  .strict()
  .superRefine((t, c) => {
    if (t.strategy === "role" && !t.role)
      c.addIssue({ code: "custom", message: "Role required" });
    if (t.strategy === "table-label" && t.role)
      c.addIssue({ code: "custom", message: "Table target has no role" });
  });
export type Target = z.infer<typeof Target>;
export const Action = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fill"),
      target: Target,
      parameter: z.string().regex(/^[a-zA-Z]\w*$/),
    })
    .strict(),
  z.object({ kind: z.literal("click"), target: Target }).strict(),
]);
export type Action = z.infer<typeof Action>;
export const Checkpoint = z
  .object({ target: Target, condition: z.literal("visible") })
  .strict();
export type Checkpoint = z.infer<typeof Checkpoint>;
export const Capability = z
  .object({
    schemaVersion: z.literal("1.0"),
    id: z.string().regex(/^[a-z][a-z0-9-]+$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().max(300),
    application: z
      .object({
        product: z.literal("legacy-ledger"),
        version: z.literal("1"),
        profile: z.literal("ledger-v1"),
        entryPath: z.literal("/app"),
      })
      .strict(),
    inputs: z.record(
      z.string(),
      z
        .object({
          type: z.literal("string"),
          pattern: z.string(),
          sensitive: z.boolean(),
          description: z.string(),
        })
        .strict(),
    ),
    outputs: z.record(
      z.string(),
      z
        .object({
          type: z.enum(["number", "string"]),
          sensitive: z.boolean(),
          target: Target,
        })
        .strict(),
    ),
    steps: z
      .array(
        z
          .object({
            id: z.string(),
            action: Action,
            expect: Checkpoint,
            rationale: z.string().max(160),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    success: Checkpoint,
    provenance: z
      .object({
        kind: z.enum(["live-llm", "test-fixture"]),
        model: z.string(),
        runId: z.string().uuid(),
        createdAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict()
  .superRefine((a, c) => {
    if (new Set(a.steps.map((s) => s.id)).size !== a.steps.length)
      c.addIssue({ code: "custom", message: "Duplicate step ids" });
    for (const s of a.steps)
      if (s.action.kind === "fill" && !a.inputs[s.action.parameter])
        c.addIssue({ code: "custom", message: "Undeclared parameter" });
  });
export type Capability = z.infer<typeof Capability>;
export type Status =
  | "ready"
  | "not_found"
  | "validation"
  | "permission"
  | "session_expired"
  | "transient"
  | "app_error"
  | "notice"
  | "unknown_dialog"
  | "loading"
  | "unknown";
export type Observation = {
  route: string;
  status: Status;
  controls: Target[];
  fields: Target[];
  headings: Target[];
  filled: Target[];
};
export type RunResult =
  | {
      status: "success";
      runId: string;
      outputs: Record<string, string | number>;
    }
  | {
      status: "business_outcome";
      runId: string;
      code: "NOT_FOUND" | "VALIDATION";
      step: string;
    }
  | {
      status: "failure";
      runId: string;
      code: string;
      step: string;
      expected: string;
      observed: Observation | null;
      interventionId?: string;
    };
export const memberTarget: Target = {
  frame: "workspace",
  strategy: "table-label",
  name: "Member number",
};
export const searchTarget: Target = {
  frame: "workspace",
  strategy: "role",
  role: "button",
  name: "Search",
};
export const summaryTarget: Target = {
  frame: "workspace",
  strategy: "role",
  role: "link",
  name: "Balance summary",
};
export const heading = (name: string): Target => ({
  frame: "workspace",
  strategy: "role",
  role: "heading",
  name,
});
export const contract = {
  inputs: {
    memberId: {
      type: "string" as const,
      pattern: "^[0-9]{5}$",
      sensitive: true,
      description: "Five digit synthetic member number supplied at invocation",
    },
  },
  outputs: {
    savingsBalance: {
      type: "number" as const,
      sensitive: true,
      target: {
        frame: "workspace" as const,
        strategy: "table-label" as const,
        name: "Savings balance",
      },
    },
    currency: {
      type: "string" as const,
      sensitive: false,
      target: {
        frame: "workspace" as const,
        strategy: "table-label" as const,
        name: "Currency",
      },
    },
  },
  success: {
    target: heading("Balance summary"),
    condition: "visible" as const,
  },
};
