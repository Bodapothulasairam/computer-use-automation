import type { Action, Target, Capability } from "./schema.js";
import { z } from "zod";
export const PolicyConfig = z
  .object({
    profile: z.literal("ledger-v1"),
    allowedPaths: z.array(z.string().startsWith("/")),
    allowedQueryKeys: z.array(z.string()),
    allowedActions: z.array(z.enum(["fill", "click"])),
    maxSteps: z.number().int().min(1).max(50),
    timeoutMs: z.number().int().min(100).max(300000),
    stepTimeoutMs: z.number().int().min(100).max(15000),
    recoveryAttempts: z.number().int().min(0).max(5),
  })
  .strict();
export type PolicyConfig = z.infer<typeof PolicyConfig>;
export class Fault extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export const targets: Target[] = [
  { frame: "workspace", strategy: "table-label", name: "Member number" },
  ...["Search", "Transfer funds"].map((name) => ({
    frame: "workspace" as const,
    strategy: "role" as const,
    role: "button" as const,
    name,
  })),
  ...["Balance summary", "Continue", "Retry", "Restore session"].map(
    (name) => ({
      frame: "workspace" as const,
      strategy: "role" as const,
      role: "link" as const,
      name,
    }),
  ),
  ...[
    "Member search",
    "Member details",
    "Balance summary",
    "Member not found",
    "Validation error",
    "Permission denied",
    "Session expired",
    "Temporarily unavailable",
    "Application error",
    "Service notice",
    "Unexpected confirmation",
    "Loading",
  ].map((name) => ({
    frame: "workspace" as const,
    strategy: "role" as const,
    role: "heading" as const,
    name,
  })),
  ...["Savings balance", "Currency"].map((name) => ({
    frame: "workspace" as const,
    strategy: "table-label" as const,
    name,
  })),
];
export const same = (a: Target, b: Target) =>
  a.frame === b.frame &&
  a.strategy === b.strategy &&
  a.role === b.role &&
  a.name === b.name;
export class Policy {
  constructor(
    readonly origin: string,
    readonly config: PolicyConfig,
  ) {
    const u = new URL(origin);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.origin !== origin ||
      u.username ||
      u.password
    )
      throw new Fault("INVALID_ORIGIN");
  }
  url(value: string) {
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      throw new Fault("URL_DENIED");
    }
    if (
      u.origin !== this.origin ||
      u.username ||
      u.password ||
      !this.config.allowedPaths.includes(u.pathname) ||
      [...u.searchParams.keys()].some(
        (k) => !this.config.allowedQueryKeys.includes(k),
      ) ||
      u.hash
    )
      throw new Fault("URL_DENIED");
  }
  target(t: Target) {
    if (!targets.some((x) => same(x, t))) throw new Fault("TARGET_DENIED");
  }
  action(a: Action, actor: "automation" | "human") {
    if (!this.config.allowedActions.includes(a.kind))
      throw new Fault("ACTION_DENIED");
    this.target(a.target);
    if (a.target.name === "Transfer funds")
      throw new Fault("RISKY_ACTION_BLOCKED");
    if (
      a.kind === "fill" &&
      (a.target.name !== "Member number" || a.parameter !== "memberId")
    )
      throw new Fault("FILL_DENIED");
    if (
      a.kind === "click" &&
      ![
        "Search",
        "Balance summary",
        "Continue",
        "Retry",
        ...(actor === "human" ? ["Restore session"] : []),
      ].includes(a.target.name)
    )
      throw new Fault("ACTION_DENIED");
  }
  capability(a: Capability) {
    if (a.application.profile !== this.config.profile)
      throw new Fault("PROFILE_MISMATCH");
    for (const s of a.steps) {
      this.action(s.action, "automation");
      this.target(s.expect.target);
    }
    this.target(a.success.target);
    for (const out of Object.values(a.outputs)) {
      this.target(out.target);
      if (!["Savings balance", "Currency"].includes(out.target.name))
        throw new Fault("OUTPUT_DENIED");
    }
    if (
      Object.keys(a.outputs).sort().join() !== "currency,savingsBalance" ||
      a.outputs.savingsBalance?.type !== "number" ||
      a.outputs.savingsBalance.target.name !== "Savings balance" ||
      a.outputs.savingsBalance.target.strategy !== "table-label" ||
      !a.outputs.savingsBalance.sensitive ||
      a.outputs.currency?.type !== "string" ||
      a.outputs.currency.target.name !== "Currency" ||
      a.outputs.currency.target.strategy !== "table-label"
    )
      throw new Fault("CONTRACT_MISMATCH");
    if (
      Object.keys(a.inputs).join() !== "memberId" ||
      a.inputs.memberId?.pattern !== "^[0-9]{5}$" ||
      !a.inputs.memberId.sensitive
    )
      throw new Fault("CONTRACT_MISMATCH");
    if (
      a.success.target.name !== "Balance summary" ||
      a.success.target.role !== "heading"
    )
      throw new Fault("CHECKPOINT_DENIED");
  }
}
