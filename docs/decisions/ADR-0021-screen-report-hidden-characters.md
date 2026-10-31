# ADR-0021: Screen report and hidden-character check

- **Status:** Accepted, 2026-10-30 (D17); amended 2026-10-31 (D25: the appeal decides a flagged case)
- **Date:** 2026-10-30
- **Raised by:** the T-008 red team (PR #21, finding 9) and an independent research pass (Fable, max effort). It amends ADR-0006 and changes T-007, T-008 and T-010. The panel-threshold question from the same research is not decided here.

## Context

- **The gap.** When every deterministic check passes and the rubric is empty, the pipeline accepts without a panel, even if the screen flagged the delivery (measured, `packages/judgment/src/aggregate.ts` on `t-008-judgment-v0`; the test pins the reason "rubric is empty"). No model reads the work, so the screen has nothing to protect. But the buyer receives the raw bytes, and the buyer is often an AI agent. A payload hidden in Unicode tag characters and aimed at the buyer's own agent is accepted unchanged.
- **The attack is real.**
  - Tokenizers read tag characters, and the technique is chained with indirect prompt injection (measured: [Promptfoo, ASCII smuggling](https://promptfoo.dev/docs/red-team/plugins/ascii-smuggling/); [Rehberger, January 2024](https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/)).
  - Trend Micro measured 12 to 88 percent success against unfiltered Claude 3 and 3.5 models on Bedrock, and 0 percent with filtering (measured: [Trend Micro](https://trendmicro.com/en_us/research/25/a/invisible-prompt-injection-secure-ai.html)).
  - Anthropic's guidance is to keep third-party content in a tool-result position and label it untrusted (measured: [Anthropic, mitigate jailbreaks](https://platform.claude.com/docs/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)).
- **Legitimate data uses the same characters.**
  - The flags of England, Scotland and Wales are tag sequences, and stripping tags breaks them (measured: [UTS #51 Annex C](https://www.unicode.org/reports/tr51/#valid-emoji-tag-sequences); [Cisco](https://blogs.cisco.com/ai/understanding-and-mitigating-unicode-tag-prompt-injection)).
  - Persian text needs the zero-width non-joiner (measured: [ZWNJ](https://en.wikipedia.org/wiki/Zero-width_non-joiner)). Emoji use the zero-width joiner and variation selector 16, as in ❤️.
  - UTS #39 restricts default-ignorable code points in identifiers but exempts ZWNJ and ZWJ in context. The standard itself treats these characters in tiers (measured: [UTS #39 §3.1](https://www.unicode.org/reports/tr39/)).
- **The screen is uncalibrated.** Its false-positive rate on real data is unmeasured (guessed, per the T-008 task file).
- **Escalation does not help here.** The appeal adjudicator runs the same short circuit with an empty rubric, so an escalated case drifts to the default outcome (ADR-0007) without anyone judging the hidden text (inferred). Only a Phase 3 classifier or reader could judge it.

## Decision

1. **Deliver unchanged and surface the screen report.**
   - The delivered bytes do not change, and the plaintext hash commits to them (ADR-0012).
   - The screen's signals are part of the signed judgment record. They already are today (measured, `pipeline.ts`).
   - On the empty-rubric accept with a flagged screen, aggregation appends the reason "screen flagged; see screen.signals". The decision logic does not change.
   - The SDK must surface the report. Its decrypt helper returns `{ plaintext, screen, removed }`. By default it hands the agent a normalized view, with hidden characters stripped and counted. The raw bytes are available on request, and the hash is always verified on the raw bytes.
2. **Add an opt-in declarative check, `hidden_characters_max`.**
   - It counts tag, bidi-control, variation-selector and other invisible characters in the raw decoded text at intake, with a maximum per category.
   - Marked `required` in the terms, it rejects without a panel, like any required check. The seller sees it at offer time, and `validateCheck` applies.
   - A club rulebook may turn it on by default for its members.
   - It is a schema change, so it lands in the next schema version (v0.5 if that PR is still open, else v0.6).
3. **Defer escalation on high-risk signals to Phase 3.** A `screenPolicy` option (for example `annotate` or `escalate-high-risk`) arrives once a classifier or reader can judge hidden text. Until then, escalation would only reach the default outcome.

## Alternatives considered

1. **Keep today's behavior.** It passes all three litmus tests, but the buyer's agent is unprotected and the screen report is easy to miss.
2. **Escalate on any flag.** The screen is uncalibrated and legitimate data uses these characters, so the adjudicator could stall Persian or emoji data. It costs an appeal fee and ends in the default outcome with no judgment. It is not the parties' choice.
3. **Escalate on high-risk signals only** (tags spelling instruction phrases, bidi overrides, variation-selector byte runs, decoded instructions). Better precision, but the same degenerate path until Phase 3. Deferred as a `screenPolicy` option.
4. **Reject.** Deterministic and recomputable, but it refunds against the seller on a rule neither party wrote, and a false positive is a wrong refund.

## Consequences

- **T-008:** aggregation appends the screen reason on the empty-rubric accept. The check registry gains `hidden_characters_max`, computed from raw bytes (the red-team fixes already move checks to raw text).
- **T-007:** the SDK decrypt helper returns plaintext, screen report and removed counts, and hands the agent a normalized view by default.
- **Schema (next version):** the `DeterministicCheck` union gains `hidden_characters_max`. New screen signal kinds, if the red-team normalizer adds them, are a schema change too.
- **Fixtures (T-010):**
  - `attack.injection-tags-empty-rubric`: accepted, the screen is flagged, and the SDK shows the stripped text;
  - `attack.injection-tags-required-check`: rejected by the required check, with no panel;
  - `neutrality.seller-multilingual-text`: Persian with ZWNJ, ❤️ and 🏴󠁧󠁢󠁥󠁮󠁧󠁿 settle without a false reject.
- **Demo:** the injection scene can show "a hidden payload was stripped before your agent read it", at no model cost.
- **Agents that submit directly** without the SDK still get the public signed judgment record and its screen signals. Surfacing them is the agent's job.

## Amendment, 2026-10-31: the appeal decides a flagged case (L3-1, D25)

- **The gap (measured in code; review finding L3-1).** Aggregation escalated every flagged case at every role, and the adjudicator service turns an appeal-role `escalate` after an escalation into no decision. A screen-flagged delivery therefore escalated at the primary, escalated again at the appeal, and reached the default outcome at `appealDecideBy`: the buyer refunded and the seller compensated from the appeal adjudicator's bond. An injecting seller was paid for injecting. The context line above ("an escalated case drifts to the default outcome") named the same path for the empty-rubric case.
- **Rule.** At the **appeal** role, a screen flag or a judge's `injectionSuspected` no longer forces escalation. The flag stays in the signed record: `screen.flagged` and `screen.signals` as before, and the aggregate reasons gain "screen flagged; see screen.signals" and, when a judge flagged it, "a judge suspected injection". The appeal panel (five seats, at least three families where the registry has them, `minValidAppeal`, the policy's supermajorities) then decides by the normal rule: accept only with the accept supermajority from two or more families and a score at or above the threshold; reject with the reject supermajority; otherwise escalate. Filter abstentions, sampled data and too few valid verdicts still escalate.
- **Unchanged.** The primary and the fallback still escalate on any flag (FR-15). An appeal accept is never automatic: it needs the same cross-family supermajority as any accept, from a larger panel.
- **Why not reject on a flag at the appeal.** The screen is uncalibrated (see Context) and would refund against the seller on a rule neither party wrote; the five-judge panel reads the work.
- **Version.** `AGGREGATION_VERSION` moves from `agg-2` to `agg-3`; policies bind it, so a policy written for `agg-2` is refused at judging (`apps/adjudicator/src/policy.ts`).
- **Tests.** `aggregate.test.ts` ("aggregate: the appeal decides a flagged case (L3-1)", the oracle property), `pipeline.test.ts` ("L3-1: on the appeal template …"), `apps/adjudicator/src/service.test.ts` ("L3-1: a screen-flagged delivery escalates at the primary, and the appeal panel signs a reject Decision …", "L3-1: the fallback still escalates …"). Demo beat 6a shows it on SimChain.

## Litmus tests

- **Neutrality:** passes. No rule neither party wrote moves money. The check is opt-in through the terms or the club rulebook, and the seller sees it at offer time.
- **The hold:** passes. The bytes and the hash are unchanged, and the buyer verifies against the raw bytes.
- **Defended judgment:** passes and extends the defense past the judges to the buyer's agent. Escalating on uncalibrated signals is avoided until a classifier can judge them.
