# Messaging

> **Status (2026-11-03): partly superseded.** The product is ’crow, "Programmatic Escrow and Arbitration", at escrow.stream; Holdback is the protocol's name. "It carries the load" and the mule voice notes predate the crow, and agents integrate through the HTTP API and `llms.txt`, not an SDK (D30). The current copy is `site/llms.txt` and `site/index.html`.

Draft, 2026-10-31. Every claim below is true of the Phase 1 build unless marked *direction*.

## One-liner

**Holdback lets two AI agents from different firms make a deal neither has to trust: the money and the work are held until the agreed judge says the work is good.**

Short form: *Escrow for agents. It carries the load.*

## The pitch (about 60 words)

Agents can now buy work from other agents: data cleaning, translation, code fixes, research. What they can't do is trust a stranger with money. Holdback holds the buyer's payment and the seller's sealed work together. Checks and a panel of models from different families decide whether the work meets the terms. Then payment and the work move at once, or the buyer is refunded.

## Who it's for

| Audience | What they care about | Lead with |
| --- | --- | --- |
| AI labs researching agentic commerce (first audience, `docs/demo.md`) | Can agents transact safely, at machine speed, without a human in the loop? | The demo: a deal in under a second, an injection caught, an operator refusing and the deal still settling |
| Agent builders | One API call to fund a hold; receipts; no chain plumbing | The SDK and the signed receipts |
| Agent owners and their legal teams | Bounded loss and a record a court accepts | Mandate caps, the shared signed record (D26) |
| Adjudicators | A market for judging, paid per case | Fees, bonds, a public track record |
| Capital providers | Yield for capital at risk behind adjudicators | Bond backing (*direction*, ADR-0014) |
| Operators | A business without needing control | Underwriting, compliance and protection as services (*direction*, backlog) |

## Pillars

1. **Nobody holds the keys alone.** No single party can stop a valid deal from settling or move held money outside the terms, including us. (Litmus test 1.)
2. **The money and the work move together.** Payment and the work's key are released in the same step, or the buyer is refunded and the seller keeps the work. (The hold.)
3. **Judgment you can check.** Deterministic checks first, then pinned models from at least two families, chosen so nobody can pick friendly judges, and defended against injection. Appeals are backed by the adjudicator's bond.
4. **The parties choose.** Buyer and seller pick their own adjudicators and terms, and the protocol enforces what they chose.
5. **Both sides remember.** Each party ends with the same complete, signed record. Courts remain the backstop; we widen what agents can safely do together (D26).

## Proof points (measured in the demo)

- A hold funds in one call; the full happy path settles in under a second on SimChain.
- A required check catches bad work and refunds the buyer without any model call.
- Hidden characters are stripped and flagged before any judge reads the work.
- An operator refuses and another goes offline; the agents submit directly and the deal still settles.
- An adjudicator goes silent; anyone triggers the fallback, which decides.
- Both agents' copies of the record match.

State the limits alongside: SimChain, scripted judges, no real money, invented cast.

## Voice

- Plain and calm, like the mule. Short sentences. No hype.
- Concrete over abstract: "the buyer is refunded and the seller keeps the work", not "trust-minimised settlement".
- Honest about stage: say "prototype", "scripted", "direction" where true.

## Words

| Use | Avoid | Why |
| --- | --- | --- |
| hold, commitment, judgment, receipt, settle | escrow-as-a-service, trustless | "Trustless" overclaims; parties still trust the terms and the judges they chose |
| adjudicator, panel, judge | AI arbiter, robo-judge | Precise, and matches the spec |
| neutral, nobody can stop it | decentralised, censorship-resistant | Says what it does, not the ideology |
| settlement layer (only when asked) | blockchain, crypto, token, on-chain in headlines | The chain stays behind the API |
| pack mule, carries the load | money mule, moves your money | AML connotation (`mascot.md`) |
| prototype, scripted judges | live, production, AI-verified | Not true yet |
