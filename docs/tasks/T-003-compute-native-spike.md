# T-003: Spike: agreements funded by the user's own compute or API access (R1–R4)

- **Lane:** research
- **Phase:** 0
- **Depends on:** —
- **Paths this task may touch:** `docs/research/compute-native.md`, draft update to ADR-0013
- **Human gate:** yes (ADR)
- **Status:** done
- **Agent/session:** research-lane agent, branch `t-003-compute-native-spike`

## Intent

Evaluate whether agents can form native commercial agreements using their user's compute or API access, per ADR-0013 routes R1–R4, without breaking provider terms or the neutrality test.

Restatement (research agent): find out whether two agents can strike a deal where what changes hands is paid for by their users' existing model access, not by a wallet or bank, and do it per route R1–R4. For each route, say who could stop it (neutrality test), whether Anthropic's and at least one other provider's published terms allow it (quoted clauses), whether it is buildable, and what a demo beat would show. Answer directly whether value can move as compute without moving credits. End with build / defer / drop per route and questions for an AI lab. Desk study only: no code, no accounts, no keys.

## Context

- ADR-0013; `docs/decisions-today.md` D9; Anthropic Supplemental Credit Terms (Mar 4, 2024) and Commercial Terms (Jun 17, 2025); equivalent terms for at least one other provider.

## Acceptance criteria

- [x] For R1–R4: mechanism sketch, neutrality analysis (who can stop it), terms-of-service analysis with quoted clauses, feasibility, and what a demo beat would show.
- [x] Explicit answer: does any route let value move as compute without transferring credits? 
- [x] Recommendation: build / defer / drop per route, with confidence.
- [x] List of questions to put to an AI lab (feeds demo closing).

## Out of scope

- Implementation.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

Report: `docs/research/compute-native.md`. All sources retrieved 2026-10-30.

- [measured] Anthropic Supplemental Credit Terms (Mar 4, 2024): credits may not be transferred or sold and are usable only by the account holder. Commercial Terms (Jun 17, 2025): §B assigns Outputs to the customer, §D.4(a) bars resale, §D.5 makes the customer responsible for all account activity, and nothing addresses sharing keys.
- [measured] OpenAI Services Agreement v.010126: §3.3(g) bars transferring API keys to a third party; §3.1 bars sharing credentials and reselling or leasing account access; §17 defines End Users to include consultants and agents authorized by the customer; §4.1 says the customer owns Output.
- [measured] Google APIs Terms §4b: credentials are "intended to be used by you". The Gemini API terms disclaim ownership of generated content.
- [measured] Anthropic workspaces support keys scoped to a workspace, monthly spend caps per workspace, and archiving that revokes keys within seconds. The Spend Limits API is Enterprise-only and reserves no balance.
- [measured] Searches found no first-party per-response signature from Anthropic, OpenAI or Google. Anthropic's thinking `signature` is an encrypted copy of the reasoning that the API decrypts itself. TEE-signed inference exists for open-weight models (io.net, Phala, NEAR).
- [measured] Not verified verbatim: OpenAI Service Credit Terms (HTTP 403) and Google Supplemental Paid Credit Terms (truncated fetch). Their transfer bans come from search snippets only.
- [inferred] R1 passes neutrality and is compatible with the terms checked, provided deliverables are bounded work products rather than relayed access. R2 fails neutrality at the work layer and conflicts with the OpenAI and Google terms if a key is handed over. R3 fails without attestation. R4 conflicts with ADR-0002 as a hold.
- [guessed] Tax treatment of barter: not researched; needs counsel.
- No code changed, so `/verify` and the fixture runs do not apply.

## Decisions

- R1: build (Phase 6; demo beat 9 in recorded mode). Confidence medium-high.
- R2: defer. Confidence medium.
- R3: drop as a build; keep as a question for AI labs. Confidence high.
- R4: drop as a hold; reframe as a credit payout-rail question. Confidence high.
- Value as compute: yes only as Outputs (R1) or as use in place (R2). No route makes compute a transferable unit.

## Handoff

- **Human gate (Rafa):** decide on ADR-0013. Proposed edits are in the report section "Proposed changes to ADR-0013". The ADR itself was not edited.
- **If R1 is accepted:**
  - the architect lane drafts an ADR plus a schema version bump for a linked two-leg commitment (all-or-nothing key release, liveness stake, optional balancing payment);
  - the settlement lane extends T-006 for releasing two keys in one decision;
  - the fixtures lane adds `work-for-work` and `neutrality.*` variants with a second leg.
- **Demo closing:** use the eight lab questions in the report.
- **Open:** confirm the current Anthropic Usage Policy version (the page shows "Effective Nov 12, 2026"); verify the OpenAI and Google credit clauses verbatim; get counsel on barter tax and on contractor access under the Anthropic terms.
