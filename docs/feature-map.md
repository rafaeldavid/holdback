# Feature map

Each demo beat (`docs/demo.md`) maps to the scenario fixtures that prove it and the packages that implement it. A beat is done when every fixture in its row passes `pnpm snap`. Status: see `docs/tasks/T-010-scenario-fixtures.md` (Rows table) and `pnpm snap`.

| Beat | What the viewer sees | Fixtures | Packages | Tasks |
| --- | --- | --- | --- | --- |
| 1 Choose, agree and hold | Offer naming the adjudicators, adjudicator acceptance, buyer signature, one call moves price + fee into escrow | `happy-path`, `error.scope-exceeded`, `error.replay`, `error.invalid-signature`, `error.idempotency-conflict`, `error.concurrent-overdraft`, `neutrality.adjudicator-never-accepts`, `error.acceptance-mismatch`, `error.member-not-admitted` | core, settlement, sdk, operator | T-004, T-006, T-007 |
| 2 Deliver without revealing | Encrypted CSV delivered; buyer sees hashes only; key escrowed to the adjudicator | `happy-path`, `error.mime-not-allowed`, `reclaim-no-delivery` | core, settlement, sdk | T-004, T-006, T-007 |
| 3 Defended judgment | Deterministic checks, panel seed revealed, pinned judges, cross-family accept | `happy-path`, `panel-disagreement-escalates`, `error.unpinned-model-refused`, `error.adjudicator-affiliated`, `neutrality.maintainers-change-registry`, `error.policy-hash-mismatch` | judgment, adjudicator | T-008, T-009 |
| 4 Settle | Funds and content key released in one step; buyer verifies plaintext hash; receipts | `happy-path` | settlement, operator, sdk | T-006, T-007 |
| 5 Bad work | Row drop fails a deterministic check; refund; seller keeps the work | `bad-work-row-drop`, `bad-work-panel-reject`, `error.submission-limit` | judgment, settlement | T-008, T-006 |
| 6 Injection attempt | Base64 instruction flagged; no auto-accept; escalation; appeal panel rejects | `attack.injection-encoded-base64`, `attack.injection-plain`, `attack.injection-encoded-unicode-tags`, `neutrality.appeal-adjudicator-offline-after-escalation` | judgment, adjudicator | T-008, T-009 |
| 7 Nobody in control | op-1 refuses (failover, direct submit); Bench A offline (Bench B decides); club revokes mid-flight | `neutrality.operator-refuses`, `neutrality.operator-offline`, `neutrality.adjudicator-offline`, `neutrality.adjudicator-and-fallback-offline`, `neutrality.appeal-adjudicator-offline`, `neutrality.club-revokes-mid-flight`, `neutrality.buyer-silent`, `neutrality.provider-outage`, `error.revoked-agent`, `error.coverage-exceeded` | sdk, operator, settlement, adjudicator | T-006, T-007, T-009 |
| 8 Wrongful decision, paid by the bond (optional) | Bench A wrongly rejects; Bench C overturns; bond pays the seller | `appeal-overturn-bond-pays-seller`, `appeal-overturn-bond-pays-buyer`, `attack.adjudicator-self-dealing`, `appeal-bad-key-release` | settlement, adjudicator | T-006, T-009 |
| 9 Work for work (optional) | Two deliverables swapped through two-sided holds | `work-for-work` | settlement, sdk | Phase 6, if T-003 recommends it |

Every beat is narrated by `apps/demo` (T-012, T-013), and its transcript is the beat's `.expect.md` snapshot. `todo.milestone-delivery` records a known gap and belongs to no beat.
