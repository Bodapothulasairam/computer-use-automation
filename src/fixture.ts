import {
  Capability,
  contract,
  memberTarget,
  searchTarget,
  summaryTarget,
  heading,
} from "./schema.js";
// Explicit test fixture. This is NEVER presented as genuine model discovery.
export const fixture: Capability = {
  schemaVersion: "1.0",
  id: "member-savings-balance",
  version: "1.0.0",
  description: "Read a synthetic member savings balance.",
  application: {
    product: "legacy-ledger",
    version: "1",
    profile: "ledger-v1",
    entryPath: "/app",
  },
  ...contract,
  steps: [
    {
      id: "step-1",
      action: { kind: "fill", target: memberTarget, parameter: "memberId" },
      expect: { target: heading("Member search"), condition: "visible" },
      rationale: "enter_input",
    },
    {
      id: "step-2",
      action: { kind: "click", target: searchTarget },
      expect: { target: heading("Member details"), condition: "visible" },
      rationale: "open_member",
    },
    {
      id: "step-3",
      action: { kind: "click", target: summaryTarget },
      expect: contract.success,
      rationale: "read_summary",
    },
  ],
  provenance: {
    kind: "test-fixture",
    model: "none",
    runId: "00000000-0000-4000-8000-000000000000",
    createdAt: "2026-09-16T00:00:00.000Z",
  },
};
