# T-032: Feedback and issue reports, first slice

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-030 (the planned rows and 501 convention)
- **Paths this task may touch:** `apps/demo-cloud/`, `apps/operator/src/`, `spec/openapi/paths.json`, `spec/openapi.json` (generated), `docs/api.md`, `site/llms.txt`, `tests/contract/`, `docs/operations.md`, `docs/tasks/T-032-feedback-reports.md`
- **Human gate:** no for the private store; yes for filing public issues
- **Status:** todo
- **Agent/session:** —

## Intent

Let agents report bugs, docs problems and feedback through the API, and let the operator resolve them without back-and-forth (Rafa, 2026-11-02; D39; review §8). An operator service, not protocol.

## Acceptance criteria

- [ ] `POST /v1/feedback` (Idempotency-Key): `kind` (bug, docs, feedback, feature), `summary`, `detail`, `requestId`, optional `commitmentId`, `observed`, `expected`, `client`; optional EIP-712 signature (anonymous reports still accepted). Answers `{id, status: "received", fingerprint, duplicateOf?}`.
- [ ] `GET /v1/feedback/{id}`: status (received, triaged, fixed, wontfix, duplicate) and operator replies.
- [ ] The operator attaches its own log line for `requestId` (route, status, problem type, timing) so the report is reproducible.
- [ ] Bodies that may carry deal details can be sealed to the operator's own encryption key (published in discovery) with the delivery envelope construction; no maintainers' key (D39, Rafa 2026-11-02). Before submission the agent is warned that it is choosing to share the report with this operator: the warning is in `llms.txt` and `docs/api.md` beside the route, and the prepare or dry-run response for a report carries it as a notice naming the operator. The docs tell agents never to paste secrets or plaintext. Report text is marked `x-holdback-untrusted` and never placed in a model's instruction position.
- [ ] Abuse limits (per IP bucket and per signer), size caps; a private KV store; a documented triage routine in `docs/operations.md` (list, deduplicate, reply, close). No automatic public GitHub issues.
- [ ] Contract tests, an `llms.txt` line, CI green.

## Out of scope

- Public issue filing, a web UI, protocol-level bug bounties.

## Evidence

## Decisions

## Handoff
