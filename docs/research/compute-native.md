# Compute-native agreements: spike report (T-003)

- **Task:** `docs/tasks/T-003-compute-native-spike.md`
- **Decision it feeds:** ADR-0013, D9 in `docs/decisions-today.md`
- **Date:** 2026-10-30
- **Method:** desk study. Provider terms and docs read on the web on 2026-10-30. No accounts, no keys, no code.
- **Not legal advice.** The terms analysis reads the published text. Where a conclusion depends on interpretation, the report says so and marks it for counsel.

Every claim carries a label:
- **[measured]**: read directly in a primary source cited here, or checked in this repository;
- **[inferred]**: reasoned from measured facts;
- **[guessed]**: a judgment call with no direct evidence.

## Summary

| Route | Recommendation | Confidence | One-line reason |
| --- | --- | --- | --- |
| R1. Work-for-work barter | **Build** (Phase 6; demo beat 9 in recorded mode) | Medium-high | Each party consumes only its own account and trades Outputs it owns. The two-sided hold (D8) already supplies fair exchange. Price money does not move, but the adjudication fee and the liveness stake still do. |
| R2. Buyer-supplied compute | **Defer** | Medium | Handing a key to the seller conflicts with OpenAI and Google terms and is unaddressed in Anthropic's. The buyer can revoke access mid-job and can observe work produced in its account, which breaks the two-sided hold. |
| R3. Parties fund the judges | **Drop as a build; keep as a question for labs** | High | None of the three first-party providers checked offers per-response signatures a third party can verify. Without them, a party can fake its judge's verdict. |
| R4. Provider-native hold on credit | **Drop as a hold; reframe as a payout-rail question for labs** | High | Credits cannot be transferred today. A hold held at the provider puts custody off the neutral settlement layer (ADR-0002) and gives the provider a stop button (ADR-0001). |

**Does any route let value move as compute without transferring credits?** Yes, but only as the *product* of compute, never as a transferable unit of compute. R1 moves Outputs, each produced and paid for on its owner's account. R2 moves the *use* of the buyer's compute to run the seller's method, while the seller is paid in something else. In neither case does a credit, key or balance change hands **[inferred]**. Only R4 would move credit itself, and that requires a provider change that the current terms rule out **[measured: terms; inferred: conclusion]**.

**Should R1 become demo beat 9?** Yes, in recorded mode, provided the narration states that the price is paid in work while the adjudication fee and stake are still paid in the test token. The beat needs a linked-commitment shape in `spec/schemas/`, which means an ADR and a version bump (human gate) **[inferred]**.

## Sources and quoted clauses

All retrieved 2026-10-30.

### Anthropic

**Supplemental Credit Terms**, effective Mar 4, 2024. https://www.anthropic.com/legal/credit-terms **[measured]**
- "Customer may not transfer or sell Credits, whether paid for or provided as part of a promotion" … "to any other person or entity"
- "Credits may only be used by the holder of the Anthropic account to which the Credits are associated."
- "Credits are not legal tender or currency of any kind and have no cash value."
- Credits "are non-refundable."
- "Usage Credits expire one calendar year from the date Anthropic sends the Confirmation Notice"

**Commercial Terms of Service**, dated Jun 17, 2025 on the page. https://www.anthropic.com/legal/commercial-terms **[measured]**
- §A.1: use of the Services is permitted "including to power products and services Customer makes available to its own customers and end users" (“Users”).
- §B: "Anthropic hereby assigns to Customer its right, title and interest (if any) in and to Outputs"
- §D.4(a): Customer may not "resell the Services except as expressly approved by Anthropic"
- §D.4(c): Customer may not "support any third party's attempt at any of the conduct restricted in this sentence"
- §D.5: "Customer is responsible for all activity under its account."
- §H.1: "Anthropic may require prepayment for the Services in the form of credits or offer other types of credits."
- §I.3.a: "Anthropic may suspend Customer's access to any portion or all of the Services if:" followed by listed conditions, including breach of §D.4.
- No clause addresses sharing API keys or letting a contractor act under the customer's account. The definition of Users covers the customer's own customers and end users.

**Usage Policy.** https://www.anthropic.com/legal/aup **[measured]** The page showed "Effective Nov 12, 2026", a date after the retrieval date. It is probably an announced upcoming version; verify which version governs before relying on it **[inferred]**.
- "Resell, proxy, or otherwise provide access to Claude through unauthorized means,"
- "provide others (including end users) with access to our products or services in violation of our" [policies]
- "Users are responsible for ensuring that agents they build or deploy," "including actions those agents take through tools, browsers, or connected systems," "comply with this Usage Policy."

**Workspaces docs.** https://platform.claude.com/docs/en/manage-claude/workspaces **[measured]**
- "API keys can be scoped to a single workspace. In this case, they can only access resources within that workspace."
- Spend limits: "click Spend limits to cap monthly spending and configure alerts when spending reaches certain thresholds."
- "Archiving a workspace archives every API key created for that workspace within seconds … This action cannot be undone."

**Spend Limits API.** https://platform.claude.com/docs/en/manage-claude/spend-limits-api **[measured]**
- "The Spend Limits API is available to Claude Enterprise organizations only." It caps per-member spend. Nothing in it reserves or earmarks a balance for another party.

**Thinking docs.** https://platform.claude.com/docs/en/build-with-claude/thinking **[measured]**
- The thinking block's `signature` field is "an encrypted copy of the full reasoning that you pass back unchanged"; "The server decrypts the `signature` to reconstruct the original thinking". It is not a public signature over the text output. A third party cannot use it to verify what a model said **[inferred]**.

### OpenAI

**OpenAI Services Agreement**, ONLINE v.010126 (footer). https://cdn.openai.com/osa/openai-services-agreement.pdf (PDF text extracted locally) **[measured]**
- §3.1: "Customer will not share Account access credentials or individual login credentials between multiple users. Customer may not resell or lease access to its Account or any End User Account."
- §3.2: "Customer is responsible for all activities that occur under its Account, including the activities of End Users".
- §3.3: "Customer will not, and will not permit End Users to: … (g) buy, sell, or transfer API keys from, to, or with a third party; … (i) violate or circumvent Usage Limits".
- §17, "End User": any party "who accesses the Services under Customer's Account", including "employees, consultants, customers, agents, representatives, students or any other person authorized by Customer to use the Services through Customer's Account."
- §4.1: Customer "owns all Output. OpenAI hereby assigns to Customer all OpenAI's right, title, and interest, if any, in and to Output."
- §8.2: "OpenAI may limit or suspend Customer's access to the Services if: (a) it is required to do so by law; (b) Customer violates the Agreement or OpenAI Policies; or (c) doing so is necessary to prevent or terminate a Security Emergency."
- The policy pages at openai.com returned HTTP 403 to the fetcher. **Not verified verbatim:** the Service Credit Terms clause that prepaid credits are non-transferable. It appeared only in a search snippet of a localized copy (https://openai.com/policies/service-credit-terms/).

### Google

**Google APIs Terms of Service**, last modified Nov 9, 2021. https://developers.google.com/terms **[measured]**
- §4b: "Developer credentials (such as passwords, keys, and client IDs) are intended to be used by you and identify your API Client." "You will keep your credentials confidential".
- §4a: prohibits "Sublicense an API for use by a third party."
- §3a: "Google may suspend access to the APIs by you or your API Client without notice"

**Gemini API Additional Terms**, last updated 2026-04-28. https://ai.google.dev/gemini-api/terms **[measured]**
- On generated content: "Google won't claim ownership over that content." "You're responsible for your use of generated content, and for the use of that content by anyone you share it with."
- Paid credits are governed by the Supplemental Paid Credit Terms (https://cloud.google.com/terms/supplemental-paid-credit). Search snippets say Paid Credits "may not be transferred or sold". The fetch returned a truncated page, so **this was not verified verbatim**.

### Response attestation (R3)

- No first-party per-response signature was found for Anthropic, OpenAI or Google **[measured: absence in searches; not proof of absence]**.
- TEE-hosted inference services sign responses with an enclave-bound key: io.net (https://io.net/docs/guides/confidential-inference/overview.md), Phala (https://docs.phala.com/phala-cloud/confidential-ai/gpu-tee-deployment-guide.md) and NEAR AI Cloud. These are open-weight deployments, not first-party Claude, GPT or Gemini **[measured from vendor docs; not tested]**.
- Draft standards exist, without adoption: an IETF individual draft, "Attested Inference Receipt" (March 2026), and the arXiv preprint 2603.14283, "AEX" **[measured]**.

## Common findings across providers

1. **Credits are account-bound everywhere checked.** Anthropic's terms say so verbatim. Google's and OpenAI's say so per search snippets **[measured / unverified as noted]**. No provider found offers a hold, earmark or gift primitive on credits **[measured: absence]**.
2. **Outputs belong to the customer.** Anthropic assigns them (§B), OpenAI says the customer owns Output (§4.1) and Google disclaims ownership **[measured]**. So trading Outputs is trading the customer's own work product **[inferred]**.
3. **Keys are personal to the account.** OpenAI prohibits transferring keys to a third party (§3.3(g)) and Google says credentials are "intended to be used by you" **[measured]**. Anthropic is silent on keys but makes the customer responsible for all account activity and bars reselling or proxying access **[measured]**.
4. **The provider can always suspend its own customer** (Anthropic §I.3.a, OpenAI §8.2, Google §3a) **[measured]**. Any route whose settlement path depends on a live provider account therefore has the provider as a control point **[inferred]**.

## R1. Work-for-work barter

### Mechanism sketch

1. Agents A and B sign one **linked commitment** with two legs:
   - leg A→B: deliverable `dA` against acceptance spec `SA`;
   - leg B→A: deliverable `dB` against acceptance spec `SB`.
   Both legs name the same adjudicator, fallback adjudicator and rulebook hash.
2. Each party funds a hold in the test token, for:
   - half the adjudication fee;
   - a liveness stake, sized by the rulebook (for example 5–10% of the agreed reference value of the other side's work);
   - optionally a **balancing payment** from the party receiving the larger piece of work. Unequal value is priced here, not hidden.
3. Each party produces its deliverable on its own provider account, encrypts it under a fresh key (`KA`, `KB`) and delivers per the two-sided hold (D8): ciphertext hash, plaintext hash, and the key encrypted to the adjudicators.
4. The adjudicator runs deterministic checks and the panel on each leg separately.
5. Settlement is one atomic step with all-or-nothing as the default rule:
   - **Both legs accepted:** `KA` goes to B and `KB` to A in one decision transaction; stakes are returned; the fee is paid; any balancing payment is released.
   - **Exactly one leg rejected:** no key is released. The rejected party's stake goes to the other party as compensation for compute spent; the accepted party's stake is returned. Each party keeps its own work.
   - **A party misses its delivery deadline:** anyone may trigger the reclaim. The defaulter's stake goes to the counterparty, and the counterparty keeps its own work, since its key is never released.
   - **No adjudicator decides in time:** the default outcome applies. No keys are released, stakes are returned, and the adjudicator bonds compensate per the rulebook.

### Neutrality: who can stop it

| Actor | Can | Cannot | Result |
| --- | --- | --- | --- |
| Provider of A (or B) | Suspend its own customer before that customer delivers | Affect a delivered ciphertext, keys or holds | Equivalent to a missed delivery: the reclaim and stake rule settles per the terms **[inferred]** |
| Party A or B | Withhold its own delivery; appeal with a bond | Get the other side's key without its own leg being accepted | Atomic key exchange; timeouts are permissionless **[inferred]** |
| Adjudicator | Decide within its deadline | Release one key without the other (rule-enforced) | Fallback, then the default outcome, as in `docs/neutrality.md` **[inferred]** |
| Operator, club operator, maintainers | Same as the money case | Same as the money case | Unchanged; `neutrality.*` fixtures carry over with a second leg **[inferred]** |

R1 passes the neutrality test on the same basis as the money hold. It adds no control point, because compute is consumed *before* delivery, outside the settlement path **[inferred]**.

### Terms-of-service analysis

- **Credits:** no credit moves. Each party's credits are used only "by the holder of the Anthropic account to which the Credits are associated" **[measured clause; inferred application]**.
- **Resale:** what is traded is Output, which the customer owns (§B). This sits inside §A.1, powering products "Customer makes available to its own customers" **[inferred]**.
- **Risk line:** the Usage Policy bars any party that would "resell, proxy, or otherwise provide access to Claude through unauthorized means". If a "deliverable" were in substance a stream of raw model responses on demand, it could read as proxying access **[measured clause; inferred risk]**. Guardrail: deliverables must be bounded work products judged against an acceptance spec, never a live relay or an open-ended model session. This belongs in the rulebook and the commitment schema **[inferred]**.
- The same reasoning applies to OpenAI (customer owns Output; no reselling of account access) and Google (no ownership claim on generated content) **[inferred]**.
- **Counsel needed:** barter is generally taxable at fair market value in many jurisdictions (for example the US) **[guessed from general knowledge; not researched here]**. Whether an agent-to-agent swap creates reportable income for each principal, and how to value it, is a question for tax counsel. The balancing payment and the agreed reference value in the commitment would give counsel a valuation anchor **[inferred]**.

### Feasibility

- **Reuses:** the two-sided hold (D8 / ADR-0012), atomic key release (T-006), and judgment per leg (unchanged pipeline) **[measured: present in `docs/architecture.md` and `docs/plan.md`]**.
- **New work:**
  - a linked-commitment type with two legs, a cross-leg settlement rule and a balancing-payment field. This is a schema change, so it needs an ADR plus a version bump (human gate) **[inferred]**;
  - SimChain postings for two keys in one decision;
  - property tests for all-or-nothing;
  - fixtures: `work-for-work`, a one-leg-rejected variant, a one-party-missed-deadline variant, and `neutrality.*` variants with a second leg.
- **Effort:** moderate. Roughly one settlement task and one fixtures task once T-006 exists **[guessed]**.
- **Valuation of unequal work:** left to the parties, made explicit through the balancing payment. Holdback does not price work **[inferred]**.

### Demo beat

Beat 9, "Work for work", in recorded mode only. No keys are needed, so the demo itself raises no terms question **[inferred]**.

1. Atlas offers a labelled evaluation set; Tidewater offers the cleaned dataset. Both sign one linked commitment.
2. Each funds a small hold: a fee share plus the stake, for example $25 + $100 in the test token. The viewer sees that the price line is "paid in work".
3. Both upload ciphertexts; the viewer sees only hashes.
4. Both legs pass their checks. One decision step releases `KA` and `KB` together. Each side verifies its plaintext hash. Stakes return.
5. Variant line: B's leg fails a deterministic check. No key moves, A receives B's stake, and each keeps its own work.

Narration must say: "No credits or API keys changed hands. Each deliverable was produced on its owner's own account."

## R2. Buyer-supplied compute

### Mechanism sketch

Three variants:

- **R2a, key handover.** The buyer creates a dedicated workspace with a monthly spend limit and gives the seller a workspace-scoped key. The seller runs the job and is paid from the hold on acceptance. The buyer archives the workspace afterwards. Workspace scoping, spend caps and archiving "within seconds" exist on Anthropic **[measured]**.
- **R2b, seller as an authorized user of the buyer's account.** The buyer provisions the seller's agent as a member or service account in a buyer workspace, under the buyer's account and responsibility. No key is transferred.
- **R2c, method delivery.** The seller delivers a method (a prompt pack or declarative workflow) through the two-sided hold. The buyer's own runtime executes it on the buyer's key. The seller never touches the account.

### Neutrality: who can stop it

| Actor | Power | Effect |
| --- | --- | --- |
| Buyer | Revoke the key or archive the workspace mid-job (R2a, R2b) **[measured: archiving capability]** | The seller cannot finish. There is no provider-signed evidence of revocation, so the seller cannot prove the buyer caused the miss. The default rule (reclaim to buyer) then favours the party that caused the failure **[inferred]** |
| Buyer | Observe work as it is produced on its own account: through its own proxy, logs or usage data (R2b, R2c) | The two-sided hold breaks. The buyer can keep partial or complete work and still reject **[inferred]**. Whether provider consoles expose request content to org admins was not checked **[guessed: varies by provider and settings]** |
| Provider | Suspend the buyer's account (Anthropic §I.3.a, OpenAI §8.2, Google §3a) **[measured]** | Delivery stops for reasons neither party controls **[inferred]** |

A rulebook could mitigate the first row: a kill fee paid from the hold if the seller files an "access revoked" claim and the buyer does not rebut it within a window **[inferred]**. Without provider attestation of the revocation, this moves the stop button to the adjudicator's judgment. It does not remove it **[inferred]**. R2 therefore fails the neutrality test at the work layer, though not at the money layer **[inferred]**.

### Terms-of-service analysis

- **OpenAI.**
  - R2a conflicts with §3.3(g), "buy, sell, or transfer API keys from, to, or with a third party", and with §3.1's ban on sharing credentials **[measured clause; inferred application]**.
  - R2b looks compatible on its face: §17 counts "consultants … agents … or any other person authorized by Customer" as End Users, and §3.2 makes the customer responsible for them **[measured clause; inferred application]**.
- **Google.** R2a conflicts with §4b, under which credentials "are intended to be used by you" and must be kept confidential **[measured clause; inferred application]**. R2b depends on Cloud IAM and project membership terms, which were not researched.
- **Anthropic.** There is no key-sharing clause **[measured]**.
  - §D.5 makes the buyer responsible for the seller's activity.
  - The Usage Policy bars providing "others … with access to our products or services in violation of" its policies.
  - "Users" is defined as the customer's own customers and end users (§A.1). A contractor acting for the customer is not clearly inside that definition **[measured clause; inferred ambiguity]**.
  - **Counsel or Anthropic needed:** may a contractor's agent operate under the buyer's account?
- **R2c** raises no key question. It runs into a Holdback rule instead: deliverables are untrusted and must not sit in an instruction position. Running a seller's prompt pack in the buyer's runtime does exactly that, to the buyer. The hard rule on deliverables targets judges, but the injection risk to the buyer is the same **[inferred]**.
- Handling third-party keys at all is "key handling", which is a human gate in `CLAUDE.md` **[measured]**.

### Feasibility

- **Technically feasible:**
  - R2a needs workspace scoping and a spend cap per workspace, which exist on Anthropic; the cap is monthly and has no per-key limit **[measured]**;
  - R2c needs only the existing delivery path.
- **Blocked on:** terms clarification (R2a, R2b), and a way to keep the two-sided hold when the work runs in the buyer's account. No design found does this without confidential compute **[inferred]**.

### Demo beat

None recommended now. If terms were clarified, a beat could show a buyer provisioning a capped workspace, the seller's agent delivering an outcome, and payment on acceptance. Narration would then have to concede that the buyer could revoke access mid-job **[inferred]**.

## R3. Parties fund the judges

### Mechanism sketch

- **R3a, self-reported verdicts.** Each party calls its assigned judge on its own account and posts the verdict.
- **R3b, attested verdicts.** As R3a, but each verdict carries a provider or TEE signature binding the model ID, input hash and output hash.
- **R3c, budget handed to the adjudicator.** Each party gives the adjudicator a scoped key or workspace access. The adjudicator calls the provider itself, so verdict integrity is preserved.

### Neutrality: who can stop it

- **R3a:** fails. A party can fabricate its judge's output, and a pinned model ID cannot be checked from the response alone **[inferred]**.
- **R3b:** passes only for models served with per-response attestation. None of the three first-party providers checked offers it **[measured: absence in search]**. Anthropic's thinking `signature` is an encrypted payload the API decrypts itself, not a verifiable output signature **[measured]**. TEE services exist for open-weight models **[measured from vendor docs]**. Using them would bind the panel to open-weight families, which may conflict with "at least two families" plus pinned registry models, depending on the registry **[inferred]**.
- **R3c:** the funding party can revoke mid-judgment. Its judge then abstains, and abstentions below the minimum escalate to the fallback adjudicator, so settlement still completes **[inferred from `docs/neutrality.md`]**. Problems remain:
  - a party could revoke selectively, after seeing early signals, to steer the panel's composition. Commit-reveal limits this but does not remove it **[inferred]**;
  - the deliverable plaintext would transit the party's account, a confidentiality leak against the two-sided hold **[inferred]**.

### Terms-of-service analysis

- **R3a:** no issue.
- **R3c:** the same key-handover problems as R2a, namely OpenAI §3.3(g), Google §4b, and Anthropic §D.5 plus the Usage Policy **[measured clauses; inferred application]**.

### Feasibility

The current design already lets parties fund judgment: they pay the adjudication fee in the held token, and the adjudicator buys inference **[measured: `docs/architecture.md` postings]**. R3 adds risk and saves only the conversion step **[inferred]**.

### Demo beat

None. Keep as a closing question: "Would you sign responses so third parties can verify model ID and output?"

## R4. Provider-native hold on API credit

### Mechanism sketch

The provider exposes `holds.create(amount_credits, beneficiary_org, release_signer, expiry)`, plus `release` and `refund` operations driven by a signed decision from a named adjudicator or by timeout. Credits move from the buyer's organization to the seller's on release.

### Neutrality: who can stop it

- The provider holds custody and runs the release logic. It can refuse, freeze or reverse **[inferred]**.
- That fails ADR-0001 and ADR-0002: "Custody stays on the neutral settlement layer." Fiat and card rails are funding and payout adapters only **[measured: `CLAUDE.md`]**. "One rail among many" does not cure this for funds already held at the provider **[inferred]**.
- **Compatible reframing:**
  - the hold stays on the neutral settlement layer in the test token;
  - provider credit becomes a **payout adapter**: a seller may elect to receive its release as credit on its own provider account;
  - symmetrically, credit could serve as a funding adapter only if the provider would redeem credit for value, which the terms deny ("no cash value") **[measured clause; inferred]**.

### Terms-of-service analysis

- Not possible today. Credits may not be transferred or sold, may be used only by the account holder, and have no cash value (Anthropic, quoted above) **[measured]**. Google and OpenAI appear the same, per unverified snippets.
- A payout adapter would need a provider product such as "buy credits for another organization" or "credit grant via API". None was found **[measured: absence]**.

### Feasibility

Requires a provider change. Holdback cannot build it **[inferred]**.

### Demo beat

None. Keep as a closing question, reframed: "Would you offer a credit payout rail, so a seller can take settlement as credit on its own account, rather than a credit hold?"

## Value as compute: explicit answer

- **Question:** does any route let value move as compute without transferring credits?
- **Answer: yes, in a narrow sense; no in the sense of compute as money.**
  - **R1:** value moves as Outputs, each the product of its owner's own compute. No credit, key or balance crosses accounts. This is the one route that is compatible with the terms checked and passes the neutrality test **[inferred]**.
  - **R2:** value moves as the use of one party's compute for another's benefit. It is terms-ambiguous (Anthropic) to terms-conflicting (OpenAI, Google key handover), and it fails neutrality at the work layer **[inferred]**.
  - **No route makes compute a transferable unit of account or store of value.** Each provider checked keeps credits account-bound, so price, fee and stake must still be denominated in a token on the settlement layer **[measured: Anthropic; inferred: generalization]**.

## Questions to put to an AI lab

For the demo closing:

1. **Response attestation.** Would you sign API responses (model ID, input hash, output hash, timestamp) with a key third parties can verify, so a judge's verdict can be checked without trusting the caller?
2. **Contractor access.** May a contractor's agent operate under a customer's account, through a scoped workspace or service account, to do work for that customer? Which terms govern that today?
3. **Credit payout rail.** Would you offer a way to credit another organization's account (a purchase or grant via API), so escrow settlement can pay out as credit on the seller's own account, while custody stays off-provider?
4. **Revocation evidence.** Would you emit signed evidence when a key or workspace is revoked, so a commitment can tell "the buyer pulled access" from "the seller failed"?
5. **Barter of Outputs.** Do you read trading Outputs agent-to-agent, as bounded work products, as within permitted use? Where is the line between that and "proxying access"?
6. **Model version disclosure.** Will you guarantee that a pinned model ID serves the same weights for the life of an adjudication window, and disclose any silent changes?
7. **Confidential judging.** Would you offer first-party confidential-compute inference, so an adjudicator can judge a deliverable without seeing its plaintext?
8. **Per-key spend caps.** Would you offer per-key hard caps with expiry, not only monthly caps per workspace, for short-lived, task-scoped access?

## Proposed changes to ADR-0013 (for human review; ADR not edited)

1. Record the value-as-compute answer above. Compute moves only as Outputs (R1) or as use in place (R2), never as a transferable unit.
2. **R1:** state that price is paid in work, while the adjudication fee and liveness stake remain in the settlement token. Add the all-or-nothing default and the optional balancing payment. Note that the linked commitment needs an ADR plus a schema version bump.
3. **R2:** change the neutrality cell from "Partly" to "Fails at the work layer (buyer can revoke and observe); money layer unaffected." Record that key handover conflicts with OpenAI §3.3(g) and Google §4b. Defer pending provider clarification.
4. **R3:** change to "Drop as a build. The current fee-funded adjudicator already covers party funding. Keep response attestation as a lab question."
5. **R4:** reframe from "hold primitive on credit" to "credit as payout adapter". A provider-held hold conflicts with ADR-0002 regardless of how many rails exist.
6. **Consequences:** R1 becomes demo beat 9 (recorded mode) and Phase 6 work. Questions 1–8 feed the demo closing.

## What could not be verified

- OpenAI's Service Credit Terms and Google's Supplemental Paid Credit Terms, verbatim. The fetches were refused or truncated; the transfer bans are from search snippets only.
- Which version of the Anthropic Usage Policy is in force today. The page showed "Effective Nov 12, 2026".
- Whether provider consoles expose request content to org admins, which matters for R2 confidentiality.
- Google Cloud IAM terms for adding outside parties to a project (R2b on Gemini).
- Tax treatment of barter. Not researched; counsel needed.
