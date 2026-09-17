# Architecture and security self-review

This review covers a local synthetic assessment system, not a deployed banking
service. It is a code review plus automated negative testing, not independent
penetration testing or a compliance certification. No breach was observed in these
tests; that does not establish that every vulnerability has been eliminated.

## Review loop and changes

| Finding                                                                                                  | Change                                                                                                           | Regression evidence                                      |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A table selector selected the second cell across all matching rows, potentially masking duplicate fields | Select the second cell in each matching row; reject multiple matches                                             | Ambiguous-target tests, reviewed binding tests           |
| Output declarations could omit or weaken the expected balance contract                                   | Enforce exact output names, types, targets and sensitivity in trusted policy                                     | Output-contract tampering test                           |
| Discovery/replay separation depended on caller discipline                                                | Model constructor rejects replay evidence; count attempted calls before network access                           | No-model guard test and benchmark metrics                |
| Client-authored validation could manufacture approval                                                    | Reviewer requests server-executed 38-case validation; request schema rejects report injection                    | API authorization and lifecycle tests                    |
| Approval could outlive changes to trusted execution code or dependencies                                 | Bind validation to a normalized source/dependency digest; demote stale approvals and clear activation on restart | Restart and stale-digest regression test                 |
| Concurrent requests could race before JSON parsing                                                       | Acquire execution lease before reading body; release on parse error or disconnect                                | Concurrency and aborted-request tests                    |
| A failed registry write could leave uncommitted state active in memory                                   | Restore last committed snapshot on persistence failure                                                           | Filesystem failure-injection test                        |
| Local browser requests could target service through an unexpected host                                   | Exact bound Host and Origin checks, random bearer tokens, no CORS                                                | Raw HTTP forged-Host test and cross-origin tests         |
| Operator endpoint lacked some defensive HTTP settings                                                    | Add exact Host, JSON type, no-referrer/nosniff and request timeouts                                              | Existing handoff flow plus API negative tests            |
| New console could render artifact text as markup                                                         | Only textContent for dynamic data; external script with restrictive CSP                                          | Malicious-description browser test; no page errors       |
| Timeline and notices could retain stale completion state                                                 | Update notices on job transitions; scrollable timeline                                                           | Actual desktop/mobile console test and screenshot review |

The first expanded test run found a defect in the forged-Host test: Node fetch
replaced the supplied Host header. A raw HTTP test now sends the intended request
and confirms rejection. This was not treated as proof that the server was secure
until the corrected test ran. The earlier Chromium screenshot capture failure
remains documented in the previous test-review evidence.

## Control mapping

Reviewed against [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
and [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
These sources guide implementation; they do not certify this project.

| Area             | Implemented control                                                                                       | Scope / limitation                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Authentication   | 256-bit random tokens; constant-time equality; tokens regenerated on startup                              | Local reviewer/runner roles, no SSO or named identities                           |
| Authorization    | Check role on each lifecycle endpoint; run only active approved releases through API                      | Both roles share one synthetic workspace; no tenant isolation claim               |
| Workflow order   | Validate → approve → activate; rollback only to previously active approved version                        | Direct developer CLI remains an explicit ungated testing tool                     |
| Injection / SSRF | Strict Zod bodies; fixed app origin; no client URLs/policies/paths; exact browser route/action allowlists | Does not safely automate arbitrary hostile third-party apps                       |
| Resource limits  | 64 KiB body, request timeouts, 600 requests/minute, one active job, last 100 jobs retained                | Local limits, not distributed DDoS protection; disk retention is operator-managed |
| Browser UI       | CSP, no framing, no sniffing, no referrer; safe DOM text                                                  | Inline styling remains permitted; no external scripts or assets                   |
| Data             | Redacted disk outcomes/logs; typed outputs returned only in authenticated in-memory jobs                  | API clients must protect outputs; only synthetic screenshots are published        |
| Integrity        | Artifact and runner/dependency digests, immutable versions, atomic file replacement, process lock         | No signing key; a user controlling the filesystem can rewrite state and hashes    |
| Failure          | Bounded recovery, exact output/member verification, incompatible UI stops, no AI repair on replay         | Preflight checks known contracts, not every possible UI change                    |
| Evidence         | Every benchmark trial retained; expected denials separated from wrong results                             | Finite synthetic testing is not a production reliability guarantee                |

OWASP recommends HTTPS for exposed services. This implementation deliberately binds
HTTP only to 127.0.0.1; do not expose it through a public proxy. Network deployment
requires TLS, managed identities, authorization per user and tenant, retention and
encrypted storage policies, hardened browser workers, and an independent review.

## Architecture conformance and remaining cuts

All five additions use the existing engine and policy. Both layouts belong to the
same synthetic product; they are not two real bank integrations. Application label
bindings are reviewed source code, not model-supplied selectors. New releases must
pass validation on both layouts. A benchmark artifact digest identifies the exact
capability; timing measurements depend on the environment recorded in the report.

The registry is durable, but job history and typed outputs are process-local.
Validation run IDs survive in the registry, and all run files remain on disk. The
console's recent-job list is reset when the service restarts. The registry lock is
released on normal shutdown; after a crash, verify that the owning process has
stopped before removing the empty `.lock` directory. No automatic stale-lock
takeover is performed. Validation and approval are bound to the artifact and a hash
of trusted runner/binding/approval code, policy configuration and dependency lockfile.
On restart, a changed hash automatically demotes affected releases to candidates,
clears their active pointers, and records invalidation. Revalidation is required.
Line endings are normalized so a Windows checkout does not alone change the hash.

Persisted snapshots are not transactionally durable against every power-loss case:
atomic replacement prevents partially written JSON, but there is no database WAL or
fsync durability guarantee. Local administrators and files in the workspace are
trusted. This boundary is explicit, not an unimplemented production promise.

## Verification

Run `npm run verify`, `npm run test:handoff`, `npm run benchmark -- --count 100`,
`npm run audit`, and `npm audit`. Live discovery is separately exercised using the
locally configured model key. See `evidence/platform/` for the recorded final
measurements and `MANUAL_TESTS.md` for human verification. Tests and benchmark trials
are not automatically retried to conceal first-attempt failures.
