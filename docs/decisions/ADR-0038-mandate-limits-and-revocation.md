# ADR-0038: A mandate is a permission others check; a spending limit lives with the money

- **Status:** Proposed, 2026-11-14 (D69). Adopted by T-415 under the repository's autonomy rule; Rafa may overrule any line. Nothing here is built.
- **Raised by:** T-415. Enterprise-readiness research on 2026-11-13 (kept privately, `docs/private-materials.md`) found four gaps between what a mandate says and what stops an agent. Rafa asked on 2026-11-14 for the work that is ready. Research: this note (code read at the commit below; nothing run), a research pass by a second agent at the highest effort, a dated check of outside standards, and one reviewer pass (last section).
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0015 (user choice), ADR-0017 (the mandate is the standing approval), ADR-0024 section 7 (per-deal keys and the `Delegation`), ADR-0031 (the phase-one contracts; contract signers stay), ADR-0033 (the payment address); D22, D26, D31, D32, D35.
- **Amends:** no ADR. It records that two checks ADR-0024 section 7 names are not built (section 1), and it lists the standing texts that describe the bound on a loss differently (the build's step 1).
- **Changes when built, by later tasks:** `apps/operator`, `packages/settlement` (both settlements), `apps/demo-cloud` (the store), `apps/adjudicator`, `packages/testkit`, `fixtures/`, `examples/` (the reference clients), the guides under `site/`, `docs/neutrality.md`, `docs/judgment-and-defenses.md`, and `spec/` (additive versions, then one version that changes a signed struct). No change to `contracts/src/`. This record changes no code.

Labels: **measured** (read at the cited line at commit `b9e33a9b`, `origin/main` on 2026-11-14), **documented** (stated in the cited doc), **checked** (an outside page said it when a research pass opened it on 2026-11-14), **inferred** (from reading, not from a run), **guessed**. Nothing was run. A claim with a file and line and no label is measured.

Short forms: `S:` is `packages/core/src/state.ts`, `P:` is `packages/core/src/private.ts`, `E:` is `packages/settlement/evm/evm-settlement.ts`, `SIM:` is `packages/settlement/sim/simchain.ts`, `R:` is `contracts/src/HoldbackRules.sol`, `A:` is `examples/agent.ts`.

## Summary

**On a chain, only the operators that relay a deal check a mandate's limits, and an agent can deal without an operator.** The contracts fund a deal on four signatures: the seller's, the primary adjudicator's, the buyer's, and the payment address's authorization for one deal's price plus fee. They read no mandate [measured]. An agent that holds a signing key and can sign for a funded payment address can fund a deal with no operator. SimChain differs: it checks the mandate at settlement.

**That is the right place for the line, and Crow should say so.** A company's money leaves through the payment address's signature, and the company controls that signature with its own wallet. A mandate does a different job: it tells counterparties which key acts for the company, and within what bounds.

**The decision, one line per question:**

1. **Where limits are enforced.** The spending limit is the payment address: its balance, who can sign for it, and the company's own wallet policy. The mandate is a signed permission that those who rely on it check: the counterparty before it signs, and each operator before it relays, as that operator's stated policy. The contracts read no mandate.
2. **`categories`.** Remove it. Nothing can check it, and the mandate's club already names the market. The JSON contract drops it in an additive version. The typed data drops it with the next version that changes a signed struct.
3. **The daily cap.** Each operator counts the deals it relays, and the guide says so. This record builds no shared count. The hard daily limit is the balance the company keeps on the payment address.
4. **Revocation before expiry.** A revocation is a signed notice from the mandate's own principal. Any operator takes it from anyone, serves it and stops relaying new offers, agreements and fundings for that agent. It never touches a funded hold. A counterparty treats a mandate as revoked when any one operator serves a valid revocation of it. The company's hard stop is the payment address.
5. **The richer mandate.** It changes no answer above. The protocol carries the format of a permission and its revocation, so anyone can verify them. The company's wallet and signing tools enforce amounts, co-signatures and allow-lists. Delegation to sub-agents is a chain of signed permissions that the relying party intersects.

**How to read this in ten minutes:** this summary, the table under "What enforces each field today", and the bold recommendation at the top of each of the five sections.

## What enforces each field today

The scope has five fields (`spec/schemas/common.schema.json:58-97`). The mandate that carries it is the principal's EIP-712 signature over `{principal, agent, clubId, scope, nonce, issuedAt}` (`packages/core/src/eip712.ts:252`).

| Field | The contracts | The operators on a chain | SimChain, at settlement | The counterparty | The adjudicator |
| --- | --- | --- | --- | --- | --- |
| `roles` | Not read | Checked for the seller at the offer and for the buyer at the agreement and at funding (`S:215`, called at `S:235`, `S:312`, `S:337`; the node passes its own mandate book, `E:941`, `E:1184`, `E:1229`) | Checked at the same three steps (`SIM:710`, `SIM:810`, `SIM:823`) | For a per-deal key only: `verifyDelegation` checks the certificate's role (`P:200`), and the reference agent compares the certifying agent's mandate (`A:319-322`). One test calls it (`examples/private.test.ts:82`); no reference flow does | Not checked: no file under `apps/` reads a `Delegation` |
| `maxPerCommitment` | Not read | Checked against the price at the same three steps (`S:216-218`) | Checked | As above (`P:202-203`, `A:322`) | Not checked |
| `maxDaily` | Not read | Checked for the buyer at the agreement only (`S:314-318`). Each node keeps its own count by buyer address and UTC day (`E:1185-1186`, `E:1195-1196`). A deal funded on chain without this node's relay is not counted (`E:2214-2219`) | Checked, with one count for every operator (`SIM:811-814`) | Not checked: `verifyDelegation` does not read it (`P:194-204`) | Not checked |
| `categories` | Not read | Not checked. It is signed (`packages/core/src/eip712.ts:103-104`) and nothing reads it. The terms have no category field to compare it with | Not checked | Not checked | Not checked |
| `expiresAt` | Not read | Checked at the same three steps (`S:214`) | Checked | The certificate's expiry and its scope's expiry are checked (`P:201`). The reference agent does not compare the mandate's expiry (`A:319-322`) | Not checked |

These facts decide the questions. Each is measured unless it says otherwise.

1. **The contract funds on four signatures.** `agreeAndFund` checks the seller's, the primary adjudicator's and the buyer's signatures (`R:181-183`) and passes the payment address's ERC-3009 authorization to the escrow (`R:191`). The words mandate, scope, revocation and delegation do not appear under `contracts/src` (`git grep`).
2. **On a chain the operators' checks are their relay policy, and the code says so.** A node that finds a deal funded on chain joins it with a scope that allows everything: "the mandate checks are this node's own policy for what it relays" (`E:2196-2197`).
3. **SimChain checks the mandate at settlement.** A direct submission to SimChain beyond the scope is refused (`SIM:578-591`, `SIM:806-814`). The testkit builds one settlement for every operator of a scenario, on SimChain and on a local chain (`packages/testkit/src/stub-settlement.ts:352-353`), so no fixture can give two operators different mandates, counts or revocations today.
4. **A per-deal key gets no operator check.** In a club that admits pseudonymous keys, a private deal's signer without a mandate passes with a scope equal to the deal's price (`E:891-896`). ADR-0024 section 7 leaves its scope to the counterparty and the adjudicator.
5. **The counterparty's check is thinner than its description.** The reference agent reads the certifying agent's mandate from the operators and requires that they answer alike (`A:74-77`). It compares the role and the cap. It does not verify the principal's signature on the mandate or its expiry (`A:319-322`).
6. **Every role may be a contract.** The contract checks a signature by ECDSA for an address without code and by ERC-1271 for one with code (`R:567-571`). Rafa kept this on 2026-11-11 (ADR-0031). A contract wallet can be the payment address (ADR-0033) [documented].
7. **No route takes a company's own mandate.** `POST /v1/agents` answers 501 (`docs/api.md:345`) [documented]. Mandates come from a node's genesis or from the test service's faucet, which signs with the demo club's own test principal (`site/ref/http.txt:81`). On the test service a mandate is an admission to the club, not a company's permission.
8. **Revocation is typed and has no handler.** `AgentRevocation {agent, principal, nonce, expiresAt}` is in the schema ("blocks new commitments only"), the types and the signing code (`packages/core/src/eip712.ts:187`). Its `expiresAt` is the field every signed message carries (`packages/core/src/types.ts:205-209`). `POST /v1/agents/{address}/revoke` answers 501 (`docs/api.md:346`), and the testkit refuses the step (`packages/testkit/src/scenario.ts:177`).
9. **One operator message is wrong.** The `scope_exceeded` problem tells an agent that its mandate's categories "must cover the deal" (`apps/operator/src/problems.ts:26`). Nothing checks categories.
10. **A contract wallet usually cannot fund through the API.** The API's `Signature` is exactly 65 bytes (`spec/schemas/common.schema.json:15-19`), and the buyer tool refuses any other length (`examples/buyer-signer.ts:1033`). A multisig's or a smart account's signature usually has another length. Such a wallet funds only by a direct call to the contract, which the contract and the test tokens accept (fact 6). A wallet service that signs with a plain key works through the operators today [inferred].
11. **A node keeps one mandate per agent and club, and a new one replaces it.** `admit` stores any mandate its principal signed, whoever that principal is (`E:561-567`). Only the faucet calls it today. An open route with this rule would let a stranger replace an agent's mandate.

The two live operators share one store (`apps/demo-cloud/wrangler.op2.jsonc:22`), so the test service has one daily count today. Two independent operators would have two [inferred].

No scenario fixture exercises a scope refusal today: no file under `fixtures/scenarios/` names `scope_exceeded`, `mandate_expired` or `maxDaily` (`git grep`).

## Decision

### 1. Where each limit is enforced, and what Crow tells a company

**Recommendation: two layers, named apart. The spending limit is the payment address. The mandate is a permission that the parties who rely on it check. The contracts read no mandate.**

**The spending limit is the payment address.**

- A company's funds leave through Crow on two signatures, both by the payment address and both bound to one deal (ADR-0033). The first is an ERC-3009 authorization for the deal's price plus fee, payable only to the escrow's collector and valid until the deal's `fundBy` (`R:191`). The second pays the operator's fee to the operator's own address, where an operator charges one. No operator, adjudicator, counterparty or contract can move more.
- So the company sets its limit where it makes those signatures. It has three tools, all its own:
  - **The balance.** The payment address holds the budget and no more. With the two addresses of ADR-0033 the agent's signing key holds nothing.
  - **Who signs.** The agent holds the payment key. Or the company keeps the key in a wallet service that signs on request. Or the payment address is a multisig or a smart account. The first two work through the operators today. The third works only by a direct call until the API takes a contract wallet's signature (fact 10; the build's step 2).
  - **A policy at signing.** A wallet service or a co-signer sees the typed data it is asked to sign: the recipient, the value and the deadline. It can refuse above an amount, refuse any message but a deal's funding and its fee, and check the deal's terms first. Two of the three policy services read for this record state rules on EIP-712 fields ("How others carry the same ideas").
- **Two limits of these tools.**
  - A token checks a contract wallet's authorization with a read-only call [inferred from ERC-1271]. The wallet can check who signed, and it can check the signed fields when the signature bytes carry them. It cannot write a counter in that call. An on-chain spending module meters transactions, and a funding is a signature.
  - None of the three policy services read counts a total over a day for typed-data signatures [checked].
  - So the hard cap per day is the balance: the company tops up the payment address by the day's budget. A company that wants a counted cap runs its own co-signer.
- This is Rafa's rule of 2026-11-12: a funded wallet is a funded wallet. The protocol enforces what the parties signed and sets no limit of its own (D31, D32).

**The mandate is a permission others can check.**

- It states which key acts for a company, in which club, in which roles, up to what price per deal, until when. The principal signs it, so anyone can verify it without trusting Crow or an operator.
- **The counterparty** checks it before it signs: the principal's signature, the club, the role, the cap against the price, the expiry, and that no revocation is served (section 4). The agent hands over its mandate with its offer or its certificate, and the counterparty verifies the signature itself. It asks the operators for revocations only, so an operator that withholds a mandate cannot stop a careful counterparty. A party runs this check for itself (D32). It gives the counterparty evidence that the agent acted within its stated authority (D26). The reference clients gain the full check; today they compare the role and the cap, and only a test calls it.
- **Each operator** checks it before it relays, as today. The guide calls it what it is: the operator's relay policy. It stops an honest agent's mistake. It does not stop an agent that goes to another operator or to the contract.
- **The adjudicator** stays a checker of a per-deal key's `Delegation`, as ADR-0024 section 7 and the hard rule on signed messages say. Nothing built does it. The build adds it with the admission of per-deal keys (the build's step 6).

**An operator's check cannot censor.** An operator that answers `scope_exceeded` wrongly, or holds back a mandate it was given, has refused to relay. The agent sends the same signed messages through another operator or to the contract, which asks no operator (`neutrality.operator-refuses`, `neutrality.operator-offline`). This holds only while the contracts read no mandate. On the test service one process runs both nodes (`site/ref/limits.txt`), so the route that is independent of it there is the direct call.

**What Crow tells a company.** The guide gains this table. The task that owns the guide writes the final text.

| What you want | What enforces it | Who can get around it |
| --- | --- | --- |
| My agent can never spend more than X in total | The balance on the payment address | Nobody |
| A person or a rule approves each payment, or each payment above X | Your wallet: you hold the payment key in a wallet service, a multisig or a smart account. Today a multisig or a smart account funds by a direct call, not through an operator | Nobody without that wallet's approval |
| My agent stays under X per deal, in these roles, until this date | The mandate, checked by a counterparty that checks, and by the operators you use for a public deal signed with the mandated key | An agent that holds a signing key and a funded payment key, dealing with a counterparty that does not check. In a private deal with per-deal keys, only the counterparty checks |
| My agent stays under X a day | Each operator's own count of the prices its relays agreed, per signing address. For a hard limit, top up the payment address daily | The same agent, and any agent that uses two operators or per-deal keys |
| Cut my agent off now | For new deals: empty the payment address or change who signs for it, then publish the revocation | Nobody, for new money. On a hold already funded, the agent can still accept early or sign a settlement; the hold bounds that loss |

**Options weighed.**

| Option | Neutrality | The hold | Cost | Verdict |
| --- | --- | --- | --- | --- |
| (a) The paying wallet's own policy | No party gains a move: the company limits its own signature | Unchanged | None in the protocol. The company runs its wallet | **Adopted** for the spending limit |
| (b) The settlement contracts check the mandate | A check no party can route around makes each of its refusals a way to stop a deal. A registry anyone but the principal writes breaks the test. A daily count cannot see per-deal keys. It also binds nobody who holds the money: a contract can hold only an agent that presents a mandate, and an agent with a funded key can sign as its own principal unless the terms name the principal | Unchanged | About 15,000 to 45,000 gas on a funding of 233,994 gas [guessed; the base is measured in T-351]: one more signature, a nested struct with string arrays, a counter slot per buyer and day. A new signed type in the contract. A link from principal to agent to deal on a public chain, against D35 and ADR-0024. Not possible before the pilot: the contracts are frozen | Rejected for phase one. Section 5 leaves room for an opt-in |
| (c) The operators, as today, stated as operator-level | Passes: an operator that refuses is routed around | Unchanged | Guide text | **Adopted**, with the words |
| (d) The counterparty and the adjudicator check before they sign | Passes: each checks for itself and can only decline its own signature | Unchanged | The reference clients and the adjudicator service, small | **Adopted** |

**Where SimChain stands.** SimChain checks the mandate at settlement, so on SimChain a direct submission beyond the scope is refused and on a chain it funds. The two should say one thing. A build step moves the mandate checks from SimChain's settlement into the operator layer that the testkit already models, with a book per operator. After it, neither settlement reads a mandate, and a fixture can give two operators different state. Until then SimChain stands for one operator that every party uses. The move is the build's step 3 and waits for Rafa's word (question 3).

**Fixtures.**

- `error.scope-exceeded` (planned in `docs/plan.md`) and `error.mandate-expired`: an operator refuses an agreement above the cap, and one after the expiry. They pin today's behaviour on both settlements.
- `attack.over-cap-agent-submits-directly`, on a local chain only until SimChain's check moves: an agent above its cap funds a deal with no operator. The deal is valid. The snapshot records the boundary and its bound, the payment address's balance.
- `neutrality.operator-refuses-on-scope`: op-1 wrongly answers `scope_exceeded`, the buyer calls the contract, and the deal releases. A named test on a local chain first, as `packages/settlement/evm/sync.test.ts` funds directly today.
- A client test under `examples/`: the reference client declines a counterparty whose mandate does not cover the deal, has expired or carries a bad signature.

The scenario format has no key for a party's scope today: every cast gets a wide one (`packages/testkit/src/stub-settlement.ts:333`). The scope fixtures need that key.

**Schema:** one additive version for the wallet path, the next free number: the payment address's two signatures may be longer than 65 bytes, so a contract wallet funds through an operator. The operator already leaves the funding signature to the token (`E:981`). The EIP-712 domain stays 0.8. Not made here.

### 2. The `categories` field

**Recommendation: remove it. Until the removal, say that nothing checks it.**

| Option | Litmus tests | Cost | Verdict |
| --- | --- | --- | --- |
| Check it at the agreement | Neutrality passes while the check is an operator's policy. It gives a company no hard limit, for the reasons of section 1 | A category field in the signed terms, which moves every commitment ID, and a list of categories that someone owns. In a private deal the operator cannot read the deal's bodies (ADR-0024). The protocol would carry content, against D35 | Rejected |
| Keep it as a label nobody enforces | No effect on any test | None | Rejected: a signed limit that nothing checks misleads the company that sets it |
| Remove it | No effect on any test | One signed struct changes | **Adopted** |

- **The club already does the job.** A mandate names one club (`packages/core/src/eip712.ts:252`), and a node keys its mandates by agent and club (`E:892`). A company that limits its agent to one market gives it a mandate in that market's club.
- **What a company's agent buys is the company's tooling to decide** (D32).
- **The removal changes a signed struct.** `Scope` sits inside the `Mandate` and `Delegation` typed data (`packages/core/src/eip712.ts:99-106`). The fields `categories` and `hasCategories` both leave. Under the rule in `docs/architecture.md` (Identity and signing) the EIP-712 domain version and `commitment.schemaVersion` move with it, from 0.8 to 0.9, and the contract pins the domain (`R:574-575`). So the removal needs a contract redeploy and must not ship before the pilot.

**Schema, in two moves.** Neither is made here.

1. **The JSON contract drops the field in the additive version of the mandate route (the build's step 4), which also carries this one removal,** as v0.10 carried one cap. The typed data keeps its two members as constants: the encoder already writes `hasCategories: false` and an empty list for an absent field (`packages/core/src/eip712.ts:294-295`). No signed encoding changes, so the EIP-712 domain stays 0.8 and nothing redeploys. A mandate that carries `categories` no longer passes the schema. It lands before a company signs its own mandate, so none carries the field. The research pass rates this timing at medium confidence.
2. **The typed data drops the two members in the next version that changes a signed struct,** with the EIP-712 domain and `commitment.schemaVersion` at 0.9. It should be the version that carries the richer mandate's fields (section 5), so the domain moves once.

**Before both, text only:** the `scope_exceeded` problem stops naming categories, and the guide says the field is signed and not enforced.

**Fixtures:** none. The hash vectors move with the version.

### 3. The daily cap across operators

**Recommendation: each operator counts the deals it relays, and the guide says so. Build no shared count. `maxDaily` stays a signed statement of the company's bound.**

| Where one count could live | Litmus tests | Why not |
| --- | --- | --- |
| The contract | Fails as in section 1: a refusal nobody can route around | It also cannot count across per-deal keys, where each deal has a fresh buyer address. Frozen for the pilot |
| The operators agreeing among themselves | Neutrality at risk: an operator that withholds its count stalls the others' relays | A consensus protocol between operators for one number |
| Each operator summing the chain's `JobFunded` events (`R:189`) | Passes: it is still each operator's own policy | It counts the hold and not the price, misses per-deal keys, and an agent still passes it by going to the contract. An operator may offer it. It is not required, and not built now |
| Each operator's own count, stated (**adopted**) | Passes | It is not a hard limit, and the guide says so |

- **The cap that holds is the balance.** A company that wants a hard daily limit tops up the payment address by that amount each day.
- **Three facts for the guide.** The count is per signing address, so every per-deal key starts at 0 (`E:1185`). It adds the price at the agreement (`E:1191-1196`). It leaves out a deal funded directly (`E:2214-2219`).
- **`maxDaily` keeps a use as a statement.** A principal can show that its agent went past a signed bound (D26). The research pass would remove it with `categories`, on the ground that a mandate should carry only what a verifier can check from one deal. This record leaves that to Rafa (question 4) and to the richer mandate's design (section 5).
- **For per-deal keys nothing changes:** ADR-0024 section 7 already says the principal's agent enforces its own budget.

**Fixtures:** `error.daily-cap-at-one-operator`: a buyer reaches the cap through op-1, op-1 refuses the next agreement, and the same agreement funds through op-2. It needs the testkit's book per operator (section 1, "Where SimChain stands"), so it lands with the build's step 3. **Schema:** none.

### 4. Revocation before expiry

**Recommendation: a revocation is a signed notice from the mandate's own principal. Any operator takes it from anyone, serves it, and stops relaying new offers, agreements and fundings for that agent. A revocation never changes a funded deal. A counterparty treats a mandate as revoked when any one operator serves a valid revocation of it. The company's hard stop is the payment address.**

**Who signs, and what it covers.**

- The principal signs `AgentRevocation {agent, principal, nonce, expiresAt}`. The type needs no change.
- **A revocation counts against a mandate only when its `principal` is that mandate's principal and the signature is that principal's.** A key that names itself as principal revokes nothing: no mandate names it. A principal in one club cannot end a mandate that another principal gave the same agent.
- It voids every mandate that principal gave that agent, in every club, and so every `Delegation` that agent certifies under them.
- **The rule on time: a mandate from that principal to that agent is void while a revocation is unexpired.** `expiresAt` is the field every signed message carries, and here it is the end of the revocation's effect. The principal chooses it (D31):
  - The reference client and the operator's prepare route default it to the last representable timestamp. The usual one-hour default of other messages does not apply.
  - A principal that sets a short one has suspended its agent. When the revocation lapses, an unexpired mandate applies again.
  - While a revocation is unexpired it also voids a mandate issued later for the same pair. A company that wants the agent back sooner gives a mandate to a new key.
- So an operator needs no rule to order a revocation against a later mandate, and no signed struct changes. The schema's description of `AgentRevocation` gains this meaning in the additive version. `MemberRevocation` has the same shape; the task that builds it should give it the same meaning.

**The route for a company's own mandate comes first, with three rules.** A revocation has nothing to end until a company can give an operator its own mandate (fact 7).

- **The agent consents.** The route takes a mandate only with the agent's own signature beside the principal's. Otherwise a stranger signs a mandate with a cap of 0 for someone else's agent.
- **A node keys a mandate by principal, agent and club,** and a mandate from one principal never replaces another's (fact 11). A revocation then ends one principal's authority over a key. It does not end the key.
- **Which mandate an operator applies.** An agent may then hold several mandates in one club, and the terms name no principal. The operator relays when any live mandate covers the deal and its principal is admitted under the club's rulebook. In an open club any key can be a principal, so a revoked agent can make itself a new one. The operator's check then binds an agent to no particular company. What binds is the counterparty's check against a principal it already knows (section 5, point 8). Rafa's question 1 follows from this.
- **Schema:** an additive version, the next free number: a new signed type for the agent's consent to a mandate, in the agent registration. It is the version that drops `categories` from the JSON contract (section 2), so no company signs a mandate with that field. The EIP-712 domain stays 0.8. Not made here.

**Where it is stored, and how it travels.**

- Each operator keeps the revocations it has accepted, beside its mandates.
- `POST /v1/agents/{address}/revoke` takes one from anyone. The signature is the authority, not the sender. The route is already in `docs/api.md` as planned.
- **An operator stores a revocation whose principal it knows:** the principal of any mandate in its book, or an admitted member of a club it serves. For an unknown principal it stores under a rate limit, or refuses and says so, so a stranger cannot fill its store. A principal that is refused knows that this operator does not hold its notice.
- **An operator checks before it admits a mandate.** It reads its own revocations and those of the operators it knows for that pair. Without this, a revoked agent could post its old, unexpired mandate to an operator that never held the revocation: it has the principal's signature and gives its own consent. An operator with no peer, or with a peer that hides the revocation, can still be given that mandate. The deal it then relays is no more than a direct submission allows, and a counterparty that reads another operator still sees the revocation.
- `GET /v1/agents/{address}` serves each mandate with its revocation, when there is one, so a reader can verify it and post it to another operator. The status is per mandate, not per agent. Today the route always answers `active` (`apps/operator/src/server.ts:1292`).
- **The operator records the notice.** It appends an `agent.revoked` event, a type the schema already has, and returns its signed receipt. The principal then holds dated evidence that it gave notice (D26).
- The principal posts the revocation to each operator it knows. No operator-to-operator protocol is required beyond the read at admission.

**Who must honour it.**

- **An operator that holds a valid revocation** refuses to relay every step up to and including the funding, with a new problem `mandate_revoked`, when the revocation voids the buyer's or the seller's mandate. In each case nothing is held yet, and one party's company has withdrawn:
  - an offer or an agreement by the revoked agent;
  - a buyer's agreement to an open offer whose seller's mandate is revoked;
  - the funding, where the agreement and the funding are separate steps, as on SimChain, whichever party's mandate is revoked.
- **A counterparty's client** reads the agent from every operator it uses. It treats a mandate as revoked when any one of them serves a revocation that names the mandate's principal and carries that principal's signature. One honest operator is enough.
- **A per-deal key is the counterparty's to check.** An operator reads no `Delegation`, and in a club that admits pseudonymous keys a key without a mandate passes (`E:894-895`). An operator that holds the revocation therefore still relays a deal signed by a per-deal key that the revoked agent certified. The counterparty's check of the certifying agent stops it. When operators admit a per-deal key by its certificate, they check the certifying agent's revocation too.
- **The contracts** do not read it in phase one.

**Deals already agreed or funded.**

- **A funded deal is untouched.** No operator checks a mandate at a delivery, a decision, an early acceptance, a settlement or a timeout: the scope check runs at the offer, the agreement and the funding only (`S:235`, `S:312`, `S:337`). This decision keeps it so. A revoked agent's signatures on its open deals stay valid, including an early acceptance and a mutual settlement (`R:327`, `R:360`). Otherwise a principal could revoke its agent to stall a deal it now regrets, and the other party would pay for it.
- **Before the hold exists, the revocation stops an honest operator's relay.** On a chain the agreement and the funding are one transaction, so nothing is half done. Nothing is held, and the offer expires.
- **A signed funding that is not yet used can be cancelled at the token,** where the token has ERC-3009's optional `cancelAuthorization`. The local test token has it (`contracts/script/LocalUSDC.sol:91`); the Sepolia test token does not. Moving the balance works on every token.
- **The loss after a revocation is bounded by the holds already funded.** `docs/neutrality.md` (residual 12), D22 and the threat T13 in `docs/judgment-and-defenses.md` say the scope caps bound it. On a chain the caps bind only through an operator, so the bound that holds is the funded holds plus the payment address's balance. The build's step 1 corrects those texts.

**How two operators stay in agreement.** They do not have to agree for settlement to be safe. The chain decides which deals exist, and a node joins a deal funded elsewhere without a scope check (`E:2196`). Revocations are signed and never conflict, and an operator only adds them until they expire. So two honest operators that hold the same mandates reach the same set. In the gap, one operator relays a deal the other would refuse. That deal is valid on chain, as it would be by direct submission.

**A new row in `docs/neutrality.md`.** The principal gains a lever, so the build adds it to the table of actors: it can stop its own agent's new deals at operators that hold its revocation, and it cannot reach a funded deal.

**What a revocation cannot do.** It does not stop an agent that still holds a signing key and can sign for a funded payment address, when its counterparty does not check. The company stops that agent at the payment address.

**Fixtures.** The scenario fixtures need the testkit's book per operator, its `revoke_mandate` step, which is refused today, and a step that calls the contract itself. Until the testkit has them, the building task writes these cases as named tests on a local chain.

| Fixture | What it shows |
| --- | --- |
| `neutrality.operator-hides-revocation` | The principal posts the revocation to op-1 and op-2. op-1 drops it and serves the mandate as live. op-2 serves it revoked, with the signed message. The counterparty's client reads both and declines to sign. The revoked agent's earlier funded deal still delivers, is decided and releases through either operator. The hiding operator gains nothing that a direct submission does not give |
| `neutrality.principal-revokes-mid-flight` | The seller's principal revokes after the hold. The seller's delivery is relayed, the deal is decided and the seller is paid. It mirrors the planned `neutrality.club-revokes-mid-flight` |
| `error.revoked-agent` (planned in `docs/plan.md`) | An operator that holds the revocation refuses a new offer and a new agreement with `mandate_revoked`, and on SimChain a revoked buyer's funding |
| `attack.forged-revocation` | A revocation with a signature that is not its named principal's is refused |
| `attack.revocation-by-another-principal` | A key signs a valid revocation that names itself as principal. No mandate names it, so nothing is revoked and the agent keeps dealing. An operator that claims a revocation without a signature is an operator that refuses (`neutrality.operator-refuses`) |
| `attack.revoked-agent-submits-directly` | On a local chain, a revoked agent with a funded payment address funds a deal with no operator. The deal is valid. The snapshot records the boundary and the bound |
| `attack.revoked-agent-readmits-mandate` | A revoked agent posts its old, unexpired mandate to op-2, which refused the revocation as a stranger's. op-2 reads op-1 before it admits, finds the revocation and refuses the mandate |
| `attack.third-party-mandate-overwrite` | A stranger posts a mandate for an agent that did not sign it, and one from another principal. The first is refused, and the second sits beside the agent's own mandate without replacing it |
| `neutrality.operator-withholds-mandate` | op-1 stops serving an agent's mandate. The agent hands its mandate to the counterparty, which verifies it and signs. The deal settles |
| A client test under `examples/` | The reference client refuses a `Delegation` certified by an agent whose mandate is revoked, and accepts again after a short revocation lapses |

**Schema:** one additive version, the next free number: the problem type `mandate_revoked` (the problem list is also in `spec/openapi.json`), the agent read gains each mandate's signed revocation, and the description of `AgentRevocation` states the meaning of `expiresAt`. The served agent read already differs from `agent.schema.json` (`apps/operator/src/server.ts:1292`); the building task reconciles the two. No signed struct changes, so the EIP-712 domain stays 0.8 and the contracts stay. Not made here.

**Alternatives.**

| Alternative | Litmus tests | Why not now |
| --- | --- | --- |
| A revocation registry on chain, written by the principal only | Passes neutrality: only the agent's own principal can stop its new deals | A storage read on every funding, a new contract surface and a public link from principal to agent. Not possible before the pilot. Left open as an opt-in for a later contract version (section 5) |
| Short mandates and no revocation | Passes | A mandate that lasts a day needs none. It is a choice a company already has (D31), and the guide should name it. It does not cut an agent off within the day |
| Order a revocation against a later mandate by a signed time | Passes | It lets the same key return. It changes a signed struct and adds an ordering rule. Rejected while a new key is cheap |
| A revocation that an operator keeps for ever, whatever its `expiresAt` | Passes | The operator would decide a value the principal can set. Against D31 |

### 5. The richer mandate

**Recommendation: it changes no answer above. The protocol carries the format of a permission and its revocation. The company's wallet and signing tools enforce them. The design of the richer mandate is a separate record.**

| The richer mandate's part | Where it belongs | Why | Litmus tests |
| --- | --- | --- | --- |
| A second signature above an amount | The company's wallet: a multisig or a smart account as the payment address, or as the signing address | Every role already takes an ERC-1271 signature (`R:567-571`). No protocol change | No effect: the company limits its own signature |
| Allow-lists of counterparties | The company's signing tool | The terms name the seller and its payout address, and the funding authorization is bound to that deal. The tool checks them before it signs | No effect |
| Allow-lists of tokens | The deployment and the club | A deployment serves one token (ADR-0031 section 2), and a rulebook lists its tokens | No effect |
| Permissions per action | The company's signing tool. The mandate may state them for a counterparty to read | The contract checks one buyer signature for every buyer message. A key per action would change the signed terms | In the contract it would add a refusal nobody can route around |
| Delegation to sub-agents that can only narrow | The protocol's format | The relying party checks every link and takes the intersection. The `Delegation` and its mandate are a first, partial case: the reference agent compares both for the role and the cap (`A:319-322`) | Passes: a relying party can only decline its own signature |
| An audit link from an action to its permission | The party's own deal record | It keeps the mandate hash and the certificates with the deal. Nothing goes on chain (D35) | No effect |

**What this decision leaves room for.**

1. **Verification stays with the relying party, off chain.** The richer mandate must not need the contract to read a permission.
2. **The effective scope is the intersection of every link.** A link then narrows by construction, whatever it says.
3. **A revocation names an issuer and a subject.** `AgentRevocation {principal, agent}` has that shape. The richer mandate extends it to any link, and revoking a link ends everything below it.
4. **`Scope` changes once.** The removal of `categories` and the new fields go into one version, with one domain move and one redeploy.
5. **Period caps.** The richer mandate's design decides whether `maxDaily` stays.
6. **An on-chain anchor is an option, not a rule.** A later contract version may let the parties of a deal opt into a principal-written revocation registry (ADR-0015). Nothing here needs it.
7. **Each link names its parent by hash,** so a chain verifies with no registry.
8. **A principal the checker already knows.** A mandate proves authority only relative to an address that the counterparty ties to a company. Publishing that address stays outside the protocol (D35).
9. **A contract wallet's signature at the API for the signing address too.** A second signature for an early acceptance or a settlement can then live in a smart account. Today such a signer works only by direct calls.

## Litmus tests

- **Neutrality.** Unchanged on a chain, and stated more exactly. No mandate check sits where a party cannot route around it, so no operator, club or maintainer gains a way to stop a valid deal by misapplying one. Only a mandate's own principal can revoke it. A revocation stops new deals at honest operators and never reaches a funded deal. On SimChain the mandate check moves out of settlement, which removes a refusal that no party could route around. Four new `neutrality.*` fixtures show it: an operator that hides a revocation, a principal that revokes mid-flight, an operator that refuses on scope, and an operator that withholds a mandate.
- **The hold.** Unchanged. Funds still move only on the payment address's authorization and the contract's rules. A revocation cannot move, freeze or release a hold.
- **Defended multi-model judgment.** Not affected.

## The build, in order

| Step | What | Size [guessed] | When |
| --- | --- | --- | --- |
| 1 | Text. The table of section 1 in the guide's limits page. The daily cap and `categories` stated as they are. The `scope_exceeded` problem text corrected, with the way out. The standing texts listed below | About eight files, tens of lines | Any time; it changes no behaviour |
| 2 | The wallet path. An additive schema version lets the payment address's two signatures be a contract wallet's. The operator's route, the buyer tool, two guides, one test on a local chain | Small to medium | After the pilot's first deal |
| 3 | The mandate checks move from the two settlement packages to the operator layer. The testkit gains a book per operator, a scope key and a step that calls the contract. `error.scope-exceeded`, `error.mandate-expired`, `error.daily-cap-at-one-operator`, `attack.over-cap-agent-submits-directly`, `neutrality.operator-refuses-on-scope` | Medium to large | With Rafa's word (question 3) |
| 4 | The route for a company's own mandate, with the rules of section 4. Its additive schema version: the agent's consent as a new signed type, and the JSON removal of `categories`, which also changes `spec/examples/mandate.example.json` and `agent.example.json`. `attack.third-party-mandate-overwrite` | Medium | When a design partner will sign its own mandates (question 1) |
| 5 | Revocation. The route, the store, the refusals, the agent read, the event and the receipt, the row in `docs/neutrality.md`. Its additive schema version. The other fixtures of section 4. A red-team pass and a second review by a model of another family, because it is an authorization path | Medium | After step 4 |
| 6 | The reference clients check a counterparty's mandate or `Delegation` in full, and its revocation, before they sign. The adjudicator service checks a `Delegation`, with the admission of per-deal keys by certificate. The two client tests | Small | After step 5 |
| 7 | The design record for the richer mandate | A record | After step 6, or earlier if a design partner asks |
| 8 | One version that changes `Scope`: `categories` and `hasCategories` leave the typed data, the richer mandate's fields arrive; the domain and `commitment.schemaVersion` move to 0.9; the contracts redeploy | Large: every signed vector and recording moves | With the next contract version |

**Standing texts that step 1 corrects.** Each says or implies that settlement checks the scope, or that the scope caps bound a loss: `docs/neutrality.md` (the definition of a valid commitment, and residual 12), `docs/architecture.md` (the agreement's guard in the state table, and "It is checked at agree and fund"), `docs/api.md` (the agent read), `docs/judgment-and-defenses.md` (T13), `docs/audit/known-issues.md` (R-12, which an auditor reads), and D22. The hard rule in `CLAUDE.md` is Rafa's (question 2).

**Not before the pilot:** anything but step 1. Not before the next contract version: any change under `contracts/src/` and any change to a signed struct. Not at all under this record: a shared daily count, a mandate or revocation registry on chain, a category check. The pilot runs on test tokens with mandates the faucet signs, so it needs none of steps 2 to 8.

## Not decided here

Questions only Rafa can answer:

1. **Is a mandate required to deal through an operator?** Today an operator refuses a long-term key without a mandate in a public deal, and relays a per-deal key without one in a private deal. "A funded wallet is a funded wallet" could mean that an operator in an open club relays for any funded address, with the mandate as optional evidence. The research pass leans that way. The answer decides whether steps 4 and 5 are built.
2. **Does the hard rule's wording stand?** `CLAUDE.md` says every agent message is "checked against the agent's address and scope". On a chain, settlement checks the address. The operators and the counterparty check the scope, and `docs/team.md` pairs the rule with a signature check only. The same rule names the adjudicator as a checker of the `Delegation`, which nothing built does. This record changes neither text.
3. **May step 3 run?** It makes SimChain and the contracts agree, and it moves code between the settlement packages and the operator package.
4. **Does `maxDaily` leave with `categories`?** It is enforceable only per operator. The research pass would remove it. This record keeps it as a statement until Rafa or the richer mandate's design says otherwise.
5. **Should a later contract version offer an on-chain revocation as an opt-in?** It is the one part an enterprise may ask for that the wallet cannot give: a stop that binds a counterparty that does not check.
6. **May the guide name wallet products?** The table in section 1 is useful with examples of a policy service and a smart account. Naming one is a recommendation Crow would stand behind.
7. **For counsel: who bears the loss when a revoked agent deals with a counterparty that did not check?** The guide's sentence on revocation has legal weight.

## How others carry the same ideas

A research pass opened each source on 2026-11-14. Its fetch tool returns a reading of most pages, not their raw text, so check a field name at the link before quoting it. Every row is **checked** unless it says **secondary**, which means the primary page did not open.

| Standard, version and date | How a limit is carried | Who enforces it | Revocation before expiry |
| --- | --- | --- | --- |
| [AP2](https://ap2-protocol.org/ap2/specification/) v0.2.0, released 2026-04-28 | An open mandate signed by the user carries constraints: an amount range, a budget across payments, allowed payees and merchants, an expiry. It binds the agent's key | The merchant checks the checkout constraints. The credential provider and the network check the payment constraints and keep the budget's running total | None defined. A short expiry, and one open mandate in use at a time |
| [Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol), spec 2026-04-17 | An allowance on a payment token: a maximum amount, one merchant, one checkout session, an expiry | The payment provider that issued the token | None in the spec. Stripe's token adds a revoke call at Stripe |
| OAuth: [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396.html) (2023-05), [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html) (2013-08), [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html) (2015-10) | Authorization details in the token, with an amount and a payee in the RFC's own example | The resource server, which in a payment is the bank | The client revokes at the authorization server. Resource servers learn of it by asking (introspection), or tokens are short-lived |
| [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), revision 2026-07-28 | Scopes, with a step-up when a call needs more. No amounts | The MCP server | None on the page. Short-lived tokens |
| [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715) and [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710), both Draft; MetaMask's delegation kit | A permission with rules, redeemed through the account's delegation manager | The account that holds the funds, on chain, at redemption | An on-chain call by the account. A redelegation can add restrictions and cannot remove any |
| [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) accounts (Final) with [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579) or [ERC-6900](https://eips.ethereum.org/EIPS/eip-6900) modules (both Draft) | A session key with caps, written by a module. The standards define no limit themselves | The account contract, when it validates a transaction | An on-chain call by the account |
| Safe [allowance module](https://github.com/safe-global/safe-modules/blob/main/modules/allowances/contracts/AllowanceModule.sol) 1.0.0 | An amount per delegate and token, with a reset period | The module, before it calls the Safe | A Safe transaction |
| Wallet policy services: [Coinbase CDP](https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/overview), [Turnkey](https://docs.turnkey.com/concepts/policies/overview), [Privy](https://docs.privy.io/controls/policies/overview) (pages undated) | Accept and reject rules per signing request. CDP and Turnkey state rules on EIP-712 messages by verifying contract and field | The service, before it signs | The company edits the policy. None of the three counts a windowed total for typed-data signatures |
| [x402](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md) v2, 2025-12-09 | No limit. Client budgets are out of scope | The token, for the one payment | None. A validity window and a nonce |
| [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009), Draft | One transfer: a value, a validity window, a nonce | The token contract | `cancelAuthorization`, optional, before the authorization is used |
| [Visa Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol/overview) (no version); [Mastercard Agent Pay](https://newsroom.mastercard.com/news/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai), 2025-04-29 | A signature that tells the merchant which agent calls. Limits sit with the network's token | The merchant verifies the agent. The network and the issuer hold the limits [secondary] | Not covered on the pages that opened |
| [UCAN](https://github.com/ucan-wg/spec) 1.0.0; [Biscuit](https://doc.biscuitsec.org/reference/specifications.html) 3.x; [ZCAP-LD](https://w3c-ccg.github.io/zcap-spec/) v0.4.0 | A chain of delegations. Each link restates or narrows the one above | Whoever controls the resource checks every link | UCAN: any issuer in the chain revokes; the notice travels by message, is irreversible, and the spec prefers a short expiry. Biscuit and ZCAP-LD: the verifier keeps a list |
| [W3C Bitstring Status List](https://www.w3.org/TR/vc-bitstring-status-list/) v1.0, Recommendation of 2025-05-15 | A published list of revoked credentials | The verifier pulls it and may cache it | A pull, with a staleness window as long as the cache |

What this record takes from them:

- **The party that holds the money or the key enforces the limit.** That is true of every row that carries one. The receiving party checks one deal at most. Section 1 follows it: the payment address holds the limit, and the counterparty checks one deal against the mandate.
- **A cap across deals exists only where one party sees every spend:** AP2's budget at the credential provider, the Safe module's counter, an account's session module. No row has a counterparty or a relay keep a total. Section 3 follows it.
- **None of these rails enforces a category.** AP2's merchant checks line items, because the merchant knows what it sells. Section 2 follows it.
- **Revocation comes in three forms:** a write at the one enforcer, a list that verifiers pull, or a short expiry in its place. Section 4 uses all three: the payment address is the one enforcer of the money, the operators' agent read is the list, and a mandate's expiry is the company's to set short (D31).
- **Delegation that only narrows is a chain that the verifier checks link by link.** Section 5 leaves room for exactly that.

## Review

**The research pass.** A second agent at the highest effort read the code and the ADRs and formed its own answers. It then found this record's draft in the worktree and checked it line by line, so it is a second reading and not a blind one. Its verdict: the five answers hold. Its findings that changed this text, beyond those the reviewer also made:

| Severity | Finding | What changed |
| --- | --- | --- |
| High | A multisig or a smart account cannot fund through the API: the signature field is 65 bytes | Fact 10, the limits in section 1, the company table, the build's step 2 |
| High | Revocation has nothing to end until a company can post its own mandate, and that route needs the agent's consent and a key by principal, agent and club | Fact 11, the two rules in section 4, the build's step 4, `attack.third-party-mandate-overwrite` |
| Medium | Several fixtures cannot be written with today's testkit: one settlement object serves every operator, and the scenario format has no scope key or contract call | The build's step 3, and named tests on a local chain until then |
| Medium | More standing texts state the old picture | The list under the build |
| Medium | `categories` can leave the JSON contract without a redeploy | The two moves in section 2 |
| Low | An operator that withholds a mandate stops a careful counterparty that reads mandates from operators | The agent hands over its mandate; `neutrality.operator-withholds-mandate` |
| Low | The notice should leave evidence; the principal is a new actor | The event and receipt in section 4, and the row in `docs/neutrality.md` |

It would also remove `maxDaily` and make the mandate optional at an operator. Both are Rafa's questions 1 and 4.

**The reviewer.** One pass by the `reviewer` agent on 2026-11-14, at commit `0949d341`, with `CLAUDE.md`, the ADRs this record builds on, `docs/neutrality.md` and `docs/audit/threat-model.md`, and without this record's reasoning beyond its text. Verdict: ISSUES, with no Critical finding, 4 High, 6 Medium and 8 Low. It confirmed the code citations it could open, the scope of the change and the links. Every finding is fixed in this text or answered here.

| # | Severity | Finding | What changed |
| --- | --- | --- | --- |
| 1 | High | SimChain checks the mandate at settlement, and the record described the contracts only | A SimChain column in the table, fact 3, "Where SimChain stands" in section 1, the fixtures say where they run, and step 3 moves the check. Rafa's question 3 |
| 2 | High | The revocation's `expiresAt` is the message-expiry field; a short one lapses and the mandate applies again | Section 4 states the rule on time, the default, and what a lapse does |
| 3 | High | A revocation was not bound to the mandate's principal; a stranger's would verify | Section 4: a revocation counts only against a mandate of its own principal; the status is per mandate; the storage rule; the forged-revocation fixture is split in two |
| 4 | High | The record amended ADR-0024 section 7, which a hard rule in `CLAUDE.md` repeats | The amendment is withdrawn. The adjudicator stays a checker; the gap is recorded and built in step 6. Rafa's question 2 |
| 5 | Medium | Funds leave on two signatures, the funding and the operator fee, not one | Section 1 names both |
| 6 | Medium | "Cut my agent off now: nobody" overstated; standing texts bound the loss by the scope caps | The table row is qualified; section 4 states the bound; step 1 corrects the three texts |
| 7 | Medium | A per-deal key passes an operator that holds the revocation | Section 4, "A per-deal key is the counterparty's to check", the company table, and a client test |
| 8 | Medium | The counterparty column overstated the reference client's check; three line numbers were off by one | The table and fact 5 state what the client compares; the lines are corrected |
| 9 | Medium | The build order left out the route for a company's own mandate | Its own step, 4, with its rules, tied to Rafa's question 1 |
| 10 | Medium | Two revocation timings were unspecified | Section 4 lists the funding on SimChain and the agreement to a revoked seller's offer |
| 11 | Low | Version naming; `hasCategories`; `commitment.schemaVersion`; where the problem list and the agent read live | Sections 2 and 4 |
| 12 | Low | Two fixture names differed from the planned ones | `error.scope-exceeded` and `error.revoked-agent` |
| 13 | Low | Section 1 had no fixture for its own boundary | `attack.over-cap-agent-submits-directly` and a client test |
| 14 | Low | Only section 1 weighed options against the tests | Tables with a verdict in sections 2, 3, 4 and 5 |
| 15 | Low | Labels: `checked` undefined, some rows unlabelled, two overstatements | The label list, the rule for unlabelled citations, the summary and the smart-account wording |
| 16 | Low | Metaphors and three passive sentences | Reworded |
| 17 | Low | Placeholders in this section and in the task file | Filled |
| 18 | Low | The MCP link pointed at `latest` | Pinned to the dated revision |

**The re-check.** The reviewer read the revised text at `15a7ed43`. It confirmed 17 of its 18 findings fixed and the last partly fixed, and it confirmed facts 10 and 11 and the two-move removal of `categories`. It found no path to a funded hold. It raised two Medium and six Low points, all fixed here: a revoked agent that posts its old mandate to an operator that never held the revocation (the storage rule, the check before admission, `attack.revoked-agent-readmits-mandate`); which of several mandates an operator applies (the rule in section 4, and Rafa's question 1); the schema change for the agent's consent; the step that carries the JSON removal; one citation; the count of `neutrality.*` fixtures; a seller's revocation before a buyer's funding on SimChain; and fact 10's heading.

The reviewer did not verify the AP2 and x402 dates or the wallet services' policy claims; they rest on the research pass. It recommends a second review by a model of another family before revocation is built. Step 5 carries it, and it should cover the two Medium points of the re-check.
