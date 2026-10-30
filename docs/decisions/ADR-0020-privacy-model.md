# ADR-0020: Privacy model

- **Status:** Accepted, 2026-10-30 (D16)
- **Date:** 2026-10-30
- **Raised by:** Rafa: "it should mostly be E2E encrypted with the exception of escalated involvement of adjudicator and bond capital provider of sorts, with option to publish information." Then: "maybe for that we should use current banking patterns and compliance reporting", and "each time new escrow is initiated you can create dummy public IDs that are revealable to sellers / buyer and adjudicator if required, but publicly it's a bunch of encrypted information unless agent decides to publish it." An independent research pass (Fable, max effort) recommended options B and D below, with E as the compliance lens. It amends ADR-0012, ADR-0014, ADR-0017 and ADR-0019, and changes T-006, T-007, T-009 and T-010.

## Context

- **Today everything but the work is public.**
  - Terms, counterparties, prices, descriptions, criteria and judgment records are public through unauthenticated reads and the event log (ADR-0017, residual 9).
  - The work is encrypted, but the delivery seals the content key to all three adjudicators at once (measured, `packages/core/src/state.ts:248-251`). The fallback and appeal adjudicators can read it even when they never act (residual 6).
  - Bond backers can see every case, though they only need aggregates.
- **GDPR points the other way.** EDPB Guidelines 02/2025 (adopted April 8, 2025) advise against personal data on chain and favor off-chain storage with hashes.
- **The split costs no ID change.** The commitment ID already binds `deliverable` and `acceptance` only as `deliverableHash` and `acceptanceHash` (measured, `packages/core/src/eip712.ts:218-219`). The settlement layer and operators can verify every signature from the public fields plus two hashes.
- **Banks keep ledgers private and disclose on need to know.**
  - SAR confidentiality: FinCEN's 2010 rule, and FINRA notes that even arbitrators may not see a SAR.
  - GLBA.
  - PCI DSS tokenization keeps card data out of most systems.
  - The FATF Travel Rule moves IVMS101 identity data from one virtual asset service provider to another, never publicly.
  - California escrow agents keep segregated trust accounts and file audit reports (Financial Code 17000 et seq.).
  - Banks can also freeze funds. Neutrality forbids that (ADR-0001).

## Decision

### 1. A public skeleton and a private body

**The skeleton is public on the settlement layer and the event log.** It holds:
- the commitment ID and terms hash;
- payout addresses, token, price and fee;
- deadlines;
- the three adjudicators, the mode, and the `policyHash`, `registryHash` and `rulebookHash`;
- outcomes, bond movements and money movements.

This is what anyone needs to trigger timeouts, what the coverage gate needs, and what prevents double spends.

**The body is everything else.** That covers the description, criteria, rubric, sealed checks and judgment reasons. It is stored off-chain under its hashes and encrypted under a per-commitment record key, which is wrapped to the parties and to each adjudicator when it becomes involved.

### 2. Keys only when needed

The rule is that whoever wants judgment carries the key, and the seller is never the gate. A seller gate would turn withholding into a default that refunds the buyer and pays the seller from the adjudicators' bonds (ADR-0007).

| Path | Who gets the content key and the record key |
| --- | --- |
| Mutual settlement (ADR-0019) | Nobody but the parties. No adjudicator reads anything |
| Early acceptance | The buyer, with the payment |
| Optimistic mode (ADR-0015) | The buyer at delivery. A `Dispute` must carry keys wrapped to all three adjudicators. A dispute with a wrong key fails: release to the seller, and the disputant loses its bond |
| Guaranteed mode, primary | At delivery. The primary judges every delivery; that is the mode's stated tradeoff |
| Fallback | Wrapped to the fallback, then time-locked to the beacon round at `judgeBy` (drand tlock). Phase 1: SimChain holds the inner envelope and emits it on `fallback.triggered` |
| Appeal | An `escalate` decision must carry the appeal adjudicator's key, and so must an appeal. Backstop: tlock at `appealBy`. A missing key from an escalating adjudicator is an appeal ground against its bond |

Time-lock trust is the beacon trust ADR-0018 already accepts: only a colluding threshold of drand nodes could decrypt early. It needs the same BLS12-381 precompile (EIP-2537). Shutter and Lit could release keys on settlement-state conditions, but they would add a keyper set to the control-point table, so they are not adopted.

### 3. Disclosure is a signed term

| Level | Public | Private to parties and involved adjudicators |
| --- | --- | --- |
| `private` | The skeleton | The body, the judgment record, the work |
| `judgment` | The skeleton, the criteria and the judgment record with reasons | The rest of the body and the work |
| `public` | Everything except the work (today's model) | The work |

- Both parties choose the level at agreement, as a signed term.
- A club rulebook sets `disclosureMin`.
- An adjudicator's policy may require at least `judgment`, for precedent.
- A co-signed `Publish` can raise the level later, never lower it.
- The work is never published by the protocol. A party may publish its own copy.

### 4. Bond backers get aggregates

Backers see tranches, reserved bond, pool terms, and the rates of overturns, escalations, missed deadlines and defaults. All of these come from skeleton events (`judgment.decided`, `appeal.decided`, `bond.slashed` with a reason), so ADR-0014's signals stay recomputable by anyone.

They do not see per-case contents or counterparties. This mirrors a credit fund, whose LPs get aggregate reports (ILPA templates) and loan-level detail only as the fund agreement allows. Audit sampling, if a rulebook opts in, gets a wrapped record key under that rulebook.

### 5. Model provider privacy is a policy choice

`policy.providerPrivacy` declares one of three settings, so parties can choose:
- **`zdr`:** zero data retention by contract.
- **`tee`:** confidential GPU computing. It defends against cloud software, not against a physical insider. TEE.fail (October 2025) extracted attestation keys with a sub-$1,000 memory interposer.
- **`local`:** open-weights judges run inside the adjudicator, so no provider sees the work. Two open-weights families satisfy the two-family rule.

Residual 8, self-reported model identity, is unchanged until responses are attested.

### 6. The banking pattern, without a freeze

| Banking role | Holdback role |
| --- | --- |
| Admitting institution (KYC at onboarding, reporting duty) | Club operator, at admission |
| Processor (records, no funds) | Operator node |
| Clearing system (entries, no contents) | Settlement layer |
| Escrow case manager (contents only on dispute) | Adjudicator, when involved |
| Fund LPs (aggregate reports) | Bond backers |
| Examiner or auditor | Holder of a view key |

Compliance works at the edges and after the fact, and never through a freeze:
- **Screen before.** Use club admission and on-ramps. Deposits can be screened, as Privacy Pools does with association sets.
- **Report after.** A club operator or an operator node files the reports it owes. Filing moves no funds.
- **Disclose by view key.** A party hands an auditor the record key, or a viewing key in the style of Zcash or Penumbra.
- **Unmask through those who already know.** That means the counterparty, the involved adjudicator, and the club's admission records.

No party gets a freeze, and residual 5 (legal process) stands. A regulated operator may KYC its users and refuse to relay, as a bank refuses a customer. It still cannot stop the escape hatch. If a jurisdiction demands a freezing party, a club chooses a freezable token (residual 1); the protocol itself does not change.

### 7. Pseudonymous identity mode

At the `private` level, each party may sign with a one-time key per commitment. It is derived from a long-term meta-address in the style of ERC-5564. The link to the long-term identity is revealed only to the counterparty, and to an adjudicator when it becomes involved. Adjudicators stay public, because the parties choose them and backers price them.

| What breaks | Fix |
| --- | --- |
| Mandate and scope checks against the principal | A delegation certificate (principal-signed over the one-time key, scope and expiry), revealed to the counterparty and involved adjudicators and checked by the SDK before `agree`. Later, a Semaphore-style ZK proof that the key belongs to an admitted, mandated member |
| Daily caps and shared reputation | Per-commitment caps, plus funding caps on the one-time account. Reputation becomes selective linkage: proving to a chosen party that two keys come from one meta-address |
| Club membership and affiliation | The same certificate chain. The affiliation check runs at the adjudicator on revealed identities |
| Funding unlinkability | The funding transfer links the one-time address to its source unless it comes from a shielded pool or a fresh on-ramp account. This is outside the protocol and becomes a residual |
| Spam and Sybil offers | Operators gate offers by funding or by a club voucher |

### 8. Amounts

On an EVM chain, amounts stay public in Phase 2.
- **Confidential tokens** (Zama fhEVM, ERC-7984) decrypt through a threshold key-management service, and their token admins remain a dependency, which is an admin key in all but name. They are allowed as a rulebook `allowedTokens` option once the contract supports one.
- **Aztec** shipped its alpha network on April 1, 2026, with warnings about known critical vulnerabilities, and it does not run Solidity.
- **A privacy chain** is weighed in D4.
- **Bucketed amounts with the excess refunded** remain a later option.

### Phasing

**Phase 1, the smallest version:**
1. `disclosure.level` is a signed term. Phase 1 admits `public` only, as `randomness.source` admits `sim`.
2. Events always carry `termsHash` and `recordHash`, and carry bodies only at the levels that publish them.
3. `escalate` decisions and `Dispute` messages carry the keys their next adjudicator needs.
4. SimChain holds the fallback and appeal envelopes and releases each on takeover. Demo beat 7 can show "Bench B gets the key only when Bench A missed".

**Phase 2, with D4:**
- read authentication for bodies through an EIP-712 `ReadToken {viewer, commitmentId, expiresAt, nonce}` (preferred over SIWE's `personal_sign`, since core is already EIP-712);
- drand tlock envelopes;
- the pseudonymous identity mode;
- private judgment records;
- the `private` and `judgment` levels;
- `policy.providerPrivacy` enforcement.

## Alternatives considered

- **A. Public by default, with opt-in privacy later.** Passes all three litmus tests today. But it fails GDPR hygiene and leaves residual 9 open. Retrofitting after T-007 hard-codes payloads costs a schema break (guessed 2 to 3 weeks).
- **C. Full cryptographic privacy from Phase 2** (Aztec, fhEVM, shielded pools). It hides amounts and parties. But Aztec is alpha and not Solidity, and fhEVM depends on a key-management service and token admins. Today that fails "no admin keys", so it is deferred to D4 as a chain option.
- **E. A banking model as its own architecture,** with private records, designated disclosure roles and a freezing party. Without the freeze it is compatible with neutrality, so it is kept as the compliance lens over B and D, not as a separate design.

## Consequences

- **Schema** (v0.5, applied on PR 23):
  - `commitment.disclosure.level` (Phase 1 admits `public` only), and a reserved `privateTerms: {hash, envelopes[]}`;
  - `delivery.encryptedKeys[].unlock: {kind: 'none' | 'beacon-round', round?}`;
  - `Decision` (escalate) and `Dispute` gain `encryptedKeys`;
  - a co-signed `Publish`;
  - events carry the skeleton plus hashes, with bodies by level;
  - `judgment.privateRecord: {hash, envelopes[]}`;
  - rulebook `disclosureMin` and `identityModes`;
  - adjudicator policy `providerPrivacy` and `disclosureMin`.

  `ReadToken` and problem `unauthorized` land in Phase 2.
- **State machine:**
  - `deliver` keeps the four-envelope rule and honors `unlock`;
  - `escalate` requires an appeal envelope;
  - `Dispute` requires three envelopes;
  - pseudonymous `agree` takes a certificate hash as a fact.
- **T-006** releases fallback and appeal envelopes on takeover, enforces the key guards, and emits events by level. **T-007** serves bodies by level and defers read authentication. **T-009** gives fallback and appeal adjudicators keys only on takeover. **T-010** adds fixtures for key-on-takeover and for the disclosure level.
- **Residuals** (`docs/neutrality.md`):
  - 6 narrows to the primary in guaranteed mode, and to the fallback and appeal adjudicators only on takeover;
  - 9 narrows to the public skeleton;
  - a new residual covers funding linkability;
  - the beacon row notes that early key release needs threshold collusion.
- **Demo:** beat 1 shows the parties choosing `public`. Beat 7 can show the fallback getting the key only when it takes over.
- **Design map:** the "Who sees what" view shows one matrix per level.

## Litmus tests

- **Neutrality.**
  - Timeouts, coverage gates and settle-once need only the skeleton, so anyone can still trigger them.
  - No party gets a freeze, and key release never depends on the seller.
  - Time-locks rest on the beacon trust ADR-0018 already accepts.
  - Passes.
- **The hold.** Funds and keys move as before. The fallback's key is released by the settlement layer (SimChain in Phase 1, tlock in Phase 2), not by a party. Passes.
- **Defended judgment.** Every adjudicator that must decide still gets the body, the work and the key. Model provider exposure becomes a stated policy choice. Residual 6 narrows. Passes.

## What would change this decision

- **The AI-lab audience prefers readable records.** Then the default becomes `judgment`, still a choice.
- **The D4 chain lacks EIP-2537.** Then both tlock and drand fail. Keep SimChain-style held envelopes, and record fallback plaintext access as residual 6b.
- **Counsel says a target jurisdiction needs a freezing party.** Then compliance moves into the club's token choice.
- **Audited, cheap ZK mandate proofs arrive.** Then scope checks move back on chain for the pseudonymous mode.
