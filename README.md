# Legacy Capability Runner

A small computer-use backend for a synthetic bank servicing app. An OpenAI model discovers a real browser workflow; the resulting typed capability replays without any model. The demo app uses an iframe and table-labelled inputs, without test IDs.

## Setup

Requires Node.js 22 or newer and npm. Tested on Windows with Node.js 24.

```sh
npm ci
npx playwright install chromium
```

On Linux CI, install browser system libraries with `npx playwright install --with-deps chromium`.

Copy `.env.example` to `.env` and set `OPENAI_API_KEY`. The default model is `gpt-4.1-mini`; set `OPENAI_MODEL` to override. Alternatively set `SOURCE_ENV_FILE` in your local `.env`: the loader imports **only OPENAI_API_KEY** from that file. No key is needed for replay or tests. Neither the source file nor `.env` belongs in git.

## Exact demo path

A single command starts the local app, runs genuine LLM discovery, then replays the recorded artifact with another member, a not-found member, a recoverable notice, and a permission denial:

```sh
npm run demo -- --out evidence
```

Or run discovery and replay separately:

```sh
npm run discover -- --goal "Look up member {memberId} and read their savings balance and currency from the balance summary." --member 12345 --out runs/my-discovery
npm run replay -- --artifact runs/my-discovery/capability.json --member 67890 --out runs/my-replay
```

Each command starts and closes its own real local app and isolated Chromium session. The artifact contains the entry path, never a machine-specific host or port. You can also run `npm run app` and pass `--target http://127.0.0.1:4173/app` to discovery. Only the configured ledger profile is supported; this is not a general-purpose arbitrary-website agent.

## Visible demo speed and guided handoff

Run the visible demo with readable defaults:

```powershell
npm.cmd run demo -- --headed --out runs/manual-demo
```

Headed commands wait **2 seconds before each automation action** and hold each result screen for **5 seconds** before closing its browser. The current target is highlighted and a status strip describes the action. Headless runs keep their fast defaults.

Override the timing when presenting:

```powershell
npm.cmd run demo -- --headed --action-delay-ms 3000 --final-hold-ms 10000 --out runs/manual-demo
```

Both values are milliseconds. Action delay accepts 0–10000 and final hold accepts 0–30000. Use 0 for both to turn presentation delays off. These settings change presentation only, not recorded capabilities or policy decisions.

The operator console enforces the sequence:

| State | Available action |
| --- | --- |
| Before claim | **Claim control**; Restore and Resume are disabled |
| Claimed, unresolved | **Restore session**; Resume remains disabled |
| Recovery verified | **Resume automation**; the completed recovery action disappears |
| Resumed or stopped | All intervention controls are disabled |

The server independently rejects premature resume requests. Replay requires the paused checkpoint to match before the console enables Resume. The responsive banking and operator screens retain the iframe/table targeting used by existing artifacts. Form labels, instructions, status feedback, and keyboard focus follow [W3C WAI form guidance](https://www.w3.org/WAI/tutorials/forms/); no formal accessibility conformance audit is claimed.

After source updates, stop an old `npm run app` process with Ctrl+C, start it again, and refresh your browser.

## Run without live services

Use the committed, genuinely discovered artifact:

```sh
npm run replay -- --artifact evidence/capability.json --member 67890
npm run replay -- --artifact evidence/capability.json --member 00000
npm run replay -- --artifact evidence/capability.json --scenario transient
npm run replay -- --artifact evidence/capability.json --scenario permission
npm run verify
```

Replay never constructs a model client. Tests that exercise the discovery control loop use an explicitly labelled `test-fixture` provider; those tests are not claimed as model evidence.

Supported fault scenarios: `notice`, `transient`, `slow`, `validation`, `permission`, `session`, `app_error`, `unknown_dialog`, and `ambiguous`. The not-found case uses member `00000`. Invalid input fails before browser launch.

## Real operator handoff

```sh
npm run handoff -- --artifact evidence/capability.json
```

The command injects session expiry and prints a private localhost operator URL. Open that URL while the command is still running:

1. Click **Claim control**.
2. Click **Restore session**. This operates the existing target browser session.
3. Click **Resume automation**. Replay verifies its paused checkpoint and continues.

The console exposes the live session through semantic controls; it is deliberately not a pixel-streaming remote desktop. The browser context and cookies remain the same. Automation is paused while the human owns the session. Actions are audited without field values. Risky transfers are blocked even for the operator. Unclaimed/abandoned handoffs time out after two minutes.

Use `--operator` on discovery/replay to enable this path for other failures. Discovery can resume after human actions and records replayable manual actions in its artifact. Without an attached operator, a failure creates a durable intervention entry and closes the browser; it cannot later resume a closed session.

`npm run test:handoff` drives this actual console with an automated stand-in for a person and saves same-session handoff evidence plus a redacted console screenshot.

## Result contract and evidence

`replay(artifact, options)` in `src/engine.ts` returns one of:

- `success`: typed `outputs`, including numeric `savingsBalance` and string `currency`.
- `business_outcome`: `NOT_FOUND` or `VALIDATION`.
- `failure`: stable error code, step, expected state, redacted observed state, and intervention ID.

Outputs are returned to the caller in memory and displayed by the demo CLI. Persisted result files redact their values. Treat stdout as sensitive if replacing this synthetic demo with real data.

Each run folder contains structured `events.jsonl` and `result.json`. Discovery also emits `capability.json`. Failures include `failure.snapshot.json`, a semantic DOM snapshot containing only approved labels, controls, heading states and filled/empty flags. Raw page HTML, screenshots of banking data, model transcript, credentials and parameter values are not saved.

See [evidence/README.md](evidence/README.md) for recorded runs, [REPORT.md](REPORT.md) for design decisions, and [schema/capability.schema.json](schema/capability.schema.json) for the exported schema. Zod also validates cross-field references and profile rules that JSON Schema alone cannot express.

## Verification and layout

```sh
npm run verify
npm run test:handoff
npm run audit
npm run schema
```

- `src/schema.ts`: capability and result contracts.
- `src/engine.ts`: discovery, deterministic replay, checkpoints, recovery.
- `src/surface.ts`: browser perception and actions.
- `src/policy.ts`, `config/policy.json`: risk, network, target and action allowlists.
- `src/handoff.ts`: live control transfer and minimal operator console.
- `src/model.ts`: real OpenAI Responses API adapter.
- `src/evidence.ts`: allowlist-based persistence.
- `src/demo-app.ts`: synthetic legacy banking UI.
- `test/system.test.ts`: behavioral unit and real-browser integration tests.

Default policy allows one exact origin, a short list of GET routes and query keys, and explicit action/control types. Review configuration and application profiles as code. This is a take-home vertical slice, not a production banking integration.

## Submission

The assignment requests a public repository and a link sent from the applicant's email address to `assignments@interface.ai`. Sending that email is a separate submission action.

## References

The implementation uses [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) for constrained discovery decisions and [Playwright locators](https://playwright.dev/docs/locators) for browser targeting.
