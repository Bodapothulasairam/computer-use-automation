# Verification platform evidence

Recorded on September 16, 2026 (America/Chicago; some files use September 17 UTC).
All application records are synthetic. These are measured runs, not predicted results.

## Results

| Check                                                 | Result                                                                  | Evidence                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and automated behavioral suite             | 49 passed, 0 failed, 0 skipped                                          | [Full output](verification.txt)                                                                                                                         |
| Seeded benchmark                                      | 100/100 correct outcomes; all 19 scenarios on both layouts              | [Report and every trial](benchmark/benchmark.json)                                                                                                      |
| Incorrect success / replay model calls                | 0 / 0                                                                   | Benchmark report and per-run metrics                                                                                                                    |
| Recovery-eligible trials                              | 23/23 correct, including automated operator recovery                    | Benchmark report                                                                                                                                        |
| End-to-end latency                                    | p50 924 ms; p95 1,884 ms                                                | Windows x64, Node 24.15.0; benchmark report                                                                                                             |
| Real discovery on card layout                         | Success; 4 OpenAI API calls                                             | [Discovery metrics](live-demo/f844054a-99bc-4a68-8eaa-9dcdcbc9d832/metrics.json), [events](live-demo/f844054a-99bc-4a68-8eaa-9dcdcbc9d832/events.jsonl) |
| Replay of newly discovered workflow                   | Success, missing member, notice recovery, permission denial as expected | [Live demo summary](live-demo/demo-summary.json)                                                                                                        |
| Actual guided operator console                        | Claim → restore → verified resume; same session                         | [Handoff summary](../handoff-summary.json)                                                                                                              |
| Dependency audit (including development dependencies) | 0 known vulnerabilities                                                 | [npm audit output](dependency-audit.json)                                                                                                               |

The benchmark uses the original genuinely discovered [capability](../capability.json).
Its report binds the capability and trusted runner/dependency digests. Each trial's
run ID names the adjacent folder containing redacted events, metrics and outcome.
The independent oracle checks exact numeric output and currency before counting a
successful lookup. An expected permission denial is a correct outcome, not a
successful lookup. No trial was retried to improve the score.

The seed reproduces scenario order and injected delays. Latency measures run start
through result recording, excluding presentation holds and final browser cleanup.
Other evidence recording ran concurrently for part of this measurement; timings
depend on machine and workload. Recovery rate includes notice, temporary outage,
slow loading and session handoff. The `recoveryAttempts` counter counts automatic
engine recovery actions; operator actions are separately recorded in events.
Finite synthetic results are not a production reliability guarantee.

## Screenshots and walkthrough

- [Validated candidate](console-validated.png)
- [Completed card-layout session recovery and evidence timeline](console-evidence.png)
- [Mobile console](console-mobile.png)
- [Card-layout account summary](cards-layout.png)
- [Recorded browser walkthrough](walkthrough.webm) and [recording metadata](walkthrough.json)

The walkthrough records actual approval, activation, replay and evidence inspection.
Validation runs before recording to keep the video short. Playwright drives the
reviewer UI and an explicitly labelled automated operator performs session recovery;
no human participation is claimed. Screenshots show synthetic data only and omit
the browser address bar and private role tokens.

## Reproduce

```powershell
npm.cmd run verify
npm.cmd run test:handoff
npm.cmd run benchmark -- --count 100 --seed 20260916 --out runs/my-benchmark
npm.cmd run evidence:platform
npm.cmd run demo -- --variant cards --out runs/live-card-demo
npm.cmd run audit
npm.cmd audit
```

Only `demo` requires a configured model key. `evidence:platform` and `test:handoff`
rewrite their demonstration screenshots/video with new local runs. Use the
[manual checklist](../../MANUAL_TESTS.md) for personal interaction, and read the
[security review](../../SECURITY_REVIEW.md) for controls and remaining limitations.
