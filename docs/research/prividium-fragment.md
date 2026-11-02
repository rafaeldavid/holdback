# Prividium as a single-use fragment per escrow (T-208 research pass)

- **Date:** 2026-11-02. **Status:** research, no decision; feeds a D4 update and the T-208 recommendation.
- **Method:** read-only. Both repos were read through `gh api` (compose files, seed SQL, contracts, SDK); nothing was cloned or run. Matter Labs' public docs are cited by URL. Labels: **measured** (read in the repos' files), **sourced** (a cited page), **inferred**, **guessed**.
- **Question** (`docs/backlog.md`, "Exploration: a single-use Prividium fragment per escrow"): can each deal run in its own short-lived Prividium instance, unseen by operators, with the money staying in the L1 escrow? D4 (2026-11-01) requires the fragment's operator to be unable to block settlement and unable to read the deal.

## 1. What Prividium is, component by component

| Component | In `local-prividium` (measured) | Production (sourced) | What it sees or can do |
| --- | --- | --- | --- |
| Permissions API with proxy RPC (`prividium-permissions-api` v1.312.0; private `quay.io` image, `linux/amd64` only) | REST for OIDC (Keycloak JWKS), SIWE (`crypto_native`), passkeys; users, roles, organizations, M2M API keys and per-contract, per-function, per-argument permissions in Postgres; `/rpc` and per-user `/rpc/wallet/{token}` forward to the sequencer | The operator's DMZ tier | Plaintext of every request: "The proxy authorizes a transaction from its `to`, calldata and value". A write needs a prior authorization `{walletAddress, toAddress, nonce, calldata, value}`, valid one hour. Reads are filtered per caller (own balance, nonce, code; `eth_getStorageAt` forbidden) |
| Admin role | `OIDC_ADMIN_SUBS`, `CRYPTO_NATIVE_ADMIN_WALLETS`; the seed grants `{contract_deployment, full_sequencer_rpc_access, full_read_access, admin_read, admin_write}` | The operator's staff | `full_sequencer_rpc_access` "Bypasses all permission checks"; `full_read_access` "Grants access to read the entire chain"; grants and revokes without delay. An optional policy engine adds approvals and an `/admit` hook inside the sequencer |
| Sequencer (`zksync-os-server` v0.24.5) | One process with RocksDB; `batch_timeout: 1s`; L1 sender with three operator keys (commit, prove, execute); `fake_fri_provers` and `fake_snark_provers: enabled`; `pubdata_mode: Blobs` to a local Anvil (12 s blocks) from a baked 15.8 MB L1 snapshot (Bridgehub `0x2442…`, chain id 506) | Operator, private subnet | Orders, executes, and can stop everything. The docs place L2 filtering "before txs get to the mempool" |
| Prover | Absent (fake) | Operator's "CPU/GPU workers; auto-scalable" | Without it no batch is proven, so no withdrawal or L2-to-L1 message reaches L1 |
| Identity | Keycloak 26, realms `prividium` and `acme`; an organization may bring its own OIDC provider (`oidc_providers` table) | Operator's IdP (Okta, Keycloak) or SIWE | Every address is bound to an enrolled login |
| Data | Postgres (permissions, explorer), RocksDB (state) | Operator's data tier | Validium: "Only the state roots and zero-knowledge proofs are posted to Ethereum"; a Stage 0 validium "only stores its pubdata in the database of the node(s) running the chain" |
| Explorer, webhooks, Prometheus, Grafana | Gated through the permissions API; the webhook service is an M2M app with `rpc_read_*` | Operator | Read scope follows the caller's role |
| L1 side | Bridgehub, the chain's diamond proxy, optional `TransactionFilterer` | Chain admin key, filterer owner | Only whitelisted addresses may send arbitrary L1-to-L2 transactions; others may only deposit to themselves; the chain admin key can upgrade the filterer. L2BEAT on Era (same stack): users "can submit transactions to an L1 queue, but can't force them"; the sequencer "can stop processing the queue entirely" |

Licensing: "production deployments require a commercial agreement" (sourced). Local footprint: 4 GB RAM, 15 GB disk, about 10 GB of images, 14 host ports, Rosetta on Apple Silicon (measured, README).

**What is private from whom.** From the public and from Ethereum: everything except state roots, proofs, deposits and withdrawals. From other users: whatever the permission rows deny. **From the operator: nothing**; the proxy, the sequencer and the databases hold plaintext, and the admin role reads all of it (sourced). Matter Labs does not run the chain; the operator does, "within their own infrastructure or cloud" (sourced).

**Mapping to ADR-0001.**

| Operator power | Effect on a valid deal | What the design would have to do |
| --- | --- | --- |
| Stop the sequencer or prover | Nothing in the fragment settles; no proof reaches L1 | The L1 timeout (ADR-0007) must settle without the fragment, so the fragment is a fast path, never the settlement |
| Return 403 to one party, or revoke its permission | That party misses a deadline; the default outcome falls on it | Same; one party's stall becoming a protocol outcome is the "single party can stop" failure |
| Withhold pubdata (Stage 0 validium) | Nobody can reconstruct or prove the record | D26 evidence must live outside the fragment, as signed messages, as ADR-0024 already does |
| Read everything | Fails the 2026-11-01 requirement outright | Only an adjudicator-run instance passes (residual 6 already trusts it with plaintext), or content is encrypted before it enters, and then the fragment adds nothing over ADR-0024 |
| Filter L1-to-L2 | Blocks a party's forced entry | Harmless only if settlement never depends on entering the fragment |
| Upgrade the chain's L1 contracts | Changes what a proof means | The L1 escrow must trust only its own code and a pinned verifier (inferred) |

## 2. The institutional intraday-repo demo

**What it is (measured).** A Nuxt app over `RepoContract.sol`: a lender creates an offer, a borrower posts collateral and receives the loan, repays or loses the collateral after a two-minute grace period. Chain 6565 and chain 6566 each have their own permissions API, admin and user panels and explorer, sharing one Keycloak and one Postgres. The sequencer image is `zksync-os-server:test-only-interop-demo` from branch `sb/interop-type-b-demo`. A `cast-interop auto-relay` process holding a private key executes interop bundles on the destination chain. "Shadow accounts" let a chain-2 user act on chain 1; the SDK says they are "only available for demo purposes". USDC, TUST and SGD are `TestnetERC20Token`s minted on L2; only ETH is deposited from L1 through the Bridgehub. Permissions: the ERC-20 template marks `balanceOf`, `allowance`, `transferFrom` and `mint` as `restrictArgument` (a user reads only its own balance); every repo function is `public`. The contract has `admin`, `setAdmin`, `setGracePeriod` and `setUnbundlerAddress`.

**What it shows.** Two institutions, each on its own operator-run chain, settle a bilateral collateralized loan with per-user read privacy, across chains by message bundles (send, finalize on the source, wait for the root on the destination, execute: minutes, and relayer-dependent, not atomic). **What it does not show:** privacy from either chain's operator, or an L1-held asset released by an L2 outcome. Matter Labs' Q2 2026 report calls private atomic interoperability "architecture" and "proof-of-concept", with delivery-versus-payment as the target (sourced).

**What carries over.** (a) The one primitive a fragment would need: an L2-to-L1 message (`L1Messenger.sendToL1`, system contract `0x…8008`) proven in a batch and checked on L1 with `proveL2MessageInclusion` (Gateway era: `proveL2MessageInclusionShared` at `0x…10009`); the L1 escrow could accept `(commitmentId, outcome)` this way, tracking consumed messages itself (sourced). (b) The shape "a party reads only rows about itself", which ADR-0024's `ReadToken` already gives at the API with no chain. Not carrying over: shadow accounts, the relayer, the admin-keyed contract, L2-minted tokens.

## 3. One fragment per escrow?

**Not a supported shape** (measured, inferred). A chain is a static L1 registration (chain id, diamond proxy, Bridgehub entry; ZK Stack registration "is not permissionless"), a genesis, a sequencer with its own database, three funded L1 operator keys, a permissions API with Postgres, an identity configuration and a prover. The local stack bakes the L1 state into a snapshot and the chain id into `config.yaml`; there is no API that creates chains, and participant sets are user and role rows in the operator's database, not a property of the chain. Per-deal creation would mean per-deal L1 contract deployment (millions of gas, guessed) plus per-deal batches whose commit, prove and execute (about 460k gas of verification per batch, dated, from ADR-0024) are amortised over nothing, against a whole happy path of 395,831 gas today (measured, T-202). Latency: sub-second inside the fragment; an L1 outcome waits for a batch to be proven and executed at the operator's pace (Era posts state updates about every 57 minutes on average, measured on L2BEAT); real prover time for Prividium is unknown (the vendor claim "subsecond block proofs" is unverified).

**Realistic shapes.** (i) One shared Prividium chain per operator or club with per-deal permissions: organizations own roles and contracts, users belong to one organization, reads are filtered per caller; the operator reads everything, so this is ADR-0004's club-chosen permissioned chain with its signed residual, not a privacy gain. (ii) An adjudicator-run instance: the one party already trusted with plaintext; it passes the reading test, but it can stall, so the L1 timeout stays the settlement, and its confidentiality set equals ADR-0024 B's at the price of a chain.

## 4. Against the bar

| Shape | Same agent API? | Protocol simpler? | Strictly more private? | Removable without a protocol change? |
| --- | --- | --- | --- | --- |
| ADR-0024 B (being built) | Yes | No new actor, no gas | Ciphertext at operators; the adjudicator reads | n/a |
| Prividium fragment, operator-run | Only if the operator enrols the per-deal keys and relays, which makes it the admin | No: a sequencer actor, a proof-verification entry in the rules contract, chain registration | Less: plaintext at the operator | Only as a pure fast path; the verifier entry is an ADR and schema bump to add and to remove |
| Prividium, adjudicator-run | No: SIWE enrolment and one-hour per-transaction authorizations per key | No | Equal to B | Same |
| Shared club chain | Yes, behind the operator | No | Less | Yes, as a settlement option with a signed residual |
| Far-future ZK fragment | Yes | No, but any party may prove | More: independently verifiable | n/a |

No Prividium shape keeps the API identical while making the protocol simpler or strictly more private. The product is licensed, single-operator, `amd64`-only and served from a private registry, which would make a vendor one of the parties ADR-0001 must tolerate losing, against protocol property 3.

## 5. Recommendation: park, with an optional half-day probe

Park T-208 as answered on sourced evidence and record the result under D4. The far-future row (a generic ZK fragment, any party may prove) keeps the idea alive without the vendor.

If Rafa wants measured rather than sourced evidence once `.env` holds the registry credentials (`pnpm prividium:login`, `docker compose up -d`, seed step 4), the smallest spike worth running, with no protocol code:

1. **Boot.** Time to `curl :8000/health`, RAM and disk.
2. **Reading test.** As `admin@local.dev` or the admin wallet, read `user2`'s transaction and logs through `/rpc` and the explorer. Expected: visible. Note whether the chain runs with the admin role deleted.
3. **Blocking test.** Revoke `user1`'s write permission on a deployed contract mid-flow (expected: 403). `docker compose stop zksyncos`, then confirm from Anvil that no withdrawal or L2-to-L1 message progresses.
4. **Outcome path.** Deploy a tiny `Outcome` contract that calls `L1Messenger.sendToL1(abi.encode(commitmentId, outcome))`; wait for the batch to execute on Anvil (fake prover); call `proveL2MessageInclusion` from a stub L1 verifier; measure gas and the transaction-to-L1 latency.

**Pass (keep exploring):** a documented way to run with no superuser read and a relayable opaque payload; L1 verification under about 150k gas inside one batch interval; chain creation scriptable without the ecosystem owner's keys. **Fail on the first:** park definitively. Expected from the docs: fail. The local stack proves nothing (fake provers) and posts pubdata as blobs, so it cannot measure prover cost or validium behaviour.

## 6. Open questions

**For Matter Labs.**
- Can a chain run with no role holding `full_read_access` or `full_sequencer_rpc_access`, and can the proxy relay payloads it cannot decode?
- Is there a supported separation between the permissions-API operator and the sequencer or prover operator, or multi-operator sequencing (the Q2 report mentions Stage 1 decentralization work)?
- Mainnet chain creation: time, L1 cost, who signs; does a Gateway settlement option exist for Prividium after the "legacy Gateway sunset"?
- Validium exit: can a user prove and withdraw on L1 when the operator stops? The filtering page asks operators to "think about" this; does Prividium ship it?
- What is "private atomic interoperability" concretely, and can an outcome on a private chain release an asset on L1 atomically?
- Can M2M or agent clients obtain per-transaction authorizations without a browser (the wallet endpoint "should only be used as an RPC URL in a user wallet application")?
- Licensing for an open protocol, `arm64` images, production prover requirements, and per-batch L1 costs measured on Cari or Memento.

**For Rafa.**
- Is the goal privacy from ’crow's operators (ADR-0024 B gives it with no infrastructure) or an Ethereum-anchored private evidence ledger (which Prividium's selective-disclosure storage proofs give)? If the latter, is it worth a sequencer actor over signed hashes in calldata (D26)?
- Would an adjudicator-run instance be acceptable as the only neutral reading, and does it beat the adjudicator holding the sealed record (ADR-0024 §2)?
- Is a licensed, private-registry vendor acceptable in any protocol component, against the far-future generic fragment?
- Does the team's Matter Labs relationship matter for the demo audience, and if so, is the club-chosen settlement residual the right place for it?
- Close T-208 as parked with this document, folding the open questions into the far-future row?

## Sources

- https://github.com/matter-labs/local-prividium (README, `docker-compose.yaml`, `docker-compose-deps.yaml`, `docker-compose-examples.yaml`, `dev/zksyncos/config.yaml`, `dev/wallet-auth/`, `dev/service-auth/`, `dev/multi-org/`, `dev/examples/`)
- https://github.com/JackHamer09/prividium-institutional-demo (README, `contracts/src/RepoContract.sol`, `prividium-utils/docker-compose-prividium.yaml`, `prividium-utils/dev/seed-permissions-l2a.sql`, `sdk/README.md`, `demo-app/`)
- https://docs.zksync.io/zk-stack/prividium (overview, architecture, features, deployment); https://docs.zksync.io/zk-stack/customizations/validium; https://docs.zksync.io/zk-stack/customizations/transaction-filtering
- https://docs.prividium.zksync.io/ (architecture, `rpc/per-user-rpc`, `rpc/rpc-support`, `configuring/users/system-permissions`, `configuring/contracts/selective-disclosure`, `configuring/chain/tx-filterer`, `configuring/chain/policy`, `configuring/chain/organizations`, `configuring/chain/bridging`)
- https://forum.zknation.io/t/matter-labs-q2-2026-deliverables-report/1054 (2026-07-13)
- https://l2beat.com/scaling/projects/zksync-era (risk summary, liveness)
- https://docs.zksync.io/zksync-network/zksync-connect/messaging (L2-to-L1 messages); https://www.nethermind.io/blog/starknet-and-zksync-a-comparative-analysis (460k gas per Boojum batch, dated)
- https://ethsystems.org/vendors/zksync/ (vendor claims, unverified)
