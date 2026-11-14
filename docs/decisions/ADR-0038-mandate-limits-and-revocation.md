# ADR-0038: A mandate is a permission others check; a spending limit lives with the money

- **Status:** Proposed, 2026-11-14 (D69). Adopted by T-415 under the repository's autonomy rule; Rafa may overrule any line. Nothing here is built.
- **Raised by:** T-415. Enterprise-readiness research on 2026-11-13 (kept privately, `docs/private-materials.md`) found four gaps between what a mandate says and what stops an agent. Rafa asked on 2026-11-14 for the work that is ready. Research: this note (code read at the commit below; nothing run), one independent research pass, one dated check of outside standards, and one reviewer pass (last section).
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0015 (user choice), ADR-0017 (the mandate is the standing approval), ADR-0024 section 7 (per-deal keys and the `Delegation`), ADR-0031 (the phase-one contracts; contract signers stay), ADR-0033 (the payment address); D22, D26, D31, D32, D35.
- **Amends:** ADR-0024 section 7, in one point: the adjudicator's check of a `Delegation` is optional, and the counterparty's check is the one a party relies on (section 1).
- **Changes when built, by later tasks:** `apps/operator`, `packages/settlement`, `apps/demo-cloud` (the store), `packages/testkit`, `fixtures/`, `examples/` (the reference clients), the guides under `site/`, and `spec/` (one additive version, then one version that changes a signed struct). No change to `contracts/src/`. This record changes no code.

Labels: **measured** (read at the cited line at commit `b9e33a9b`, `origin/main` on 2026-11-14), **documented** (stated in the cited doc), **inferred** (from reading, not from a run), **guessed**. Nothing was run.

Short forms: `S:` is `packages/core/src/state.ts`, `P:` is `packages/core/src/private.ts`, `E:` is `packages/settlement/evm/evm-settlement.ts`, `R:` is `contracts/src/HoldbackRules.sol`.

## Summary

**Today only the operators that relay a deal check a mandate's limits, and an agent can route around an operator.** The contracts fund a deal on four signatures: the seller's, the primary adjudicator's, the buyer's, and the payment address's authorization for one deal's price plus fee. They read no mandate [measured]. An agent that holds a signing key and can sign for a funded payment address can fund a deal through any operator, or with no operator.

**That is the right place for the line, and Crow should say so.** A company's money leaves through one door: the payment address's signature. The company controls that door with its own wallet. A mandate does a different job: it tells counterparties which key acts for the company, and within what bounds.

**The decision, one line per question:**

1. **Where limits are enforced.** The spending limit is the payment address: its balance, who can sign for it, and the company's own wallet policy. The mandate is a signed permission that those who rely on it check: the counterparty before it signs, and each operator before it relays, as that operator's stated policy. The contracts read no mandate.
2. **`categories`.** Remove it. Nothing can check it, and the mandate's club already names the market. The removal waits for the next version that changes a signed struct.
3. **The daily cap.** Each operator counts the deals it relays, and the guide says so. No shared count is built. The hard daily limit is the balance the company keeps on the payment address.
4. **Revocation before expiry.** A revocation is a signed notice. Any operator takes it from anyone, serves it and stops relaying new offers and agreements for that agent. It never touches a funded hold. A counterparty treats an agent as revoked when any one operator serves a valid revocation. The company's hard stop is the payment address.
5. **The richer mandate.** It changes no answer above. The protocol carries the format of a permission and its revocation, so anyone can verify them. The company's wallet and signing tools enforce amounts, co-signatures and allow-lists. Delegation to sub-agents is a chain of signed permissions that the relying party intersects.

**How to read this in ten minutes:** this summary, the table under "What enforces each field today", and the bold recommendation at the top of each of the five sections.

## What enforces each field today

The scope has five fields (`spec/schemas/common.schema.json:58-97`). The mandate that carries it is the principal's EIP-712 signature over `{principal, agent, clubId, scope, nonce, issuedAt}` (`packages/core/src/eip712.ts:252`).

| Field | The contracts | The operators | The counterparty | The adjudicator |
| --- | --- | --- | --- | --- |
| `roles` | Not read [measured] | Checked for the seller at the offer and for the buyer at the agreement and at funding (`S:215`, called at `S:235`, `S:312`, `S:337`) [measured] | For a per-deal key only: `verifyDelegation` checks the role (`P:199`), and the reference agent then checks the certifying agent's mandate (`examples/agent.ts:320-323`). One test calls it (`examples/private.test.ts:82`); no reference flow does [measured] | Not checked: no file under `apps/` reads a `Delegation` [measured] |
| `maxPerCommitment` | Not read | Checked against the price at the same three steps (`S:216-218`) | As above (`P:201-202`, `examples/agent.ts:323`) | Not checked |
| `maxDaily` | Not read | Checked for the buyer at the agreement only (`S:314-318`). Each node keeps its own count by buyer address and UTC day (`E:1185-1186`, `E:1195-1196`). A deal funded on chain without this node's relay is not counted (`E:2214-2219`) [measured] | Not checked: `verifyDelegation` does not read it (`P:194-204`) | Not checked |
| `categories` | Not read | Not checked. It is signed (`packages/core/src/eip712.ts:104`) and nothing reads it. The terms have no category field to compare it with [measured] | Not checked | Not checked |
| `expiresAt` | Not read | Checked at the same three steps (`S:214`) | As above (`P:200`) | Not checked |

Eight more facts decide the questions:

1. **The contract funds on four signatures.** `agreeAndFund` checks the seller's, the primary adjudicator's and the buyer's signatures (`R:181-183`) and passes the payment address's ERC-3009 authorization to the escrow (`R:191`). The words mandate, scope, revocation and delegation do not appear under `contracts/src` [measured, `git grep`].
2. **The operators' checks are their relay policy, and the code says so.** A node that finds a deal funded on chain joins it with a scope that allows everything: "the mandate checks are this node's own policy for what it relays" (`E:2196-2197`) [measured].
3. **A per-deal key gets no operator check.** In a club that admits pseudonymous keys, a private deal's signer without a mandate passes with a scope equal to the deal's price (`E:891-896`). ADR-0024 section 7 leaves its scope to the counterparty and the adjudicator [measured].
4. **Every role may be a contract.** The contract checks a signature by ECDSA for an address without code and by ERC-1271 for one with code (`R:567-571`). Rafa kept this on 2026-11-11 (ADR-0031). A contract wallet can be the payment address (ADR-0033) [documented].
5. **No route takes a company's own mandate.** `POST /v1/agents` answers 501 (`docs/api.md:345`). Mandates come from a node's genesis or from the test service's faucet, which signs with the demo club's own test principal (`site/ref/http.txt:81`) [documented]. On the test service a mandate is an admission to the club, not a company's permission.
6. **The two live operators share one store** (`apps/demo-cloud/wrangler.op2.jsonc:22`), so the test service has one daily count today. Two independent operators would have two [inferred].
7. **Revocation is typed and has no handler.** `AgentRevocation {agent, principal, nonce, expiresAt}` is in the schema ("blocks new commitments only"), the types and the signing code (`packages/core/src/eip712.ts:187`). `POST /v1/agents/{address}/revoke` answers 501 (`docs/api.md:346`), and the testkit refuses the step (`packages/testkit/src/scenario.ts:177`) [measured].
8. **One operator message is wrong.** The `scope_exceeded` problem tells an agent that its mandate's categories "must cover the deal" (`apps/operator/src/problems.ts:26`). Nothing checks categories [measured].

No scenario fixture exercises a scope refusal today: no file under `fixtures/scenarios/` names `scope_exceeded`, `mandate_expired` or `maxDaily` [measured, `git grep`].

## Decision

### 1. Where each limit is enforced, and what Crow tells a company

**Recommendation: two layers, named apart. The spending limit is the payment address. The mandate is a permission that the parties who rely on it check. The contracts read no mandate.**

**The spending limit is the payment address.**

- Funds leave a company through Crow in one way: the payment address signs an ERC-3009 authorization for one deal's price plus fee, payable only to the escrow's collector, valid until the deal's `fundBy` (`R:191`, ADR-0033). No operator, adjudicator, counterparty or contract can move more.
- So the company sets its limit where that signature is made. It has three tools, all its own:
  - **The balance.** The payment address holds the budget and no more. With the two addresses of ADR-0033 the agent's signing key holds nothing.
  - **Who signs.** The agent holds the payment key, or the company keeps it in a wallet service that signs on request, or the payment address is a multisig or a smart account.
  - **A policy at signing.** A wallet service or a co-signer sees the typed data it is asked to sign: the collector, the value and the deadline. It can refuse above an amount, refuse any message but a funding, and check the deal's terms first. Two of the three policy services read for this record state rules on EIP-712 fields ("How others carry the same ideas").
- **Two limits of these tools, stated now so nobody builds on a wrong picture.**
  - A token checks a contract wallet's authorization with a read-only call that receives a hash [inferred from ERC-1271]. The wallet can check who signed. It cannot count spending or read the amount in that call. An on-chain spending module meters transactions, and a funding is a signature.
  - None of the three policy services read counts a total over a day for typed-data signatures [checked on their pages, 2026-11-14].
  - So the hard cap per day is the balance: the company tops up the payment address by the day's budget. A company that wants a counted cap runs its own co-signer.
- This is Rafa's rule of 2026-11-12: a funded wallet is a funded wallet. The protocol enforces what the parties signed and sets no limit of its own (D31, D32).

**The mandate is a permission others can check.**

- It states which key acts for a company, in which club, in which roles, up to what price per deal, until when. It is signed, so anyone can verify it without trusting Crow or an operator.
- **The counterparty** checks it before it signs: the principal's signature, the club, the role, the cap against the price, the expiry, and that no revocation is served (section 4). This is a check a party runs for itself (D32). It gives the counterparty evidence that the agent acted within its stated authority (D26). The reference clients gain this check; today only a test calls it.
- **Each operator** checks it before it relays, as today. The guide calls it what it is: the operator's relay policy. It stops an honest agent's mistake. It does not stop an agent that goes to another operator or to the contract.
- **The adjudicator** may check a `Delegation` before it accepts and may decline. It is not required to. ADR-0024 section 7 named the adjudicator as a checker; nothing built does it, and the counterparty's check carries the weight.

**An operator's check cannot censor.** An operator that answers `scope_exceeded` wrongly, or holds back a mandate it was given, has refused to relay. The agent sends the same signed messages through another operator or to the contract, which asks no operator (`neutrality.operator-refuses`, `neutrality.operator-offline`). This holds only while the contracts read no mandate.

**What Crow tells a company.** The guide gains this table. The task that owns the guide writes the final text.

| What you want | What enforces it | Who can get around it |
| --- | --- | --- |
| My agent can never spend more than X in total | The balance on the payment address | Nobody |
| A person or a rule approves each payment, or each payment above X | Your wallet: you hold the payment key in a wallet service, a multisig or a smart account | Nobody without that wallet's approval |
| My agent stays under X per deal, in these roles, until this date | The mandate, checked by the operators you use and by a counterparty that checks | An agent that holds a signing key and a funded payment key, dealing with a counterparty that does not check |
| My agent stays under X a day | Each operator's own count of the deals it relays. For a hard limit, top up the payment address daily | The same agent, and any agent that uses two operators or per-deal keys |
| Cut my agent off now | Empty the payment address or change who signs for it. Then publish the revocation | Nobody, for the money. The revocation is a notice (section 4) |

**Options weighed.**

| Option | Neutrality | The hold | Cost | Verdict |
| --- | --- | --- | --- | --- |
| (a) The paying wallet's own policy | No party gains a move: the company limits its own signature | Unchanged | None in the protocol. The company runs its wallet | **Adopted** for the spending limit |
| (b) The settlement contracts check the mandate | A check no party can route around makes each of its refusals a way to stop a deal. A registry anyone but the principal writes breaks the test. A daily count cannot see per-deal keys | Unchanged | About 15,000 to 45,000 gas on a funding of 233,994 gas [guessed; the base is measured in T-351]: one more signature, a nested struct with string arrays, a counter slot per buyer and day. A new signed type in the contract. A link from principal to agent to deal on a public chain, against D35 and ADR-0024. Not possible before the pilot: the contracts are frozen | Rejected for phase one. Section 5 leaves room for an opt-in |
| (c) The operators, as today, stated as operator-level | Passes: an operator that refuses is routed around | Unchanged | Guide text | **Adopted**, with the words |
| (d) The counterparty and the adjudicator check before they sign | Passes: each checks for itself and can only decline its own signature | Unchanged | The reference clients, small | **Adopted** for the counterparty; optional for the adjudicator |

**Fixtures.** `error.scope-exceeded-cap` and `error.mandate-expired`: an operator refuses an agreement above the cap, and one after the expiry. They pin today's behaviour, which no fixture covers. **Schema:** none.

### 2. The `categories` field

**Recommendation: remove it. Until the removal, say that nothing checks it.**

- **Nothing can check it today.** The terms carry no category. In a private deal the operator cannot read the deal's bodies at all (ADR-0024).
- **Checking it needs more than a check.** It needs a category field in the signed terms, which moves every commitment ID, and a list of categories that someone owns. That is content, and the protocol is rails (D35).
- **The club already does the job.** A mandate names one club (`packages/core/src/eip712.ts:252`), and a node keys its mandates by agent and club (`E:892`). A company that limits its agent to one market gives it a mandate in that market's club.
- **What a company's agent buys is the company's tooling to decide** (D32).
- **The removal changes a signed struct.** `Scope` sits inside the `Mandate` and `Delegation` typed data (`packages/core/src/eip712.ts:99-106`). Under the rule in `docs/architecture.md` (Identity and signing) the EIP-712 domain version moves with it, from 0.8 to 0.9, and the contract pins the domain (`R:574-575`). So the removal needs a contract redeploy and must not ship before the pilot.

**Schema:** the next version that changes a signed struct (v0.12 if no other version lands first), with the EIP-712 domain at 0.9. It should be the same version that carries the richer mandate's fields (section 5), so the domain moves once. Not made here.

**Before that, text only:** the `scope_exceeded` problem stops naming categories, and the guide says the field is signed and not enforced.

**Fixtures:** none. The hash vectors move with the version.

**Alternative: check it at the agreement.** Rejected for the three reasons above. **Alternative: keep it as a label nobody enforces.** Rejected: a signed limit that nothing checks misleads the company that sets it.

### 3. The daily cap across operators

**Recommendation: each operator counts the deals it relays, and the guide says so. Build no shared count. `maxDaily` stays a signed statement of the company's bound.**

- **A single count needs a single place, and each candidate fails.**
  - *The contract.* Rejected in section 1. It also cannot count across per-deal keys, where each deal has a fresh buyer address.
  - *The operators agreeing among themselves.* That is a consensus protocol between operators for one number. An operator that withholds its count stalls the others.
  - *Each operator summing the chain's `JobFunded` events* (`R:189`). It needs no contract change and gives every operator the same number. It counts the hold and not the price, it misses per-deal keys, and an agent still passes it by going to the contract. An operator may offer it as its own policy. It is not required, and not built now.
- **The cap that holds is the balance.** A company that wants a hard daily limit tops up the payment address by that amount each day.
- **`maxDaily` keeps a use as a statement.** A principal can show that its agent went past a signed bound (D26). Whether period caps stay in the mandate at all is for the richer mandate's design (section 5).
- **For per-deal keys nothing changes:** ADR-0024 section 7 already says the principal's agent enforces its own budget.

**Fixtures:** `error.daily-cap-at-one-operator`: a buyer reaches the cap through op-1, op-1 refuses the next agreement, and the same agreement funds through op-2. The snapshot states the boundary. **Schema:** none.

### 4. Revocation before expiry

**Recommendation: a revocation is a signed notice. Any operator takes it from anyone, serves it, and stops relaying new offers and agreements for that agent. The line is the hold: a revocation never changes a funded deal. A counterparty treats an agent as revoked when any one operator serves a valid revocation. The company's hard stop is the payment address.**

**Who signs, and what it covers.**

- The principal that a mandate names signs `AgentRevocation {agent, principal, nonce, expiresAt}`. The type needs no change.
- It ends every mandate that principal gave that agent, in every club, and every `Delegation` that agent certifies under them.
- **`expiresAt` is the time until which the revocation holds.** The principal sets it at or after the last expiry of the mandates it ends. While it holds, an operator also refuses a new mandate from that principal for that agent. A company that wants the agent back gives a mandate to a new key.
- This keeps the set of revocations grow-only until each one expires. No rule is needed to order a revocation against a later mandate, and no signed struct changes.

**Where it is stored, and how it travels.**

- Each operator keeps the revocations it has accepted, beside its mandates.
- `POST /v1/agents/{address}/revoke` takes one from anyone. The signature is the authority, not the sender. The route is already in `docs/api.md` as planned.
- `GET /v1/agents/{address}` serves `status: revoked` with the signed revocation, so a reader can verify it and post it to another operator.
- The principal posts it to each operator it knows. An operator may also pull its peers' revocations. No operator-to-operator protocol is required.

**Who must honour it.**

- **An operator that holds a valid revocation** refuses to relay an offer or an agreement by that agent, with a new problem `mandate_revoked`.
- **A counterparty's client** reads the agent from every operator it uses. It treats the agent as revoked when any one of them serves a revocation whose signature verifies. One honest operator is enough.
- **The contracts** do not read it in phase one.

**Deals already agreed or funded.**

- **A funded deal is untouched.** No operator checks a mandate at a delivery, a decision, an early acceptance, a settlement or a timeout: the scope check runs at the offer, the agreement and the funding only (`S:235`, `S:312`, `S:337`) [measured]. This decision keeps it so. A revoked agent's signatures on its open deals stay valid. Otherwise a principal could revoke its agent to stall a deal it now regrets, and the other party would pay for it.
- **Before the hold exists, the revocation stops an honest operator's relay.** On a chain the agreement and the funding are one transaction, so nothing is half done. Nothing is held, and the offer expires.
- **A signed funding that is not yet used can be cancelled at the token,** where the token has ERC-3009's optional `cancelAuthorization`. Circle's USDC code has it; the Sepolia test token does not [measured: `contracts/script/LocalUSDC.sol:91` has it, `TestUSDC.sol` does not]. Moving the balance works on every token.
- **The loss on an open deal stays bounded by its hold** (`docs/neutrality.md`, residual 12; D22).

**How two operators stay in agreement.** They do not have to agree for settlement to be safe. The chain decides which deals exist, and a node joins a deal funded elsewhere without a scope check (`E:2196`). Revocations are signed, never conflict and only accumulate, so two honest operators that exchange them reach the same set. In the gap, one operator relays a deal the other would refuse. That deal is valid on chain, as it would be by direct submission.

**What a revocation cannot do, said plainly.** It does not stop an agent that still holds a signing key and can sign for a funded payment address, when its counterparty does not check. The company stops that agent at the payment address.

**Fixtures.**

| Fixture | What it shows |
| --- | --- |
| `neutrality.operator-hides-revocation` | The principal posts the revocation to op-1 and op-2. op-1 drops it and serves the agent as active. op-2 serves it revoked, with the signed message. The counterparty's client reads both and declines to sign. The revoked agent's earlier funded deal still delivers, is decided and releases through either operator. The hiding operator gains nothing that a direct submission does not give |
| `neutrality.principal-revokes-mid-flight` | The seller's principal revokes after the hold. The seller's delivery is relayed, the deal is decided and the seller is paid. It mirrors the planned `neutrality.club-revokes-mid-flight` |
| `error.agent-revoked` | An operator that holds the revocation refuses a new offer and a new agreement with `mandate_revoked` |
| `attack.forged-revocation` | A revocation signed by a key other than the mandate's principal is refused, and the agent keeps dealing. An operator that claims a revocation without a signature is an operator that refuses (`neutrality.operator-refuses`) |
| `attack.revoked-agent-submits-directly` | On a local chain, a revoked agent with a funded payment address funds a deal with no operator. The deal is valid. The snapshot records the boundary and the bound: the payment address's balance |

The testkit models a revocation at the operators, each `via:` operator with its own set, so the hide can be written. Its `revoke_mandate` step is refused today.

**Schema:** one additive version (v0.12 if it is next): the problem type `mandate_revoked`, and the agent read gains the signed revocation. No signed struct changes, so the EIP-712 domain stays 0.8 and the contracts stay. Not made here.

**Alternatives.**

- **A revocation registry on chain, written by the principal only.** It passes neutrality, because only the agent's own principal can stop its new deals. It costs a storage read on every funding, a new contract surface and a public link from principal to agent. Not possible before the pilot. Left open as an opt-in for a later contract version (section 5).
- **Short mandates and no revocation.** A mandate that lasts a day needs none. It is a choice a company already has (D31) and the guide should name it. It does not cut an agent off within the day.
- **Order a revocation against a later mandate by a signed time.** It lets the same key return. It changes a signed struct and adds an ordering rule. Rejected while a new key is cheap.

### 5. The richer mandate

**Recommendation: it changes no answer above. The protocol carries the format of a permission and its revocation. The company's wallet and signing tools enforce them. The design of the richer mandate is a separate record.**

| The richer mandate's part | Where it belongs | Why |
| --- | --- | --- |
| A second signature above an amount | The company's wallet: a multisig or a smart account as the payment address, or as the signing address | Every role already takes an ERC-1271 signature (`R:567-571`). No protocol change |
| Allow-lists of counterparties | The company's signing tool | The terms name the seller and its payout address, and the funding authorization is bound to that deal. The tool checks them before it signs |
| Allow-lists of tokens | The deployment and the club | A deployment serves one token (ADR-0031 section 2), and a rulebook lists its tokens |
| Permissions per action | The company's signing tool. The mandate may state them for a counterparty to read | The contract checks one buyer signature for every buyer message. A key per action would change the signed terms |
| Delegation to sub-agents that can only narrow | The protocol's format | The relying party checks every link and takes the intersection. The `Delegation` and its mandate are already two links checked this way (`examples/agent.ts:317-323`) |
| An audit link from an action to its permission | The party's own deal record | It keeps the mandate hash and the certificates with the deal. Nothing goes on chain (D35) |

**What this decision leaves room for.**

1. **Verification stays with the relying party, off chain.** The richer mandate must not need the contract to read a permission.
2. **The effective scope is the intersection of every link.** A link then narrows by construction, whatever it says.
3. **A revocation names an issuer and a subject.** `AgentRevocation {principal, agent}` has that shape. The richer mandate extends it to any link, and revoking a link ends everything below it.
4. **`Scope` changes once.** The removal of `categories` and the new fields ride one version, one domain move and one redeploy.
5. **Period caps.** The richer mandate's design decides whether `maxDaily` stays.
6. **An on-chain anchor is an option, not a rule.** A later contract version may let the parties of a deal opt into a principal-written revocation registry (ADR-0015). Nothing here needs it.

## Litmus tests

- **Neutrality.** Unchanged, and stated more exactly. No mandate check sits where a party cannot route around it, so no operator, club or maintainer gains a way to stop a valid deal by misapplying one. A revocation is signed by the agent's own principal, stops only new deals at honest operators, and never reaches a funded deal. Two new `neutrality.*` fixtures show it.
- **The hold.** Unchanged. Funds still move only on the payment address's authorization and the contract's rules. A revocation cannot move, freeze or release a hold.
- **Defended multi-model judgment.** Not affected.

## The build, in order

| Step | What | Size [guessed] | When |
| --- | --- | --- | --- |
| 1 | Text: the table of section 1 in the guide's limits page, the daily cap and `categories` stated as they are, and the `scope_exceeded` problem text corrected | Two or three files, tens of lines | Any time; it changes no behaviour |
| 2 | Revocation: the route, the store, the refusal at the offer and the agreement, the agent read, the testkit step, the five fixtures, the additive schema version. A red-team pass, because it is an authorization path | Six to eight packages, several hundred lines with tests | After the pilot's first deal |
| 3 | The reference clients check a counterparty's mandate or `Delegation`, and its revocation, before they sign; the two `error.*` scope fixtures and the daily-cap fixture | Three or four files under `examples/`, three fixtures | After step 2 |
| 4 | The design record for the richer mandate | A record | After step 3, or earlier if a design partner asks |
| 5 | One version that changes `Scope`: `categories` leaves, the richer mandate's fields arrive; the domain moves to 0.9; the contracts redeploy | Every signed vector and recording moves | With the next contract version |

**Not before the pilot:** any change under `contracts/src/`; any change to a signed struct; a shared daily count; a mandate or revocation registry on chain; a category check. Step 2 is not needed for the pilot, which runs on test tokens with mandates the faucet signs.

## Not decided here

Questions only Rafa can answer:

1. **Is a mandate required to deal through an operator?** This record keeps today's rule: an operator relays for a long-term key only with a mandate in the club. "A funded wallet is a funded wallet" could also mean that an operator in an open club relays for any funded address, with the mandate as optional evidence.
2. **Does `maxDaily` leave with `categories`?** It is enforceable only per operator. This record keeps it as a statement and passes the question to the richer mandate's design.
3. **Should a later contract version offer an on-chain revocation as an opt-in?** It is the one part an enterprise may ask for that the wallet cannot give: a stop that binds a counterparty that does not check.
4. **May the guide name wallet products?** The table in section 1 is useful with examples of a policy service and a smart account. Naming one is a recommendation Crow would stand behind.
5. **Can the same key return after a revocation?** This record says no, until the revocation expires.

## How others carry the same ideas

A research pass opened each source on 2026-11-14. Its fetch tool returns a reading of most pages, not their raw text, so check a field name at the link before quoting it. **Checked** means the page said it that day; **secondary** means the primary page did not open.

| Standard, version and date | How a limit is carried | Who enforces it | Revocation before expiry |
| --- | --- | --- | --- |
| [AP2](https://ap2-protocol.org/ap2/specification/) v0.2.0, released 2026-04-28 | An open mandate signed by the user carries constraints: an amount range, a budget across payments, allowed payees and merchants, an expiry. It binds the agent's key | The merchant checks the checkout constraints. The credential provider and the network check the payment constraints and keep the budget's running total | None defined. A short expiry, and one open mandate in use at a time [checked] |
| [Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol), spec 2026-04-17 | An allowance on a payment token: a maximum amount, one merchant, one checkout session, an expiry | The payment provider that issued the token | None in the spec. Stripe's token adds a revoke call at Stripe [checked] |
| OAuth: [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396.html) (2023-05), [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html) (2013-08), [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html) (2015-10) | Authorization details in the token, with an amount and a payee in the RFC's own example | The resource server, which in a payment is the bank | The client revokes at the authorization server. Resource servers learn of it by asking (introspection), or tokens are short-lived [checked] |
| [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization), revision 2026-07-28 | Scopes, with a step-up when a call needs more. No amounts | The MCP server | None on the page. Short-lived tokens [checked] |
| [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715) and [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710), both Draft; MetaMask's delegation kit | A permission with rules, redeemed through the account's delegation manager | The account that holds the funds, on chain, at redemption | An on-chain call by the account. A redelegation can add restrictions and cannot remove any [checked] |
| [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) accounts (Final) with [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579) or [ERC-6900](https://eips.ethereum.org/EIPS/eip-6900) modules (both Draft) | A session key with caps, written by a module. The standards define no limit themselves | The account contract, when it validates a transaction | An on-chain call by the account [checked] |
| Safe [allowance module](https://github.com/safe-global/safe-modules/blob/main/modules/allowances/contracts/AllowanceModule.sol) 1.0.0 | An amount per delegate and token, with a reset period | The module, before it calls the Safe | A Safe transaction [checked] |
| Wallet policy services: [Coinbase CDP](https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/overview), [Turnkey](https://docs.turnkey.com/concepts/policies/overview), [Privy](https://docs.privy.io/controls/policies/overview) (pages undated) | Accept and reject rules per signing request. CDP and Turnkey state rules on EIP-712 messages by verifying contract and field | The service, before it signs | The company edits the policy. None of the three counts a windowed total for typed-data signatures [checked] |
| [x402](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md) v2, 2025-12-09 | No limit. Client budgets are out of scope | The token, for the one payment | None. A validity window and a nonce [checked] |
| [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009), Draft | One transfer: a value, a validity window, a nonce | The token contract | `cancelAuthorization`, optional, before the authorization is used [checked] |
| [Visa Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol/overview) (no version); [Mastercard Agent Pay](https://newsroom.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai), 2025-04-29 | A signature that tells the merchant which agent calls. Limits sit with the network's token | The merchant verifies the agent. The network and the issuer hold the limits [secondary] | Not covered on the pages that opened |
| [UCAN](https://github.com/ucan-wg/spec) 1.0.0; [Biscuit](https://doc.biscuitsec.org/reference/specifications.html) 3.x; [ZCAP-LD](https://w3c-ccg.github.io/zcap-spec/) v0.4.0 | A chain of delegations. Each link restates or narrows the one above | Whoever controls the resource checks every link | UCAN: any issuer in the chain revokes; the notice travels by message, is irreversible, and the spec prefers a short expiry. Biscuit and ZCAP-LD: the verifier keeps a list [checked] |
| [W3C Bitstring Status List](https://www.w3.org/TR/vc-bitstring-status-list/) v1.0, Recommendation of 2025-05-15 | A published list of revoked credentials | The verifier pulls it and may cache it | A pull, with a staleness window as long as the cache [checked] |

What this record takes from them:

- **The party that holds the money or the key enforces the limit.** That is true of every row that carries one. The receiving party checks one deal at most. Section 1 follows it: the payment address holds the limit, and the counterparty checks one deal against the mandate.
- **A cap across deals exists only where one party sees every spend:** AP2's budget at the credential provider, the Safe module's counter, an account's session module. No row has a counterparty or a relay keep a total. Section 3 follows it.
- **None of these rails enforces a category.** AP2's merchant checks line items, because the merchant knows what it sells. Section 2 follows it.
- **Revocation comes in three forms:** a write at the one enforcer, a list that verifiers pull, or a short expiry in its place. Section 4 uses all three: the payment address is the one enforcer of the money, the operators' agent read is the list, and a mandate's expiry is the company's to set short (D31).
- **Delegation that only narrows is a chain that the verifier checks link by link.** Section 5 leaves room for exactly that.

## Review

REVIEW_SECTION
