# T-233: the demo Workers start without compiling schemas

- **Lane:** infra
- **Phase:** 2, settlement on EVM (in focus under D53: stable EVM operations; the next operator deploy needs it)
- **Depends on:** T-231 (PR 230, merged; its deploy on 2026-11-06 met the refusal). The backlog row on start-up CPU (T-213) carries the history. Rafa approved this task on 2026-11-06: "Yes, do both" (this task and a scripted deploy check that another session builds).
- **Paths this task may touch:** `packages/core/src/parse.ts`, `parse.startup.test.ts`, `validators.generated.ts`, `validators-codegen.ts` and `validators.test.ts` (new), `packages/core/scripts/validators.ts` (new); `apps/demo-cloud/src/startup.test.ts` (new); `apps/demo-cloud/scripts/embed.mjs` (the embedded files); `eslint.config.js` (one ignore for the generated file); `docs/backlog.md` (the start-up CPU row); this file
- **Human gate:** no for this PR. The deploy that shows Cloudflare's own number waits for Rafa, as every deploy does.
- **Status:** in progress
- **Agent/session:** T-233 implementer session, 2026-11-06, worktree `.worktrees/t233-startup`, branch `t-233-worker-startup`; the T-230 build for comparison in `.worktrees/t233-old` (detached at `e5f667a`)

## Intent

Cloudflare refuses a Worker upload when its start-up, the module's global scope, takes more than 1 s of CPU (code 10021, "Script startup exceeded CPU time limit"). It refused holdback-op1 on 2026-11-03 and again on 2026-11-06 at T-231's deploy, and each retry of the same build passed. Cloudflare's own numbers for nearly the same code ranged from 394 ms to over 1,000 ms (measured, at the two deploys), so the margin is too thin to rely on a retry.

This task finds what the start-up spends its time on, removes the largest cost, and adds a CI check that keeps it out. It measures first: a CPU profile of the start-up of T-230's build (`e5f667a`) and of current main (`5cb8c25`), for both Workers. The fix moves the expensive work out of module load without changing what any request does. Today `packages/core/src/parse.ts` compiles every JSON Schema in `spec/schemas` twice with Ajv when it is imported (the signed and plain validator sets). This task compiles them ahead of time into a checked-in module of Ajv standalone code, so the Worker loads plain functions instead of generating them. The target is a local start-up well below both builds, and under 400 ms in Cloudflare's own measurement at the next deploy, which leaves 60% of the 1 s limit free.

**Non-goals.**
- Deploying or uploading anything. Cloudflare's number arrives only with a real upload, which waits for Rafa.
- Any change to what the parsers accept or refuse, to the API, to `spec/schemas` or to the contract.
- The scripted deploy check (another session builds it) and the read-after-write audit (T-232, another session, in `apps/demo-cloud/src`).
- Start-up costs outside the schema compilation, unless the profile shows another one worth more than about 20 ms.
- `docs/plan.md` and `docs/log/`, which another session owns today.

## Context

- Cloudflare's limit: https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time. `npx wrangler@4 check startup` writes a CPU profile of the start-up, measured on the local machine.
- `docs/operations.md`, the T-231 deploy record: the refused upload at about 18:55 UTC, then 575 ms (holdback-op1) and 780 ms (holdback-op2) on the retry; T-230's deploy reported 394 ms and 397 ms.
- `docs/team.md`, Rules and checks, "Schemas compile at import, never in a request" (T-029): a Worker may generate code only at start-up. T-029's lazy compile took the live demo down with error 1101.
- `packages/core/src/parse.startup.test.ts`: every parser runs with `Function` disabled after import.
- The precedent for a checked-in generated file with a freshness test: `packages/settlement/evm/abis.json`, `scripts/evm-abis.mjs` and `abis.test.ts`.

## Acceptance criteria

1. [ ] **Measured before.** The task's Evidence records the start-up profiles of `e5f667a` and `5cb8c25`, the top items of each in ms, and what changed between them.
2. [ ] **No code generation at start-up.** In Node with `--disallow-code-generation-from-strings`, importing the built Worker module (`apps/demo-cloud/dist/worker.js`) succeeds, and every parser in core then runs on a valid example. The test (`apps/demo-cloud/src/startup.test.ts`) fails on today's main.
3. [ ] **Same behaviour.** For every example in `spec/examples` and every mutation of it the test makes (each value removed, nulled, or swapped for a string, number, array or timestamp), the precompiled validators return the same result and the same error list as the runtime compile they replace, for the signed and the plain set.
4. [ ] **The generated module stays current.** A test regenerates the module from `spec/schemas` and fails, with the command to run, when the checked-in file differs.
5. [ ] **Faster start-up, measured locally.** `npx wrangler@4 check startup` runs the whole start-up of both Workers (before the change it stopped at the first schema compile), and the Node module evaluation of the bundle drops well below both builds. Evidence relates the local numbers to Cloudflare's (inferred).
6. [ ] **The backlog row** on start-up CPU says it moved to T-233.
7. [ ] **`pnpm verify` passes;** its step table is in Evidence.

## Out of scope

- A start-up time budget measured in CI: CI runners vary, so a timing check would be noisy. The code-generation check is deterministic.
- Reducing the bundle's other modules (viem, the operator), which the profile shows as small.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
