# T-032: Feedback and issue reports, first slice

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-030 (the planned rows and 501 convention)
- **Paths this task may touch:** `apps/demo-cloud/`, `apps/operator/src/`, `spec/openapi/paths.json`, `spec/openapi.json` (generated), `docs/api.md`, `site/llms.txt`, `tests/contract/`, `docs/operations.md`, `docs/tasks/T-032-feedback-reports.md`
- **Human gate:** no for the private store; yes for filing public issues
- **Status:** done (PR 121)
- **Agent/session:** implementer session, branch `t-032-feedback` (stacked on `t-031-telemetry`, PR 118)

## Intent

Let agents report bugs, docs problems and feedback through the API, and let the operator resolve them without back-and-forth (Rafa, 2026-11-02; D39; review §8). An operator service, not protocol.

## Acceptance criteria

- [x] `POST /v1/feedback` (Idempotency-Key): `kind` (bug, docs, feedback, feature), `summary`, `detail`, `requestId`, optional `commitmentId`, `observed`, `expected`, `client`; optional EIP-712 signature (anonymous reports still accepted). Answers `{id, status: "received", fingerprint, duplicateOf?}`.
- [x] `GET /v1/feedback/{id}`: status (received, triaged, fixed, wontfix, duplicate) and operator replies.
- [x] The operator attaches its own log line for `requestId` (route, status, problem type, timing) so the report is reproducible.
- [x] Bodies that may carry deal details can be sealed to the operator's own encryption key (published in discovery) with the delivery envelope construction; no maintainers' key (D39, Rafa 2026-11-02). Before submission the agent is warned that it is choosing to share the report with this operator: the warning is in `llms.txt` and `docs/api.md` beside the route, and the prepare or dry-run response for a report carries it as a notice naming the operator. The docs tell agents never to paste secrets or plaintext. Report text is marked `x-holdback-untrusted` and never placed in a model's instruction position.
- [x] Abuse limits (per IP bucket and per signer), size caps; a private KV store; a documented triage routine in `docs/operations.md` (list, deduplicate, reply, close). No automatic public GitHub issues.
- [ ] Contract tests, an `llms.txt` line, CI green.

## Out of scope

- Public issue filing, a web UI, protocol-level bug bounties.

## Evidence

- **Measured: `pnpm verify`** (`reports/verify-t-032-feedback.md`, 2026-11-03, the tree of this branch's commit). Load average was about 50 on 8 cores, from other sessions.

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 282 ms |
  | lint | `pnpm lint` | pass | 4612 ms |
  | forge build | `forge build --root contracts` | pass | 1059 ms |
  | forge | `forge test --root contracts` | pass | 18634 ms |
  | test | `pnpm test` | fail | 59275 ms |
  | spec | `pnpm validate:spec` | pass | 1355 ms |
  | snap | `pnpm snap` | pass | 20323 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 46998 ms |
  | demo | `pnpm demo` | pass | 16477 ms |

  `test` had two failures; the report's 15-line tail showed only the second, so I missed the first until CI ran.
  - `apps/operator/src/agent-ready.test.ts` expected at least 19 planned routes, and this branch serves two of them now. That was a real regression of this change; the second commit sets the floor to 17 and checks that no feedback route is still planned. All 169 operator tests pass after it (measured).
  - The 5 s timeout of `packages/testkit/src/judgment.test.ts`, as on T-031's run: the load-sensitive test in `docs/backlog.md`, in a package this branch does not touch.

  No snapshot diffs.
- **Measured: the Workers runtime.** `MIN_WINDOW_SEC=5 pnpm demo-cloud:e2e` builds both Workers, runs them in `wrangler dev` (workerd, with the World Durable Object) and plays a checks-only deal. Result: Released, final at 8.4 s, exit 0, and no exception in the output. Telemetry runs on every request there. Feedback stays off, because no KV binding exists locally.
- **Measured: `apps/operator/src/feedback.test.ts`, 8 tests:**
  - the dry run's notice names `op-fb` and its receipt signer and stores nothing, and discovery serves `feedback` with the key and the same notice;
  - a report gets 202 with the attached log line, a rephrased report of the same problem gets `duplicateOf`, `GET` serves the status and replies but not the report, and an unknown ID is 404;
  - idempotent replay, 409 on another body, and `field: "Idempotency-Key"` without a key;
  - five signed reports pass the unsigned limit of 3 under the signer's own budget, the sixth is 429, and a report changed after signing is 401 `invalid_signature`;
  - a sealed report is stored without its plaintext and opens only with the feedback secret through core's `unwrapKey` and `open`, while a node without a key answers `field: "sealed"`;
  - the hourly limit (429 with Retry-After over 3,000 s), 413 past 16 KiB, and `field` for `kind`, `summary`, `requestId` and an unknown field;
  - an instruction in the summary changes nothing, and no header value or client IP is stored;
  - a node without a desk answers 404 and serves no `feedback` in discovery.
- **Measured: `apps/demo-cloud`:**
  - the World attaches its own log line (node 1, `GET /v1/agents/{address}`, 404 `not_found`) to a report naming that request's Request-Id, and the stored report holds no address from the path;
  - a malformed `FEEDBACK_ENCRYPTION_PUBLIC_KEY` refuses to start;
  - `KvFeedbackStore` writes `fb:` and `fp:` with a 7,776,000 s (90-day) TTL.
- **Measured: `tests/contract`, 10 tests.** The dry run, the 202 and the status read validate against `spec/openapi.json`. `docs/api.md`'s rows match the document, with the two planned rows gone and no planned route left for feedback. `pnpm validate:spec` passes: 42 operations.
- **Measured: the site check.** `node site/check.mjs` passes with the "Reporting a problem" section.
- **The PR 121 review (ISSUES), and the fixes after it** (measured: `feedback.test.ts`, 9 tests):
  1. The 16 KiB cap is enforced in bytes, before parsing. An over-cap body of three-byte characters gets 413, and deep nesting gets 400 `field: "client"`.
  2. Lone surrogates are refused with their `field`, on the dry run too.
  3. The rule that a reply is read by every duplicate's reporter is in the docs and the triage script.
  4. Limits are shared by an operator's nodes (`ReportLimiter`): two nodes with a limit of 2 answer 202, 202, then 429. The daily cap is 150, within the Free plan's KV writes.
  5. The IP-retention statement is corrected, and the limiter also sweeps on status reads.
  6. `Report` is bound to the operator: a report signed for another receipt signer gets 401 `invalid_signature`.
  7. The redundant `!` are removed, `sealed` is marked untrusted, the OpenAPI patterns match the server (non-blank, lowercase UUID), and the triage script writes through a private temporary file.
- **Measured: the triage script offline.** `feedback.ts public-key` derives the x25519 public key from a test secret, and an unknown command prints usage and exits 2. The KV commands were not run: they need the namespace (Rafa's gate).

## Decisions

- **The feedback key's secret never reaches the node.** D39 says reports are sealed to the operator's own key. Here the operator is the person who runs the node. The Worker holds only the public key (the var `FEEDBACK_ENCRYPTION_PUBLIC_KEY`, served in discovery); the secret stays in the operator's `.env`, and only the triage script opens sealed reports. So a sealed report is unreadable to Cloudflare and to the running Worker. The fingerprint uses only clear fields, and a sealed report carries `detail`, `observed` and `expected` inside `sealed`.
- **`sealed` mirrors a delivery:** `{ciphertext, plaintextSha256, envelope}`, the AES-256-GCM layout and NaCl box envelope of `ENVELOPE_SPEC`, inline rather than in the ciphertext store. `@holdback/core/crypto`'s `seal`, `wrapKey`, `unwrapKey` and `open` build and open it, plaintext hash check included. There is a single recipient, the operator, so the envelope is one `SealedKey` with no `recipient`.
- **The signature is an operator-level EIP-712 type, `Report {reporter, operator, bodyHash, nonce}`,** verified with viem under the Holdback domain.
  - **Defined in the operator.** It lives in `apps/operator/src/feedback.ts`, not in `spec/schemas` or core's types: nothing on the settlement layer reads it, so no schema bump or ADR is needed.
  - **Bound to the node.** `operator` is the receiving node's receipt signer, so whoever holds a copy cannot file it at another operator in the reporter's name (PR 121 review).
  - **No expiry.** There is no `expiresAt`: a replay at the same node only files the same report again, and it is grouped as a duplicate.
- **The dry run is the warning.** `POST /v1/feedback?validateOnly=true` checks the report as it would be stored, keeps nothing, and answers the warning as a notice naming the operator ID and receipt signer. Discovery's `feedback.notice` repeats it. There is no separate prepare route.
- **`requestId` is required for a bug only.** Feedback and feature requests rarely have a failing call. `detail` is required unless `sealed` carries it.
- **A duplicate stays `received` with `duplicateOf` set**, as the task's answer shape says. Status `duplicate` is the triager's call.
- **`duplicateOf` shows a duplicate's reporter the first report's replies.** That is by design: one answer reaches everyone who met the problem. The rule that follows is in the triage routine and `docs/api.md`: a reply never quotes a report or a deal detail (PR 121 review).
- **Limits:**
  - 10 unsigned reports per client IP an hour, and 60 signed per verified signer;
  - 150 a UTC day per operator, at most 300 KV writes, against the Free plan's 1,000 a day per account (shared with early-access's sign-ups);
  - 16 KiB on the wire, checked before `JSON.parse`, plus per-field caps and well-formed Unicode.

  The counters (`ReportLimiter`) are in memory, and one operator's nodes share them. An IP is dropped at the next report or status read after its hour, or when the object restarts: not strictly within the hour, but never stored.
- **The report is parsed before anything hashes it**, as a write is shape-checked before its idempotency fingerprint. A malformed or deeply nested body is a 400, not a 500 (PR 121 review).
- **Reports are kept 90 days** (KV `expirationTtl`, review §8). `GET /v1/feedback/{id}` serves the status and replies only: the ID is the capability, and the report itself stays private.

## Handoff

- **Status: merged (PR 121, after T-031's PR 118), not deployed.**
- **Deploy (Rafa's gate), in one go** (`docs/operations.md`, Feedback triage, "Setting it up"):
  1. Create the `FEEDBACK` KV namespace and add its binding to `wrangler.op1.jsonc`.
  2. Optionally generate the feedback key into `.env` and set `FEEDBACK_ENCRYPTION_PUBLIC_KEY`.
  3. `pnpm demo-cloud:deploy`, then deploy the site so `escrow.stream/llms.txt` gains "Reporting a problem".

  Until the namespace exists, the deployed nodes answer `/v1/feedback` with 404 `not_found` (today they answer 501) and discovery has no `feedback`, while the site's `llms.txt` describes the routes. So deploy the operators with the binding before or with the site.
- **After the deploy:** POST a dry run, then a docs report, and read it back with `GET /v1/feedback/<id>`. Then `node --env-file=.env apps/demo-cloud/scripts/feedback.ts list` shows it with `logAttached` true.
- **`pnpm sim`** takes reports into memory with a feedback key derived from the label `sim-feedback`. It keeps no request log, so `logAttached` is false there.
- **Lane:** within the listed paths. `apps/operator/src/sim-world.ts` gains the in-memory desk the contract test exercises.
- **Later (backlog candidates, not filed):**
  - a honeypot field (review §8);
  - forwarding a report to another party with the reporter's consent;
  - a `needs-info` status;
  - the shared body reader stops mid-upload on 413. In the PR 121 review, the next request from the same client got `ECONNRESET` after about 6 s (measured; also at 1.1 MiB on `/v1/commitments`, so it predates this task), and the 16 KiB cap makes it easier to hit. Drain the body, or answer with `Connection: close`.
