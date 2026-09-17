# Assignment traceability

| Assignment requirement                                                  | Implementation                                                | Verification / evidence                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 3.1 Goal + target; genuine observe/decide/act; stop limits              | CLI, model adapter, discovery loop, BrowserSurface            | Real OpenAI discovery in evidence; step/deadline tests                          |
| 3.2 Versioned typed flow, targeting, input/output contract, checkpoints | src/schema.ts; schema/capability.schema.json                  | Saved capability; validation and forged-checkpoint tests                        |
| 3.3 No-model replay, typed outputs, runtime errors                      | src/engine.ts replay/settle/success                           | Different-member replay; business/recovery/failure tests                        |
| 3.4 Allowlist, risk handling, no persisted secrets or sensitive values  | config/policy.json; src/policy.ts; src/evidence.ts            | URL/action/ownership tests; evidence canaries; npm run audit                    |
| 3.5 Structured action/rationale log and failure signal                  | events.jsonl; semantic failure.snapshot.json                  | Permission-denied evidence; snapshot assertions                                 |
| 3.6 Detect, route, same-session control, resume, record human actions   | src/handoff.ts; operator option; loopback console             | API ownership tests; actual-console test and screenshot; resumed discovery test |
| 3.7 Heterogeneity and multi-tenant design                               | Surface interface, two reviewed layout bindings, UI preflight | REPORT.md Heterogeneity & multi-tenant; both-layout tests and benchmark         |
| Exact README, REPORT and evidence paths                                 | README.md; REPORT.md; evidence/                               | Seven report headings, setup/demo commands, evidence index                      |
| Public git repository                                                   | Git repository packaged with source and redacted evidence     | Public GitHub URL                                                               |
| Submission email                                                        | Applicant sends the public repository URL                     | Separate action; not sent automatically                                         |

Implemented surface: local iframe web app with classic tables and a reviewed card/definition-list layout. The operator console and same-session handoff are functional; the evidence operator is automated. Desktop adapters and multi-tenant infrastructure are design-only, as permitted by the assignment.

Beyond the required slice, the project implements a seeded benchmark, UI drift
detection, a desktop/mobile evidence console, immutable release validation/approval/
rollback, and an authenticated local capability API. See [ARCHITECTURE.md](ARCHITECTURE.md),
[SECURITY_REVIEW.md](SECURITY_REVIEW.md), and [measured evidence](evidence/platform/README.md).
