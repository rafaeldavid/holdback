# T-235: Choose an EVM chain on which a deal settles in seconds

- **Lane:** research | settlement
- **Phase:** 5
- **Depends on:** Phase 2's exit (D53, D54). T-215's gas per deal.
- **Paths this task may touch:** `docs/research/` (a new research note), `docs/decisions-today.md` (a new decision that revisits D4), `docs/decisions/` (an ADR if the target chain changes), `docs/plan.md` (this row)
- **Human gate:** yes for a deploy to a new testnet, and Rafa decides the chain. The research itself needs no gate.
- **Status:** todo (deferred until after stable EVM operations, D53; Rafa, 2026-11-06: "Defer it (D53)")
- **Agent/session:** none yet

## Intent

Rafa, 2026-11-06, on the fact sheet's "settles in seconds": "This is the objective, including finding an EVM blockchain that supports it".

A deal that nobody challenges should reach `Released` within seconds of the delivery, on a chain that keeps the neutrality test. This task finds that chain, measures it, and brings the choice back to Rafa. That revisits D4, which sets Ethereum mainnet as the target.

Non-goals: a mainnet deploy, contract changes (those go with T-212's redeploy in Phase 11), and non-EVM chains.

## Context

- **Today on Sepolia (measured):** a direct test deal ends `Released` in 45 s (T-231's smoke deal, 2026-11-06). From the One-Click prompt, the deal itself takes 52 to 63 s (2026-11-05, `docs/research/2026-11-05-one-click/`). Each of a deal's three transactions (fund, deliver, decide) waits for a 12 s block. The appeal window after the decision is a term the parties set (60 s on the demo), not chain time.
- **Gas (measured, T-066 and T-215):** about 1.26 to 1.64 million gas for a deal's own transactions, depending on the method, and about 1.45 million with a share of setup. At the prices of 2026-11-05 that's about USD 0.04 per deal on Base and about USD 18.70 on Ethereum mainnet (inferred).
- **D4 (2026-11-01):** Ethereum mainnet was chosen for neutrality and reliability, because no single sequencer can censor or delay a deal there. D4 also says to revisit it on evidence: "If measured gas makes typical deals uneconomic, bring this back with numbers." Speed is a second reason.
- **The criteria already on record:**
  - L2 sequencer censorship, met by forced inclusion through L1 where the chain supports it (decisions-today, the risks list);
  - the fifth criterion: anyone can read the public skeleton and submit a signed message without an admin (D4's update of 2026-10-31, ADR-0004);
  - windows sized for the forced-inclusion delay (`docs/architecture.md`, deadlines);
  - account abstraction and paymasters for agents (D4's 2026-10-30 options; Phase 5's paymaster row).
- **What settlement needs on the chain:**
  - native USDC (D42);
  - Coinbase's Commerce Payments `AuthCaptureEscrow` with its ERC-3009 collector, which holds the money, or a deploy of it;
  - the drand quicknet proof check (T-217);
  - an RPC that doesn't trail the chain: the stale-read class that T-226, T-230 and T-232 deal with.

## Acceptance criteria

- [ ] **A research note.** It compares candidate EVM chains on:
  - time to `Released` for a deal's three transactions: block time, preconfirmations, and inclusion as measured on the RPC;
  - finality and reorg risk;
  - forced inclusion and the censorship delay, sized against the neutrality test;
  - gas per deal in USD at the measured gas;
  - native USDC and Commerce Payments availability;
  - the precompiles and opcodes the contracts and the drand check need;
  - the testnet, RPC reliability, and account abstraction and paymaster support.

  It runs as a Fable research pass at max effort, with a recommendation (decisions via Fable max).
- [ ] **A measured deal per shortlisted chain.** On each shortlisted chain's testnet, a deal's three transactions are timed with the current contracts, with Rafa's go-ahead for each deploy.
- [ ] **A decision entry** in `docs/decisions-today.md` that revisits D4 with the numbers, for Rafa to decide. It gets an ADR if the target chain changes.
- [ ] **The neutrality fixtures** (`neutrality.*`) still hold on the chosen chain, including a sequencer that refuses a valid commitment.

## Out of scope

- A mainnet deploy, which is a separate gate after an audit.
- Contract changes, which wait for T-212's redeploy in Phase 11.
- Moving the live Sepolia demo, which needs a new demo world (D49).

## Evidence

Not started.

## Decisions

None yet.

## Handoff

Filed on 2026-11-06 and deferred under D53, after Rafa answered "Defer it (D53)". Start once Phase 2's exit criteria are met. Begin with the research note, then the shortlist's testnet measurements.
