# T-394: Answers and comments in the operator's area point at the split guides

- **Lane:** api
- **Phase:** 2 (the contract lane, `contracts-audit-ready`)
- **Depends on:** T-393 (the short guides, holdback PR 444, `541dbd8`)
- **Paths this task may touch:** `apps/operator/src/server.ts`, `apps/operator/src/openapi/index.ts`, `apps/test-agents/src/buyer.ts`, `seller.ts`, `sell-once.ts` and their tests, `apps/demo-cloud/src/world.ts`, `spec/openapi/paths.json` and the regenerated `spec/openapi.json`, `fixtures/terms/audit-report.yaml`, this file
- **Human gate:** no
- **Status:** done (holdback PR 452)
- **Agent/session:** Opus 5.5, the T-378 session; change kind 4 (text an agent reads in answers); one reviewer

## Intent

T-393 split the agent guide (`site/llms.txt`) into a short front door, one page per role (`site/buy.txt`, `site/sell.txt`) and small reference files under `site/ref/`, published at `https://crow.direct/ref/<name>`. Text in the operator's area still sends agents to sections of the old guide that moved. This task points each one at the smallest file that answers it, by URL and heading:

- the answers an agent receives (an operator problem's detail, the test buyer's 404, the test seller's page);
- the operator's own pointer to the guide, and the OpenAPI document's;
- comments that name old sections.

No route, field or schema changes. The OpenAPI document changes in description text only, so the API contract's meaning is unchanged. Non-goals: the comments under `examples/` (T-390), the guide's own text (T-393).

## Context

- `docs/tasks/T-393-short-guides.md`, Handoff: the new files and their headings.
- The coordinator's brief of 2026-11-12, which lists the pointers T-393's sweep found.

## Acceptance criteria

- [x] Each answer an agent receives names a file under `https://crow.direct/` that exists on the lane, and a heading in it that exists.
- [x] The operator's and the OpenAPI document's pointer to the guide call it the front door, which links the buyer's page, the seller's page and the reference.
- [x] No other pointer into the old guide's sections remains in this task's paths (one search).
- [x] The tests that assert an answer's text follow; `pnpm validate:spec` reports `spec/openapi.json` fresh.

## Evidence

Labels: measured, inferred, guessed. All runs on this branch, on the lane's tip `541dbd8`, 2026-11-12.

- Each target exists on the lane with the heading named [measured: the headings of `site/ref/*.txt`, `site/buy.txt`, `site/sell.txt` and `site/llms.txt`].
- The repointed text:
  - the operator's missing-id answer points to `ref/signing.txt`, "Encodings";
  - the test buyer's 404 points to `ref/http-seller.txt`, "Offer";
  - the test seller's page points to `ref/intake.txt` for "Two agents, two people";
  - the operator's `/llms.txt` and the OpenAPI document's `externalDocs` and `/llms.txt` descriptions call the guide the front door that links the two role pages and the reference;
  - the comments point to `ref/http-seller.txt`, `ref/http.txt`, `ref/http-buyer.txt`, `ref/intake.txt` and `ref/checks.txt`.
- `apps/operator/src/guide-pointers.test.ts`, new: it reads this task's files and checks that every guide pointer names a file under `site/` that exists, and a heading in it that exists. It also asserts the two answers' texts. 22 of 22 tests pass [measured].
- A second search of the operator, demo-cloud, test-agent, adjudicator and SDK code for `site/llms.txt`, a numbered guide section or "Agent intake" finds only two left, by design [measured]:
  - a comment in `apps/demo-cloud/src/live-fork.test.ts`, a fork test outside this task's paths;
  - `deploy-preflight.test.ts`, which names the file `site/llms.txt` itself, still present.
- `pnpm validate:spec`: `spec/openapi.json` is fresh. Only description text changed; no route, field or schema did [measured: the diff].
- The touched suites (operator, test-agents, demo-cloud world, `tests/contract`, the spec and site-guides tests): 636 passed [measured].
- The whole suite under load once: 6 timing tests failed (a 9 MB screen input, a check's work budget, the outside-wallet flows); the three files pass alone, 112 of 112 [measured].

## Decisions

1. **The front door keeps its URL** (`https://crow.direct/llms.txt`) in `AGENT_GUIDE` and `externalDocs`; only the words describing it change, as T-393 made it the front door.

## Handoff

- The comment at `apps/demo-cloud/src/live-fork.test.ts:64` still names `site/llms.txt` as the walkthrough's source. It is a fork test, outside this task's paths (AL-1's file list); the walkthrough now lives in `site/ref/http-buyer.txt` and `site/ref/http-seller.txt`.
