# T-038: Public docs cleanup (README, license, statuses, privacy)

- **Lane:** docs
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `README.md`, `LICENSE`, `docs/**` (not `docs/decisions/` beyond status lines and wording), `brand/*.md`, `config/*.template`, `.claude/agents/*.md` (wording only)
- **Human gate:** no for the PR; repository settings (description, homepage, topics) are Rafa's
- **Status:** done (PR 110)
- **Agent/session:** docs agent, then the coordinating session for review fixes (PR 110)

## Intent

The repository is public and is read by people deciding whether to trust the project. Make what it says match what is merged and on disk, lead with the product, give it a license, and keep personal details and third-party copies out of public files. Non-goals: no code, schema, contract or defense change; no change to the litmus tests or to Rafa's priorities in `CLAUDE.md`.

## Context

- Rafa's decisions (2026-11-03): Apache-2.0; a README that leads with ’crow, "Programmatic Escrow and Arbitration", with Holdback as the protocol and EIP-712 domain.
- `CLAUDE.md` (litmus tests, hard rules), `docs/neutrality.md`, `docs/plan.md`, `docs/feature-map.md`, `docs/decisions-today.md`.

## Acceptance criteria

- [x] `README.md` leads with ’crow and every claim in it is true today on the public demo or says where it is true (local chain, Phase 4).
- [x] `LICENSE` is the standard Apache-2.0 text.
- [x] The scenario index in `docs/plan.md` has a Status per fixture that matches `fixtures/scenarios/`, and the same beats as `docs/feature-map.md`.
- [x] `docs/neutrality.md` names only fixtures that exist, and marks the rest planned.
- [x] No personal email, account ID, `workers.dev` subdomain, absolute local path or private artifact link in the files this task touches.
- [x] `CLAUDE.md` and `.claude/agents/architect.md` unchanged.

## Out of scope

- GitHub repository settings, the site wording ("verifiably neutral", "jurisdiction"), backlog triage, `prompts/`.

## Evidence

- `pnpm snap`: 32 passed (31 scenarios plus `_example`; 6 are `todo.`) [measured]
- `forge test`: 168 passed in 21 suites [measured]
- Two reviewer passes (reviewer subagent, then the coordinating session's review): 7 and 7 findings, all fixed on the branch [measured]
- `git merge-tree` against main: no conflicts; `pnpm map` and `node site/build.mjs --out` change no tracked files [measured]

## Decisions

- `CLAUDE.md` keeps its wording, including the SDK mentions that D30 made stale; changing it is Rafa's call (listed in Handoff).
- The private design-map link stays only in `.claude/commands/map.md`, which needs it to republish.

## Handoff

- For Rafa: `CLAUDE.md` still says the operator serves an "SDK" (D30 dropped the SDK), "First product priority" names the Phase 1 demo, and litmus test 1 (line 26) says each actor has a `neutrality.*` fixture while `docs/neutrality.md` lists eight as planned. Reword if you want.
- A test that docs claim only fixtures that exist is proposed in `docs/team.md` (Rules and checks).
