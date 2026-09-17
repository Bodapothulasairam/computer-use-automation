# Manual verification checklist

Start from the repository directory in PowerShell. Install using the README first.

```powershell
npm.cmd run console
```

Open the **Reviewer console** URL printed in the terminal. The fragment is a private
token, removed from the address bar after connection. Keep the terminal running.
If the default port is occupied, add `-- --port 4181`. For a new evaluation workspace,
add `-- --dir runs/control-fresh`; this leaves existing records intact.

## Lifecycle and evidence

1. A first launch imports `evidence/capability.json` as a **candidate**. Run, Approve
   and Activate are disabled. Click **Validate 38 scenarios**. All mutating controls
   stay disabled during validation. Progress reaches 38/38.
2. Inspect individual trial evidence. Both classic and cards layouts are covered;
   expected permission denials count as correct outcomes, not successful lookups.
3. Click **Approve release**, then **Activate release**. Each button becomes
   available only after its prerequisite. Run is now enabled.
4. Enter `1234`: Run is disabled. Enter `67890`, choose the card layout and Successful
   lookup, then Run. The timeline shows preflight, actions and checkpoints. Saved
   outputs are `[REDACTED]`; metrics show zero model calls.
5. Select **Session recovery — automated operator**. Evidence must show claim,
   Restore session, release of control and successful continuation in the same run.
   This console scenario is an automated stand-in. For personal control use the
   separate handoff command below.
6. Expand **Add a candidate version**. Copy the selected artifact as `1.1.0`. The new
   candidate cannot be activated until its own validation and approval complete.
   Review the full before/after artifact diff. Activate it, select `1.0.0`, and click
   **Roll back to this version**. The active version and audit history must change.
7. Open the **Runner console** URL. Invocation is available for the active release;
   import, approval and activation are unavailable. Server checks enforce this too.
8. Narrow the window to phone width. Inputs and buttons remain usable without
   horizontal scrolling. The evidence timeline scrolls within its panel.

## Scenario outcomes

| Scenario                                 | Expected outcome                                          |
| ---------------------------------------- | --------------------------------------------------------- |
| Normal member 12345 / 67890              | Correct balance and USD; successful verified lookup       |
| Member not found                         | Business outcome `NOT_FOUND`                              |
| Application validation                   | Business outcome `VALIDATION`                             |
| Notice / temporary outage / slow loading | Bounded recovery, then success                            |
| Session expired — stop                   | `SESSION_EXPIRED`; no pretend recovery                    |
| Session recovery — automated operator    | Same-session handoff and success                          |
| Permission denied                        | `PERMISSION_DENIED`                                       |
| Application error                        | `APPLICATION_ERROR`                                       |
| Unexpected dialog                        | `UNEXPECTED_DIALOG`                                       |
| Ambiguous target                         | `AMBIGUOUS_TARGET`; no first-match click                  |
| Wrong member                             | `OUTPUT_CONTEXT_MISMATCH`; no balance returned as success |
| Invalid balance                          | `OUTPUT_TYPE_MISMATCH`                                    |
| Incompatible search / summary            | `UI_DRIFT`                                                |
| Untrusted page instructions              | Ignored; approved read-only workflow still completes      |
| Recovery limit reached                   | `RECOVERY_EXHAUSTED`                                      |

Run scenarios on **both** layouts. Scenario injection is a synthetic evaluation
feature and is not exposed as a production bank function.

## Visible legacy app and personal operator takeover

```powershell
npm.cmd run app -- --variant cards
npm.cmd run replay -- --artifact evidence/capability.json --variant cards --member 67890 --headed
npm.cmd run handoff -- --artifact evidence/capability.json --variant cards --headed
```

For handoff, open its separately printed operator URL. Before Claim, Restore and
Resume are disabled. After Claim, Restore is enabled. After Restore is verified,
Resume is enabled. Resume returns control and completes the same browser session.

## Repeatable checks

```powershell
npm.cmd run verify
npm.cmd run test:handoff
npm.cmd run benchmark -- --count 100 --seed 20260916 --out runs/my-benchmark
npm.cmd run audit
npm.cmd audit
```

The benchmark exits nonzero if any expected result is wrong. It records every trial
and does not rerun failed cases to improve the reported pass rate. Same seed means
the same scenario order and injected delays; elapsed runtime naturally varies.
