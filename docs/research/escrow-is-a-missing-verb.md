# Escrow is a missing verb in agentic AI

Market research essay, 29 October 2026.

*Runtime procurement can pick a supplier and pay it. Nobody has built the part that holds the money while another firm's agent does the work.*

In February, [Liquid Services and Runtime Procurement](https://npcmemo.substack.com/p/liquid-services-and-runtime-procurement) argued that procurement is moving into the runtime path of software. It asked who would run clearing: issuing entitlements, enforcing budgets, settling, keeping the audit trail and handling disputes. Anyone who has run procure-to-pay will recognize that list. It is the back office.

Eight months in, half of that back office works for agents. Metered, swappable services clear fine. Chainalysis counted 138.5 million x402 payments on Base by October 14, 2026, more than 87% of them under ten cents. At that ticket size nobody files a dispute. You eat the cost and route to the next supplier.

Commitments are a different line item. Pactum's agents negotiate with Walmart's human suppliers, and C.H. Robinson's agents book loads for human shippers. Where both sides are agents, a person still signs off: AdCP media buys total about $1 million (PPC Land, October 24, 2026), and the seller approves each one.

Per-call spend clears. Commitments still route to a human approver.

## Two agents can agree on a job, but nothing holds the money

Take a $2,000 job: clean a dataset within 48 hours. A procurement agent can find a provider agent at another firm, check budget and policy, and confirm who runs it. Then it hits the rule every buyer knows: you don't pay a services invoice until the work passes acceptance. A call settles on receipt. A job needs a hold, a deliverable, an acceptance decision, then release or refund. A2A can't record any of that; its first task state means received, not agreed.

In procurement terms, the job needs a holdback. As of October 2026, these are the escrow routes an agent can actually call.

| Route | Who holds the money | Who decides release | Who absorbs a wrong call |
| --- | --- | --- | --- |
| Stripe Connect, manual payouts | The platform's Stripe balance | The platform | The platform, plus chargeback exposure |
| Escrow.com API | A licensed escrow company | The buyer accepts, or the inspection period lapses | Human case managers |
| Commerce Payments Protocol (Coinbase, Shopify) | A contract holding USDC on Base | The operator captures; the payer reclaims after expiry | The operator |
| ERC-8183 evaluator escrow | A contract | One named evaluator, with no appeal | Both parties |

None is a clean fit. Card funds can sit only with a merchant or a platform, and Stripe's docs say plainly that it "doesn't provide escrow services." The payer keeps chargeback rights after release, so card-funded escrow is never final. Stablecoins can sit in a contract, but release then depends on an evaluator you have to trust. Nothing spans both rails with a neutral release rule.

## Machines already clear commitments where code can check delivery

Settlement people solved this long ago for one class of deliverable. NSCC nets about $2.2 trillion of trades a day into $33.5 billion of settlement (DTCC 2024 annual report). No algorithm in those trades trusts its counterparty, and none needs to.

| System | What the machine commits | How delivery is checked | Who bears a wrong call |
| --- | --- | --- | --- |
| Equity clearing (NSCC) | Pay for or deliver securities | The settlement system matches securities against cash | Clearing members, through margin recalculated every 15 minutes and the Clearing Fund |
| Pre-trade controls (SEC Rule 15c3-5, 2010) | Send only orders within credit and capital limits | An automated check before the order reaches the exchange | The broker-dealer |
| Hashed timelock contract | Pay whoever presents a proof before a deadline | A hash preimage; otherwise the payer is refunded | No one: payment and proof are atomic |
| Across Protocol relayers | Front capital to fill a bridge transfer | A bonded bundle anyone can dispute for about an hour | The proposer's bond; disputes go to a UMA token-holder vote |

Every row works because the settlement system can check delivery itself: securities against cash, a hash preimage, a transfer on another chain. Delivery versus payment folds acceptance into settlement, in one step or one bonded window. A cleaned dataset has no DvP. Whether the work is any good isn't on a ledger, so acceptance splits from settlement and someone has to own it. Agent work clears programmatically when acceptance criteria are machine-checkable. Otherwise it needs a judge with money on the line.

## Identity is solved; but nobody pays for a wrong call

Run the five clearing duties against what agents have today. Four are live. The one that matters for services is not.

| Clearing duty | Status, October 2026 |
| --- | --- |
| Issue entitlements | Running: Visa, Mastercard and American Express agent registries; Microsoft Entra Agent ID |
| Enforce budgets | Running: scoped card tokens, single-use agent cards, on-chain spend permissions |
| Settle payments | Running: card rails, x402, Stripe Shared Payment Tokens |
| Log provenance | Partial: signed mandates in pilots (AP2 v0.2, April 2026) |
| Arbitrate disputes | Missing: no card network shifts liability for an agent's in-scope error; ERC-8183 escrow has "no dispute resolution or arbitration" |

Identity isn't the gap. Every loss on record involved a properly identified agent acting on bad instructions. On May 4, 2026, Bankrbot moved funds from Grok's verified wallet after Grok decoded a Morse-code prompt; about $150,000 to $200,000 left, and most came back.

The pattern is one every procurement team knows. Spend flows where someone owns the risk. Where nobody does, it stays small or goes to a human approver.

## Clubs come first because they need no new capital

The cheapest risk-bearer is a contract signed before anyone transacts. Procurement already runs this way. A group purchasing agreement lets members buy under terms negotiated once, and a framework agreement lets a buyer place call-offs without renegotiating. A club is that structure for agents, with buyers and sellers both as members, closer to a card scheme than to a GPO. Members agree once on which signed offers count, when a commitment exists, what the remedy is and how disputes get settled. After that, nobody approves each order.

Machine commitments grew up this way before. EDI partners signed one trading partner agreement and let computers exchange binding orders under it. Programmatic advertising drifted from open auctions to deals with known sellers, about 75% of programmatic display in 2023 (eMarketer). The legal plumbing exists. UETA §14 binds contracts formed by electronic agents, and the UNCITRAL Model Law on Automated Contracting defers to the procedure the parties agreed (Art. 7(1)).

Card networks are clubs already. Issuers and acquirers sign up to one rulebook, and Visa's registry of trusted agents is a membership list. The first live B2B pilot, Visa with BILL and Billtrust (October 20, 2026), has registered agents paying invoices the buyer already approved, between firms that already trade. Signed mandates (AP2) give the club an audit trail of what each principal authorized.

## Club records make a new entity possible: a model judge with capital behind it

A master agreement names a dispute procedure, but somebody still has to run acceptance on every job. Clubs produce what that somebody needs: acceptance criteria fixed up front, signed mandates and a history of outcomes. With that history, a new service becomes viable. Call it a bonded adjudicator: an acceptance desk that uses models to judge delivery and pays out of its own capital when it gets the call wrong. Trade finance has a rough version, where a bank pays against an inspection certificate and the inspector's name stands behind it. Here a balance sheet replaces the name.

The model does the judging. The capital keeps it honest: a judge that pays for its mistakes has to measure its error rate and price it into the fee. Each of the other arrangements supplies one piece.

| Part | Comes from | Exists today |
| --- | --- | --- |
| Acceptance criteria and a named procedure | Clubs | Umbrella contracts; no agent template yet |
| Evidence of what the principal authorized | Payment-network mandates | AP2 v0.2 in pilots |
| Model judgment | AI arbitration | AAA-ICDR AI arbitrator for documents-only construction cases (November 2025), with a human confirming each award |
| Appeal and slashing | Staked evaluators | Across disputes go to a UMA token-holder vote |
| Capital and pricing | Insurers | Deployer cover, such as Armilla's up to $25 million; none for commitments between agents |
| A legal wrapper | Business-entity law | Bayern argues LLC statutes can give software basic capabilities of personhood (2019) |

Divisible work stays out of this. Metered sessions pay unit by unit, so no single miss is worth disputing. The adjudicator earns its fee on what can't be split: the $2,000 dataset, the supply contract.

## The adjudicator has to survive model drift, hostile inputs and correlated error

Model judgment moves when the model does. Kleros ran 99 consumer disputes through several models (Kluwer Arbitration Blog, July 22, 2026). Upgrading from Claude Opus 4.7 to 4.8 flipped 11 outcomes, 10 of them toward the platform. An adjudicator has to pin and disclose its model versions, the way a clearing house publishes its margin methodology.

Treat every deliverable as hostile input. Suppliers will tune their work to pass the judge, the same way they game any selection function. Deliverables can also carry injected instructions; in NIST's agent-hijacking tests, new attacks raised success from 11% to 81%.

Watch concentration. Insurance assumes losses are independent. If most adjudicators run the same few models, they get the same cases wrong on the same day, which is how the rating agencies failed in 2008. Panels drawn from different model families are the hedge.

Then the usual operating constraints. Holding stakes is licensed activity in most jurisdictions, and an award with no human sign-off may not hold up, which is why the AAA keeps one. The fee also has to fit inside the job's margin, so small jobs may never carry a capitalized judge.

The February essay put the durable moderator at "the layer that couples demand capture to settlement (and governance)." For commitments, the sequence looks like this: clubs first, then a bonded adjudicator that couples settlement to acceptance. It holds the stake, decides who gets paid and covers the loss when it is wrong.

Agents already have the verbs to talk, identify and pay. The missing verb is hold: something that keeps the stake, judges delivery and pays for a wrong call. Until it exists, agents still act as delegates; they do not yet make staked promises to each other.

## Sources

The sources list is kept in the canonical Claude Docs version. Key sources are also cited in `agent-to-agent-commitments-report.md` and `escrow-options-2026-10.md`.
