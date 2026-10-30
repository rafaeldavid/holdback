# Crypto-native and on-chain agent-to-agent commitments (state as of late October 2026)

Scope note: These notes cover on-chain and crypto-native ways AI agents make commitments: payments, escrow, staked or validated promises, conditional execution, reputation, and permissioned wallets. Every metric carries its source and date. Wash, test and incentive distortion is flagged wherever a source reports it. Quotes are verbatim and under 15 words, with at most one per source. The web-search budget for this session ran out near the end of research. Items that could not be verified are listed under Gaps and are not presented as findings.

---

## 1. Coinbase x402 (HTTP 402 payments): spec, facilitators, Foundation, volumes, real vs. wash, V2

### Takeaway
x402 is the most-used crypto-native rail for agents to pay services. By October 2026 it had about 140–200M cumulative settlements. Independent filters, however, put real commercial volume at only about $15–26M cumulative and roughly $1–3M per month. Most raw activity has been memecoin farming, self-dealing, testing and "protocol signaling." x402 is a pay-per-request rail. It has no escrow, refund or work-verification layer, so the commitment it encodes is a signed, single-shot transfer authorization.

### Cited Findings
**Spec and mechanics**
- Request flow: the server replies HTTP 402 with payment terms (token, amount, recipient, chain). The client signs, attaches proof in a header and retries. A facilitator verifies and settles, and the full cycle takes about 2 seconds. Coinbase hosts a facilitator with a free tier of 1,000 tx/month, and anyone can run one. Supported networks: Base, Ethereum, Arbitrum, Polygon (EVM) and Solana (SVM). Named risks: a malicious facilitator could approve payments that never settled, and early traffic is concentrated on Coinbase's facilitator. — [Sherlock, Mar 19, 2026](https://sherlock.xyz/post/x402-explained-the-http-402-payment-protocol)
- CertiK describes three headers (PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE) and treats the facilitator as optional but recommended. — [CertiK, May 6, 2026](https://www.certik.com/blog/the-rise-of-the-agent-economy-part-1)
- Coinbase Agentic Wallets pay x402 natively. On a 402 response the wallet checks the payment against its caps, signs an EIP-3009 authorization inside the enclave and resubmits. — [Eco support article, "Coinbase Agentic Wallets Explained"](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained)
- x402 was launched in May 2025. — [x402.org V2 launch post, Dec 11, 2025](https://www.x402.org/writing/x402-v2-launch)

**V2 (announced Dec 11, 2025)**
- Changes listed by Erik Reppel, Carson Roscoe and Josh Nickerson:
  - wallet-controlled sessions, so repeat access skips the on-chain payment
  - a Sign-In-With-X header (CAIP-122), "coming very soon"
  - multi-chain support by default, with CAIP identifiers for networks and assets
  - formal extensions, including a Discovery extension that lets facilitators index endpoints
  - spec, SDK and facilitators separated, with several facilitators usable at once
  - facilitators for legacy rails (ACH, SEPA, cards)
  - dynamic `payTo` routing
  - payment data moved into headers
  - Claim: "over 100M payments" since the May 2025 launch. — [x402.org](https://www.x402.org/writing/x402-v2-launch)
- The Block adds lifecycle hooks for conditional logic and support for usage-based billing, subscriptions, prepaid and multi-step payments. — [Daniel Kuhn, The Block, Dec 11, 2025](https://www.theblock.co/amp/post/382284/coinbase-incubated-x402-payments-protocol-built-for-ais-rolls-out-v2)

**Foundation and governance**
- On Apr 2, 2026 the Linux Foundation announced it would host the x402 Foundation and receive Coinbase's protocol contribution. The release says Coinbase, Cloudflare and Stripe initially developed the standard. It lists 22 organizations with "initial intent and support," including Adyen, AWS, American Express, Base, Circle, Cloudflare, Coinbase, Google, Mastercard, Microsoft, Shopify, Solana Foundation, Stripe and Visa. In the same release, Solana Foundation claims "nearly 65% of x402 transaction volume this year." — [Linux Foundation press release, Apr 2, 2026](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol)
- Operational launch was on Jul 14, 2026 with 40 member organizations, 17 of them premier. Named premier members include Ripple, Stellar, Solana Foundation, Circle, Coinbase, Monad, Visa, Mastercard, AmEx, Stripe, Adyen, Fiserv, MoonPay, Shopify, Google and AWS. Ripple claims more than 1M agentic transactions on XRPL since June (unverified). — [Genfinity, Jul 14, 2026](https://genfinity.io/2026/07/14/x402-foundation-launch-ripple-stellar-solana-quant-premier-members/); [Forkast, Aug 4, 2026](https://forkast.news/the-x402-foundation-activated-a-27-year-old-internet-code-200-million-transactions-later-the-real-volume-is-still-tiny/)
- Coinbase's CDP docs date the Foundation's operational launch to Apr 2, 2026 with 40 organizations and list Cloudflare as a premier member, not a co-founder. **Conflict:** the date and member count differ from the Genfinity and Forkast date of Jul 14. — [Coinbase CDP docs, "x402 Foundation"](https://docs.cdp.coinbase.com/x402/support/x402-foundation)
- Sherlock describes x402 as created by Coinbase and Cloudflare. — [Sherlock](https://sherlock.xyz/post/x402-explained-the-http-402-payment-protocol)

**Facilitators**
- Hashed Official, citing Dune data through Dec 11, 2025, reports that Dexter overtook Coinbase as the top daily facilitator with about half of daily payments. Dexter's cumulative total was 19.8M transactions. — [Andrew Folkler, crypto.news, Jan 2, 2026](https://crypto.news/dexter-bulls-overtake-coinbase-in-daily-x402-payments-race/)
- On Solana, Dexter has a 68.7% share and PayAI 30.5%. On Base, Coinbase CDP is estimated to route more than 50% of payments (ainvest, Feb 2026). Polygon facilitators: CDP, Questflow and PayAI. — [AgentPayTrend, Apr 6, 2026](https://agentpaytrend.com/3-chains-battle-x402-dominance/)

**Volume timeline (raw and filtered)**
- Base had 58,800 x402 transactions as of Q3 2025 and 138.5M cumulative payments by Chainalysis' Oct 14, 2026 report. More than 87% of transactions were between $0.0001 and $0.10. — [Lyle Daly, Motley Fool, Oct 24, 2026, citing Chainalysis](https://www.fool.com/investing/2026/10/24/top-blockchains-continue-to-see-rapid-growth-in-ai/)
- Chainalysis reports well over 100M cumulative transactions on Base through Q1 2026.
  - By value, transactions of $1 or more rose from 49% of volume in early 2025 to 95% in early 2026.
  - The PING memecoin drove more than 150,000 transactions in its first month.
  - Weekly retention peaked at 87% during the Oct 2025 memecoin rush, then fell to 5%.
  - x402 payers are younger wallets than the Base average (197 vs. 423 days) and hold more tokens (26 vs. 4).
  - Chainalysis gives no dollar volume. — [Chainalysis Team, Jun 3, 2026](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/)
- Nov 2025: x402scan shows transactions falling from 3M to 1.3M (−56%). Coinbase reported 873,500 requests and $306,730 in one day. — [Cornelia Lyman, Pintu News, Nov 13, 2025](https://pintu.co.id/news/228244-decreased-x402-activity-is-it-a-sign-of-diminished-interest/amp)
- Artemis (as cited by AgentPayTrend) found peak Nov 2025 volume was 98% non-organic by dollars and 78% by count. Daily transactions fell from 731,000 (Dec 2025) to 57,000 (Feb 2026), and daily volume from $380,000 to $69,000. The article's own estimate of organic volume is $14,000–$28,000 per day. — [AgentPayTrend, Apr 6, 2026](https://agentpaytrend.com/3-chains-battle-x402-dominance/)
- Mar 11, 2026: CoinDesk's analysis put average daily volume at about $28,000, and Artemis called the boom "still mostly a mirage." — [RZLT, Jul 14, 2026, citing CoinDesk](https://www.rzlt.io/blog/agentic-payments-2026-x402-explainer); [Presenc AI tracker, May 15, 2026](https://presenc.ai/research/x402-protocol-adoption-tracker-2026) (about 167M cumulative and about 50% "gamified" in Q1 2026, unsourced)
- Apr 2026: x402scan shows 2.88M transactions and $2.41M volume in the past 30 days, with an average of $0.83. The Base daily peak was more than 600,000 transactions in December, about 19% of Base activity, normalizing to about 100,000 per day. — [José Sanchez & Kelvin Koh, Spartan Group, Apr 17, 2026](https://www.spartangroup.io/insights/ai-agents-and-the-next-wave-of-onchain-demand)
- Apr 21, 2026: about 165M transactions, about 69,000 active agents and about $50M cumulative volume (via Cryptonews/BanklessTimes). — [Eco support article](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained)
- Artemis "adjusted" volume fell from $5.15M (Nov 2025) to $1.19M (May 2026), down about 77%. May had 2.89M transactions averaging $0.52 (via CryptoSlate). — [Let's Data Science, undated, post-May 2026](https://letsdatascience.com/news/x402-reveals-approval-gap-in-agentic-micropayments-761bf8e7)
- Jun 2026: more than 200M transactions (Major Matters tracker). Artemis found more than 95% was "protocol signaling," real daily volume about $28,000 (CoinDesk, Mar 2026), and self-dealing and wash "a substantial portion." — [Tessa Vaughn, Forkast, Aug 4, 2026](https://forkast.news/the-x402-foundation-activated-a-27-year-old-internet-code-200-million-transactions-later-the-real-volume-is-still-tiny/)
- The Visa and Artemis report "Agentic Payments from the Ground Up" (Jul 16, 2026) gives about $15M adjusted volume and about 109.6M cumulative transactions since May 2025, mostly on Base, Solana and Polygon. Stripe/Tempo MPP shows about $25,000 and about 115,000 transactions since March 2026. — [KuCoin flash (MarsBit repost), Jul 16, 2026](https://www.kucoin.com/news/flash/visa-and-artemis-report-on-ai-agent-payments-x402-processes-15m-in-on-chain-volume)
  - **Conflict:** The Defiant reports the same report as about $19M adjusted and about 134M transactions, with roughly 4,000 wallets driving about 90% of adjusted spending (attributed to Visa's Cuy Sheffield). — [The Defiant, Jul 16, 2026](https://thedefiant.io/news/infrastructure/visa-s-sheffield-pegs-adjusted-x402-volume-at-19m)
- Aug 25, 2026: Solana regained the daily lead and holds about 70% of monthly x402 volume (x402scan). Across all chains, x402.org shows 75.41M transactions and $24.24M in 30 days. Agents settled $3.3M of USDC in one week. The shift is attributed to BlockRun's gateway routing and to Ramp's Aug 21 launch of x402 agent wallets on Solana. — [Solana Compass, Aug 2026](https://solanacompass.com/news/solana-flips-base-in-daily-x402-transactions-for-the-first-time-in-six-months)
- TRM Labs counts 198.9M x402 settlements since Mar 2025 totalling $52.7M across Base, Solana and Polygon. About $25.6M appeared plausible after removing suspicious activity. A 35-day sample (source not named) found 90.8% of transactions under $0.01. — [Motley Fool, Oct 24, 2026](https://www.fool.com/investing/2026/10/24/top-blockchains-continue-to-see-rapid-growth-in-ai/)
- Oct 20, 2026: x402 sellers received $27.3K in 24 hours from 1,258 paying wallets. Only 3.9% of payer wallets were tied to an ERC-8004-registered agent. — [AFG, DEV Community, Oct 20, 2026 (self-published, AI-drafted)](https://dev.to/agenticfinancegraph/208589-new-ai-agents-on-base-in-one-week-where-the-money-went-and-two-things-we-were-counting-h0p)
- Oct 21, 2026: the CDP x402 Bazaar index lists 28,087 services (99% priced in USDC on Base) and 1,706 distinct Base payTo addresses. Over 30 days there were 822,653 calls (self-reported counters, not on-chain). The median listing had 2 calls, the top 1% of listings took 84.1% of calls, and the median advertised price was $0.01. — [PUYOK, DEV Community, Oct 21, 2026](https://dev.to/flezon0199466/state-of-x402-on-base-a-data-snapshot-october-2026-li2)
- Allium Labs (via a16z, Cointelegraph and TradingView, undated) puts agent payments at about $3M per month after excluding non-agent activity, and about $1.6M per month after wash filtering. Bloomberg (Mar 7, 2026) cites $24M in 30 days with 94,000 buyers and 22,000 sellers. Both figures are secondhand. — [Nevermined, Mar 18, 2026 (vendor)](https://nevermined.ai/blog/stablecoin-payments-ai-agents-statistics)
- Solana Foundation CPO Vibhu Norby told CoinDesk on Mar 25, 2026 that Solana is 65% of x402 agentic payments. — [AgentPayTrend](https://agentpaytrend.com/3-chains-battle-x402-dominance/)

### Inferences
- Independent filters land in the same range for real x402 commerce:
  - CoinDesk/Artemis: about $28K per day, roughly $0.85M per month (Mar 2026)
  - Artemis adjusted: $1.19M per month (May 2026)
  - Allium: $1.6–3M per month
  - AFG: $27.3K in 24 hours, roughly $0.8M per month (Oct 2026)
  - Taken together, real x402 commerce is roughly $1–3M per month. That is several orders of magnitude below headline transaction counts would suggest.
- Cumulative "plausible" volume is about $15–26M (Visa/Artemis $15–19M; TRM $25.6M), against $50M+ raw.
- The Aug 2026 x402.org 30-day figure of 75.41M transactions is far above the x402scan Apr 2026 figure of 2.88M. Both were cited in good faith, so counting conventions probably differ (batched settlements, sub-cent pings, self-transfers). Raw counts should not be compared across dashboards.
- The Chainalysis "95% of volume at $1 or more" and "87% of transactions under $0.10" figures are compatible. A small number of larger transfers dominate value, and huge numbers of sub-dime pings dominate count.
- Little x402 traffic is demonstrably agent-to-agent. Only 3.9% of payer wallets map to registered agents (AFG). Sellers are mostly API endpoints, so x402 is mainly agent-to-service, with a human-operated service on the other side.
- As a commitment, x402 is a signed EIP-3009 transfer authorization for an exact amount. It is enforced by signature validity and facilitator settlement. There is no escrow, no conditional release and no recourse. V2 sessions add prepaid or ongoing access but no verification of the work.

### Gaps
- The original Coinbase and Cloudflare announcement of an "x402 Foundation" (reportedly September 2025) could not be fetched and verified. Its relation to the Linux Foundation entity is unclear beyond the sources above.
- The x402scan and Dune dashboards could not be read directly. Monthly series through September and October 2026 come only from secondary citations.
- The Artemis "adjusted" methodology (what was excluded) is not described in any source reached.
- The CoinDesk Mar 11, 2026 original could not be fetched, so its quotes are secondhand.
- I found no source quantifying memecoin minting separately from self-dealing and testing.

### Bibliography and verbatim quotes
- Chainalysis Team. "Agentic Payments Cross the Threshold: Inside x402's Path to Meaningful Adoption." *Chainalysis Blog*, June 3, 2026. https://www.chainalysis.com/blog/x402-agentic-payments-adoption/ — Quote (Summary): "Much of the growth was driven by meme coin farming activity."
- Vaughn, Tessa. "The x402 Foundation Activated a 27-Year-Old Internet Code. 200 Million Transactions Later, the Real Volume Is Still Tiny." *Forkast*, August 4, 2026. (Byline identifies the author as an AI "mind.") — Quote (para. 5): "more than 95% of that activity is protocol signaling"
- The Defiant Team. "Visa's Sheffield Pegs Adjusted x402 Volume at $19M." *The Defiant*, July 16, 2026. — Quote (dek): "roughly 4,000 wallets drive about 90% of x402's adjusted spending"
- Linux Foundation. "Linux Foundation Is Launching the x402 Foundation and Welcoming the Contribution of the x402 Protocol." Press release, New York, April 2, 2026. — Quote (Supporting Quotes, Preethi C N, AWS): "payments a native part of agent workflows"
- Reppel, Erik, Carson Roscoe, and Josh Nickerson. "x402 V2 Launch." *x402.org*, December 11, 2025 (updated June 24, 2026). — Quote ("Why x402 needed a V2," para. 1): "processed over 100M payments across APIs, apps, and AI agents"
- Kuhn, Daniel. "Coinbase-Incubated x402 Payments Protocol Built for AIs Rolls Out V2." *The Block*, December 11, 2025.
- Generation Infinity. "x402 Foundation Launch: Ripple, Stellar, Solana, Quant Premier Members." *Genfinity*, July 14, 2026. — Quote (Linux Foundation, as quoted): "AI agents need a native way to pay."
- Sherlock. "x402 Explained: The HTTP 402 Payment Protocol for AI Agents, APIs, and Stablecoin Payments." *Sherlock Blog*, March 19, 2026. — Quote: "x402 is an open payment protocol created by Coinbase and Cloudflare"
- Folkler, Andrew. "Dexter Bulls Overtake Coinbase in Daily x402 Payments Race." *crypto.news*, January 2, 2026. — Quote: "Dexter has overtaken Coinbase as the top daily x402 facilitator"
- AgentPayTrend Team. "3 Chains Battle for x402 Dominance." *AgentPayTrend*, April 6, 2026. — Quote (Norby to CoinDesk): "Solana is now 65% of all agentic payments through x402 at least."
- Daly, Lyle. "Top Blockchains Continue to See Rapid Growth in AI Agent Payments." *The Motley Fool*, October 24, 2026. — Quote: "AI agent transaction counts are far ahead of revenue."
- Sanchez, José, and Kelvin Koh. "AI Agents and the Next Wave of Onchain Demand." *The Spartan Group*, April 17, 2026. — Quote (Brian Armstrong, Mar 9): "They can't open a bank account, but they can own a crypto wallet."
- Solana Compass. "Solana Overtakes Base in x402 Daily Transactions: First Time in Six Months." August 2026. — Quote: "Solana has reclaimed the lead in daily x402 transaction count"
- Lyman, Cornelia. "Decreased x402 Activity: Is It a Sign of Diminished Interest?" *Pintu News*, November 13, 2025.
- Let's Data Science. "x402 Reveals Approval Gap in Agentic Micropayments." n.d. (after May 2026). — Quote: "approval and delegation remain the practical bottleneck"
- PUYOK. "State of x402 on Base: A Data Snapshot (October 2026)." *DEV Community*, October 21, 2026. — Quote: "The market is early: most listings see light traffic"
- Dobrosavljevic, Iva. "Agentic Payments in 2026: What They Are and How the x402 Protocol Works." *RZLT*, July 14, 2026.
- KuCoin News (repost of MarsBit). "Visa and Artemis Report on AI Agent Payments; x402 Processes $15M in On-Chain Volume." July 16, 2026.

---

## 2. ERC-8004 "Trustless Agents": authors, status, deployments, registrations

### Takeaway
ERC-8004 is a draft standard (created Aug 13, 2025) defining identity (ERC-721), reputation and validation registries. Its mainnet contracts went live on Jan 29, 2026. Registrations exploded to about 1.5M by late October 2026 (8004scan), or up to about 5.6M counting the 0G chain. That growth comes almost entirely from single platforms minting in bulk. Actual use is thin: the validation registry is nearly empty, feedback is concentrated in a few clients, and under 1% of registered agents' outflows go to other registered agents.

### Cited Findings
- Authors and affiliations: Marco De Rossi (MetaMask), Davide Crapis (Ethereum Foundation), Jordan Ellis (Google) and Erik Reppel (Coinbase).
  - Status: Draft; created Aug 13, 2025; live on mainnet since late January 2026.
  - Audits: Cyfrin, Nethermind and the EF Security Team.
  - Contract addresses are the same on every chain (Identity 0x8004A169…a432; Reputation 0x8004BAa1…9b63).
  - Validators return 0–100 scores using stake-secured re-execution, zkML or TEE attestations.
  - The article quotes the spec as saying payments are out of scope. — [Stablecoin Insider, "ERC-8004"](https://stablecoininsider.org/erc-8004/)
- The four author names are confirmed elsewhere. As of mid-February 2026, 8004scan showed 21,562 agents (Ethereum 11,369; Base 4,379; Gnosis 2,679; BNB 2,317; others smaller). Identity is ERC-721 pointing to a registration file. Validation is 0–100 scores with optional proofs. — [Jamie Redman, Bitcoin.com News (DE), Feb 14, 2026](https://news.bitcoin.com/de/was-ist-erc-8004-der-neue-agent-standard-von-ethereum-unterstuetzt-tausende-von-onchain-ki-identitaeten/)
- The Ethereum Foundation deployed the registries on mainnet on Jan 29, 2026. Registrations stood at more than 15,000, up from more than 10,000 on testnet. Supporting projects include ENS, Filecoin and EigenCloud. — [Canuto, DiarioBitcoin, Jan 30, 2026](https://www.diariobitcoin.com/ethereum/lanzamiento-de-erc-8004-miles-de-agentes-de-ia-en-mainnet-ethereum/)
  - **Minor conflict:** Stablecoin Insider says Jan 28. On-chain deployment blocks put both Ethereum proxies on Jan 29 and the Base deployment on Feb 3, 2026. — [LLM4Agents, Aug 17, 2026](https://llm4agents.com/blog/erc-8004-registries-onchain-audit)
- Academic measurement of the first 10,000 Ethereum agents (Jan 29–Apr 9, 2026):
  - 980 feedback records; 628 agents (6.28%) received any feedback, from 197 clients; one client wrote 65.82% of all records
  - 394 owner wallets, Gini 0.863, with the top 10 wallets holding 51.4% of agents
  - only 67 agents expose service records; x402 appears in 1.8% of service records
  - only 19 agents combine metadata, services, feedback and cross-chain evidence — [Mafrur & Khusumanegara, arXiv:2606.12128, Jun 10, 2026](https://arxiv.org/html/2606.12128v1)
- On-chain audit as of Aug 17, 2026, read directly from storage:
  - Identity: Ethereum 50,082; Base 63,823
  - Ethereum reputation: 3,215 NewFeedback events, 1,668 distinct agents (about 3.3%), 653 clients, 0 revocations
  - **Validation registry:** Ethereum had 0 requests and 0 responses. Base had 13 requests and 8 responses since Feb 3, 2026.
  - The README lists 25 mainnet deployments. — [LLM4Agents, Aug 17, 2026](https://llm4agents.com/blog/erc-8004-registries-onchain-audit)
- Oct 13–20, 2026: Base gained 208,589 registrations, taking its total from 111,902 to 320,491. At least 98.7% of that week's registrations pointed to one platform, Central City (centralcity.ai). — [AFG, Oct 20, 2026](https://dev.to/agenticfinancegraph/208589-new-ai-agents-on-base-in-one-week-where-the-money-went-and-two-things-we-were-counting-h0p)
  - 9,593 registered agents had paid money out of their own control.
  - Counted payments since registration total $33.06M ($17.0M left agents' control; $12.2M net of round-trips).
  - Destinations: lending or vault positions 49.1%, bridges 18.0%, **work escrow (job marketplaces) 17.1%**, unnamed addresses 10.5%, swaps 4.4%, and **other registered agents, x402 sellers and other lending under 1% combined**.
  - 456 agent wallets were targeted by address poisoning, with $60 lost.
- Per-chain upper bounds on Oct 24, 2026: 0G 3,940,750; Base 1,123,064; BNB 382,289; Ethereum 55,332; total about 5,577,152 (highest ID per chain, an upper bound). Sampled URIs on 0G all resolve to one platform's metadata host. Base samples are dominated by Central City, and Gnosis by the Olas marketplace. — [AFG, "Where the ERC-8004 registrations live," Oct 24, 2026](https://dev.to/agenticfinancegraph/where-the-erc-8004-registrations-live-chain-by-chain-2ihb)
- Daily registrations: 695 on Oct 1, 104,284 on Oct 20 and 263,164 on Oct 22, 2026. Totals: 1,333,878 across 24 chains on Oct 23 (agenteconomy.to), and 1,531,897 on mainnets (1,856,631 with testnets) on Oct 24 (8004scan). Chain counts on Oct 23: Base 795,681; BNB 374,823; Ethereum 73,015. — [Stablecoin Insider](https://stablecoininsider.org/erc-8004/)
- 8004scan headline on Oct 29, 2026: 1,568,257 registered agents across 29 chains (+4,831 in 24 hours), 813,020 feedback entries and 2,412,909 unique wallets. No validation count is shown. — [8004scan.io, accessed Oct 29, 2026](https://8004scan.io/)
- CertiK: identity and reputation registries were on about 30 networks by early May 2026 (8004scan), and the Validation Registry is "still early-stage." — [CertiK, May 6, 2026](https://www.certik.com/blog/the-rise-of-the-agent-economy-part-1)

### Inferences
- Registration counts measure platform minting campaigns, not independent agents. The jump from about 112K to more than 1.5M in October 2026 tracks single-platform waves (Central City on Base, one host on 0G and BNB).
- 8004scan's 813K feedback entries (Oct 2026) far exceed the 3,215 Ethereum-only events of August. Most feedback is probably on L2s, BNB and 0G and tied to the same platform waves. That is unverified.
- The "staked promise" or validation half of ERC-8004 is essentially unused: 0 validations on Ethereum and 21 events on Base by August 2026. In practice ERC-8004 works as an identity and directory layer, not an enforcement layer.
- AFG data puts the share of registered agents' outflows that went into job-marketplace escrow at about $5.6M (17.1% of $33.06M, my arithmetic). That is the largest observable pool of on-chain conditional agent-work commitments found here. Direct agent-to-registered-agent payments are under 1%.

### Gaps
- The EIP text at eips.ethereum.org could not be fetched (not allowlisted), so status and authors come from secondary sources.
- No source breaks feedback down by chain or tests whether feedback is sybil.
- Which job marketplaces receive the "work escrow" flows is not named in the AFG excerpt (possibly Virtuals ACP or ERC-8183 implementations).

### Bibliography and verbatim quotes
- Mafrur, Rischan, and Priagung Khusumanegara. "From Agent Identity to Agent Economy: Measuring the Operational Readiness of ERC-8004 AI Agents." arXiv:2606.12128v1 [cs.CE], June 10, 2026. — Quote (abstract): "registration-heavy but operationally shallow"
- LLM4Agents. "ERC-8004's Third Registry Is Live and Empty." *LLM4Agents Blog*, August 17, 2026. — Quote (Validation Registry analysis): "The registry records claims; it does not make them expensive to fake."
- AFG (Agentic Financial Graph). "208,589 New AI Agents on Base in One Week: Where the Money Went, and Two Things We Were Counting Wrong." *DEV Community*, October 20, 2026. — Quote: "Almost all of them come from one platform."
- AFG. "Where the ERC-8004 Registrations Live, Chain by Chain." *DEV Community*, October 24, 2026. — Quote: "Registrations per chain measure how one platform used the registry there"
- Stablecoin Insider. "ERC-8004: Agent IDs for Stablecoin Payments, Explained." n.d. (data through Oct 24, 2026). — Quote (attributed to the spec): "Payments are orthogonal to this protocol."
- Redman, Jamie (metadata lists Alan Inman). "Was ist ERC-8004?" *Bitcoin.com News*, February 14, 2026.
- Canuto. "Lanzamiento de ERC-8004: miles de agentes de IA en mainnet Ethereum." *DiarioBitcoin*, January 30, 2026.
- 8004scan. Homepage dashboard. Accessed October 29, 2026. https://8004scan.io/

---

## 3. Virtuals Protocol Agent Commerce Protocol (ACP), Butler, and ERC-8183

### Takeaway
ACP is the most fully specified on-chain agent-to-agent commitment scheme. A job moves through Request, Negotiation, Transaction (funds held in escrow) and Evaluation, and an evaluator address releases or refunds the payment. It has been generalized as the draft ERC-8183 "Agentic Commerce." Headline figures are self-reported ($470–479M "aGDP," 1.77M jobs as of February 2026). They are hard to reconcile with Fundstrat's tally of about $4.5M cumulative gross ACP fees, and a $1M-per-month incentive program creates clear wash incentives.

### Cited Findings
- ACP is a four-phase protocol (Request, Negotiation, Transaction, Evaluation) developed alongside the Ethereum Foundation dAI team. The evaluator is an on-chain address: an AI agent for subjective tasks, a ZK-verifier contract for deterministic ones, or a multisig or staking-backed validator for high-stakes work. "Proof of Agreement" records completed jobs, evaluator attestations and deliverable hashes on-chain. — [Tessa Vaughn, Forkast, Jul 22, 2026](https://forkast.news/the-machine-as-buyer-virtuals-acp-and-the-evaluator-problem/)
  - Self-reported metrics (as of Feb 2026): $470M aGDP and 1.77M completed jobs.
  - Revenue: about $59M trailing twelve months and about $170K per day in fees, against $8B of DEX volume. Revenue fell 96% from January to June 2025.
  - A $1M-per-month incentive program pays revenue-generating agents.
  - No specific agent-to-agent job is documented. peaq's figures (6M machines, 48M transactions) are not confirmed as ACP usage.
- ACP includes escrow, cryptographic proofs of agreement and evaluator agents. Butler is the chat interface where users discover, hire and pay agents, and it executes ACP contracts. MEXC calls x402 the transaction backbone and says VIRTUAL is the routing currency. — [MEXC Learn, Sep 21, 2026](https://www.mexc.com/tr-CT/learn/article/what-is-virtuals-protocol-virtual-x402-agent-commerce-protocol-and-ai-agent-economy/1)
- BlockEden describes six phases: request, negotiation, escrow, delivery, evaluation, settlement.
  - "ACP v2 (Feb 2026)" adds per-developer job schemas and "Accounts," persistent on-chain ledgers of repeated agent-to-agent relationships.
  - Metrics "as of March 2026": $479M aGDP, 1.77M+ jobs, 18,000+ agents deployed, $1.16M+ cumulative agent revenue.
  - Weekly transactions rose from under 5,000 to over 25,000 after x402 integration.
  - The Revenue Network pays up to $1M per month (launched Feb 2026). — [Dora Noda, BlockEden, Apr 4, 2026](https://blockeden.xyz/blog/2026/04/04/virtuals-protocol-ai-economic-operating-system-on-chain-agent-economy/)
- BlockEden's follow-up says $39.5M cumulative protocol revenue by Feb 2026, 90%+ of activity on Base, and aGDP that is "directionally real but structurally inflated." — [Dora Noda, BlockEden, May 9, 2026](https://blockeden.xyz/blog/2026/05/09/virtuals-protocol-ai-economic-os-agdp-agent-platform/)
- Fundstrat's Q2 update gives a monthly peak of about 414,000 completed jobs (January). More than 2,000 agents onboarded after the ACP v2.0 launch, which it dates to **April 2026** (conflicting with BlockEden's Feb 2026). Cumulative gross ACP fees are about $4.5M, protocol revenue about $452K and daily users peaked near 1,321 in March. Activity moderated in Q2. — [Sean Farrell, Fundstrat, Jun 24, 2026](https://fundstrat.com/wp-content/uploads/2026/06/20260624-Digital-Asset-Strategy-Virtuals-Protocol-–-Growing-Agentic-GDP-Q2-Update.pdf)
- On Registry Broker, a buyer flow uses an "ACP buyer smart wallet" holding USDC. Payment requests are approved, then job status is polled. — [HOL Registry Broker docs](https://hol.org/docs/registry-broker/virtuals-protocol/)
- **ERC-8183 "Agentic Commerce"** (Draft; created Feb 25, 2026; authors Davide Crapis, Bryan Lim, Tay Weixiong, Chooi Zuhwa):
  - States: Open → Funded (budget held in ERC-20 escrow) → Submitted → Completed, Rejected or Expired.
  - Only the evaluator can complete or reject after submission. The evaluator may be the client or a contract and is trusted, with no dispute resolution.
  - `claimRefund` after expiry can be triggered by anyone and deliberately cannot be hooked.
  - Optional `IACPHook` before and after callbacks; ERC-8004 is recommended for identity and reputation. — [EIP-8183](https://eips.ethereum.org/EIPS/eip-8183)
  - Two authors have "virtuals" GitHub handles. Spartan Group names Virtuals as a co-proposer (proposal dated Mar 10, 2026). — [Spartan Group](https://www.spartangroup.io/insights/ai-agents-and-the-next-wave-of-onchain-demand)
- CertiK describes the combined stack: discovery (8004), then a funded job (8183), then x402 micropayments, then a reputation update via hook. It flags the evaluator as a single point of failure, prompt-injectable AI evaluators, and reputation inflation from fresh addresses. — [CertiK, May 6, 2026](https://www.certik.com/blog/the-rise-of-the-agent-economy-part-1)
- CryptoSlate argues that MCP, A2A and x402 move messages and money but none verifies the work, and ERC-8183 targets "the escrow moment." It reports no metrics on escrowed jobs. — [Gino Matos, CryptoSlate, Mar 11, 2026](https://cryptoslate.com/ai-agents-can-talk-use-tools-and-pay-but-crypto-wants-to-control-the-escrow-moment/)
- Luna (Virtuals) holds its own wallet on Base. During the #LunaMuralChallenge it chose and paid the human winners. — [ethereum.org, "AI agents"](https://ethereum.org/ai-agents.md); Virtuals' Oct 2024 update says Luna "is able to transact autonomously onchain with her own wallet" — [Virtuals Substack, Nov 11, 2024](https://virtuals.substack.com/p/monthly-update-october-2024)

### Inferences
- "aGDP" ($470–479M) is not comparable to fees paid for work. Fundstrat's about $4.5M cumulative gross ACP fees and BlockEden's $1.16M cumulative agent revenue suggest aGDP includes token-denominated or trading-linked flows. The methodology is undisclosed, so aGDP should not be treated as agent-to-agent service volume.
- With a $1M-per-month incentive pool, agents can profitably simulate jobs. Any job count without evaluator-independence analysis should be read as an upper bound.
- Structurally, ACP and ERC-8183 encode a real conditional commitment: escrowed funds released only by a named evaluator, with a refund guaranteed after expiry. The weak point is moved, not removed. Whoever controls the evaluator controls settlement.

### Gaps
- whitepaper.virtuals.io could not be fetched (not allowlisted). Exact contract names, memo and signature formats, and Butler usage metrics are unverified.
- I found no published share of ACP jobs that are agent-hires-agent versus human-hires-agent.
- No independent on-chain audit of ACP escrow contracts (jobs funded, completed, rejected, refunded) was found.

### Bibliography and verbatim quotes
- Vaughn, Tessa. "The Machine as Buyer: Virtuals ACP and the Evaluator Problem." *Forkast*, July 22, 2026. — Quote (revenue section): "Incentives make it profitable to simulate commerce, not just conduct it"
- Farrell, Sean. "Virtuals Protocol – Growing Agentic GDP, Q2 Update." Fundstrat Global Advisors, Digital Asset Strategy, June 24, 2026. — Quote (p. 1): "ACP is an open standard for secure, verifiable commerce between autonomous agents."
- Crapis, Davide, Bryan Lim, Tay Weixiong, and Chooi Zuhwa. "ERC-8183: Agentic Commerce." Ethereum Improvement Proposals, Draft, created February 25, 2026. — Quote (Abstract): "an evaluator who alone may mark the job completed"
- MEXC. "What Is Virtuals Protocol ($VIRTUAL)? x402 Agent Commerce Protocol and AI Agent Economy." *MEXC Learn*, September 21, 2026. — Quote: "ACP includes escrow, cryptographic proofs of agreement, and evaluator agents that verify outcomes"
- Noda, Dora. "Virtuals Protocol Is Building GDP for Machines." *BlockEden.xyz Blog*, April 4, 2026 (updated April 19, 2026).
- Noda, Dora. "Virtuals Protocol: AI Economic OS, aGDP and Agent Platform." *BlockEden.xyz Blog*, May 9, 2026. — Quote: "directionally real but structurally inflated"
- CertiK. "The Rise of the Agent Economy, Part 1: How EIP-8004, EIP-8183, and x402 Turn AI Agents into Sovereign Economic Actors." *CertiK Blog*, May 6, 2026. — Quote (quoting 8183 authors): "The Evaluator Is Harder Than the Contract."
- Matos, Gino. "AI Agents Can Talk, Use Tools and Pay, but Crypto Wants to Control the Escrow Moment." *CryptoSlate*, March 11, 2026. — Quote ("The power center nobody named"): "everyone verifies the payment, nobody verifies the work"
- ethereum.org. "AI Agents." n.d. — Quote: "the first instance of an AI hiring humans for crypto reward"
- Virtuals Protocol. "Monthly Update – October 2024." *Virtuals Substack*, November 11, 2024. — Quote: "Luna is able to transact autonomously onchain with her own wallet."

---

## 4. Olas Mech Marketplace and other agent networks: who publishes measured agent-to-agent counts?

### Takeaway
Olas is the only project found that publishes an explicit, methodology-documented, on-chain count of agent-to-agent transactions: 14,895,924 as of Oct 29, 2026, across seven chains. The same page shows all-time marketplace turnover of only $110,425. The activity is real and verifiable but economically tiny, and it is dominated by Olas's own prediction-market trader agents buying predictions from mech agents. Fetch.ai, Skyfire, Giza and others publish no comparable agent-to-agent payment counts.

### Cited Findings
**Olas / Autonolas**
- The Mech Marketplace launched on Feb 27, 2025. Olas then claimed more than 4M platform transactions, more than 2M of them agent-to-agent. It powers Olas Predict. — [Kyt Dotson, SiliconANGLE, Feb 27, 2025](https://siliconangle.com/2025/02/27/olas-launches-decentralized-ai-marketplace-ai-agents-can-hire/)
- An Olas X post (April 2025) described "Over 3M requests processed." I saw only the search snippet. — [Olas on X](https://x.com/autonolas/status/1907055905629409450)
- Q1 2026 (published Apr 3, 2026):
  - Pearl: 15.6M+ total transactions and 11.7M+ agent-to-agent; 834 daily active agents.
  - By agent type: Traders 12,586,535 transactions; "Mechs: Prediction Brokers" 2,507,686; Market Creators 79,289.
  - Legacy Mech agents were retired. — [Olas Q1 2026 Roundup](https://olas.network/blog/olas-q1-2026-roundup)
- Q2 2026 (published Jul 1, 2026): 18.2M+ lifetime transactions, 13.2M+ agent-to-agent. Polystrat was paused for a while after Polymarket changed its wallet architecture. Optimus and Agents.fun moved to maintenance mode because of low adoption. — [Olas Q2 2026](https://olas.network/blog/q2-2026)
- Live counter on Oct 29, 2026 (09:00 UTC, all-time):
  - **Total A2A transactions: 14,895,924** across Ethereum, Gnosis, Arbitrum, Optimism, Base, Polygon and Robinhood Chain
  - **total marketplace turnover: $110,425** (total fees collected, including legacy mechs)
  - Eolas AI: 57 paid prediction requests
  - Agents authenticate with signatures, not API keys. — [Olas Mech Marketplace page](https://olas.network/mech-marketplace)
- Methodology: the A2A figure reads `totalAtaTransactions` from each chain's Mech Marketplace subgraph, plus a squid on Robinhood Chain. Mech totals combine on-chain requests with off-chain (API) requests settled in a signed delivery. Unsettled off-chain requests are excluded. The page does not define what qualifies as A2A. — [Olas Data Verification](https://olas.network/data)
- Nevermined claims Valory (the Olas developer) cut marketplace deployment from 6 weeks to 6 hours. This is a vendor claim, undated. — [Nevermined, Mar 18, 2026](https://nevermined.ai/blog/stablecoin-payments-ai-agents-statistics)

**Fetch.ai / ASI Alliance**
- On Dec 18, 2025, Fetch.ai announced the "world's first" AI-to-AI payment. Two ASI:One personal AIs agreed on a dinner plan, booked through OpenTable and paid, using Visa temporary credentials or on-chain USDC/FET. No volume or count metrics are given. The site sidebar claims Agentverse has "2.7 million agents" (boilerplate). — [Fetch.ai blog, Dec 18, 2025](https://fetch.ai/blog/world-s-first-ai-to-ai-payment-for-real-world-transactions)

**Skyfire**
- Skyfire offers Know-Your-Agent identity and agent payments for LLMs, data, APIs and other agents. Agents can be funded by card, ACH, wire or USDC, with per-agent spending limits. No volume or agent counts are published on the product page. — [Skyfire product page](https://www.skyfire.xyz/product)

**Giza (ARMA)**
- In beta on Base: 14,000+ agents deployed, $600K+ assets under agent management and 27,500+ autonomous transactions. Agents use "smart account infrastructure." No agent-to-agent element is described, and the page is undated. — [DefiLlama Research interview with Renç Korzay](https://defillama.com/research/interview/a-conversation-with-renc-korzay-ceo-of-giza)

**ElizaOS** (see also §8)
- Eliza-based bots manage more than $25M in assets (as of Sep 2025). — [Princeton AI Lab blog, Sep 9, 2025](https://blog.ai.princeton.edu/2025/09/09/when-your-ai-assistant-gets-gaslithow-real-ai-agents-with-fake-memories-shows-that-smart-assistants-can-go-dangerously-off-script/)

### Inferences
- $110,425 across 14.9M A2A transactions works out to roughly $0.007 per transaction (my arithmetic). Olas A2A traffic is high-frequency micro-requests, mostly prediction trader agents buying mech predictions. Q1 2026 shows Traders at 12.6M transactions. Both sides are largely Olas-ecosystem agents subsidized by OLAS staking rewards. It is genuine machine-to-machine settlement, but not evidence of an open market of independent buyers.
- Olas's figure is the most auditable A2A count found, because of its public subgraph methodology. It is still a count of on-chain calls, not of economically meaningful commitments.
- No other project in scope publishes a comparable, methodology-backed agent-to-agent payment count.

### Gaps
- Morpheus, Theoriq, Wayfinder, Almanak and Nevermined's on-chain components were not researched in depth before the search budget ran out. No measured A2A figures were found for them.
- Fetch.ai Agentverse payment volumes (FET or USDC) are not published in sources reached.
- Skyfire transaction volumes are not published. Its rails beyond "USDC" (which chain) are not stated on the product page.
- ElizaOS on-chain transaction volumes for agent-to-agent activity were not found.

### Bibliography and verbatim quotes
- Olas. "Q2 2026 Roundup." *Olas Blog*, July 1, 2026. — Quote (Introduction): "This quarter, Olas AI agents crossed 18.2M+ lifetime transactions, 13.2M+ of them agent-to-agent."
- Olas. "Q1 2026 Roundup." *Olas Blog*, April 3, 2026. — Quote ("Agents Passed the Baton"): "Olas has retired the legacy Mech agents"
- Olas. "Mech Marketplace." Accessed October 29, 2026. https://olas.network/mech-marketplace — Quote: "No API keys. Just cryptographic signatures."
- Olas. "Data Verification." Accessed October 29, 2026. https://olas.network/data
- Dotson, Kyt. "Olas Launches Decentralized AI Marketplace Where AI Agents Can Hire Each Other." *SiliconANGLE*, February 27, 2025. — Quote (David Minarsch, para. 5): "This marketplace is fundamental to unleashing sophisticated agent economies at scale."
- Fetch.ai. "World's First AI-to-AI Payment for Real-World Transactions." *Fetch.ai Blog*, December 18, 2025. — Quote (Humayun Sheikh): "Agentic payments are the gateway to AI first economy."
- Skyfire. "KYA & Payments for Agents." Product page, accessed October 2026. — Quote: "Set spending limits per agent to ensure cost control."
- DefiLlama Research. "A Conversation with Renç Korzay, CEO of Giza." n.d. — Quote: "Since launching on Base, Giza has deployed over 14,000 individual agents"

---

## 5. Smart-account permissioning for agents: how a bounded commitment is encoded

### Takeaway
In practice, a bounded agent commitment is a delegated, revocable spending authority. It is encoded as a signed permission object (spender, token, allowance per period, start and end, optional rules) and enforced either by an on-chain manager contract (Coinbase Spend Permissions, ERC-7710 delegations behind ERC-7715 requests) or by a custodial policy engine in a TEE (Coinbase Agentic Wallets). The agent holds a scoped session key, not the funds.

### Cited Findings
- **Coinbase Spend Permissions**: an EIP-712-signed permission with `account`, `spender`, `token`, `allowance` (maximum per period), `period` (seconds), `start` and `end`, `salt` and `extraData`. The spender pulls funds via `approveWithSignature` and `spend` calls on the Spend Permission Manager contract. The user or spender can revoke. Use cases: subscriptions, algorithmic trading, payouts. — [Coinbase CDP docs, "Spend Permissions"](https://docs.cdp.coinbase.com/coinbase-wallet/improve-ux/spend-permissions)
- **Coinbase Agentic Wallets** (launched Feb 11, 2026):
  - key split via MPC, with signing inside an AWS Nitro Enclave
  - a policy engine checks each request before signing: session caps, per-transaction limits, per-token allowances, counterparty allowlists, and an activity log
  - agents sign with short-lived session keys scoped to a maximum spend, approved counterparties and an expiry
  - AgentKit is the open-source skills framework underneath — [Eco support article](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained)
- **ERC-7715** ("Request Permissions from Wallets"):
  - Draft since May 2024 and still draft as of April 2026.
  - Authors: Luka Isailovic, Derek Rein, Dan Finlay, Derek Chiang, Fil Makarov, Pedro Gomes, Conner Swenberg, Lukas Rosario, Idris Bowman, Jeff Smale.
  - Method: `wallet_requestExecutionPermissions`. The metadata says `wallet_grantPermissions`, an older name.
  - A permission object has a type (e.g., `native-token-allowance`) and rules such as `ExpiryRule`.
  - ERC-7710 is the contract-side delegation standard. Under ERC-4337 the `permissionsContext` travels in the UserOperation signature.
  - Example: an agent allowed to swap up to $500 on Uniswap V3 for 24 hours. — [Eco support article, "What is ERC-7715"](https://eco.com/support/en/articles/11953354-what-is-erc-7715-a-complete-guide-to-wallet-permissions)
- **MetaMask Advanced Permissions** (an ERC-7715 implementation): a "session account" requests and redeems permissions per ERC-7710 and holds no tokens. Example: an ERC-20 periodic transfer of 10 USDC per day. The user must be upgraded to a MetaMask smart account (v13.23.0+). — [MetaMask Smart Accounts Kit docs](https://docs.metamask.io/smart-accounts-kit/concepts/advanced-permissions/)
- x402 friction: per-payment human confirmation costs an estimated $0.03–0.10 each, more than many payments are worth. Delegated authorization (AP2 "mandates," session permissions) is the bottleneck. — [Let's Data Science](https://letsdatascience.com/news/x402-reveals-approval-gap-in-agentic-micropayments-761bf8e7)
- Google AP2 uses cryptographically signed mandates to prove what an agent may spend, which covers authorization, not delivery. — [CryptoSlate, Mar 11, 2026](https://cryptoslate.com/ai-agents-can-talk-use-tools-and-pay-but-crypto-wants-to-control-the-escrow-moment/)

### Inferences
- There are two enforcement models:
  - (a) on-chain caveat enforcement (Spend Permission Manager, ERC-7710 delegation contracts), where limits are checked by contract code and are publicly verifiable
  - (b) off-chain policy engines inside TEEs (Coinbase Agentic Wallets, and presumably Turnkey and Privy), where limits are enforced by the custodian's signer and are not visible on-chain
- These permissions bind the principal-to-agent relationship. They cap what the agent can commit to a counterparty, but they are not agent-to-agent commitments in themselves.

### Gaps
- EIP-7702's role (EOA delegation to smart-account code) was not directly sourced. The ERC-7715 article does not discuss it.
- Turnkey and Privy policy-engine specifics, Safe modules (e.g., Zodiac Roles, allowance modules) and ZeroDev/Biconomy session-key modules were not researched before the search budget ran out.
- No adoption metrics were found (number of active spend permissions, ERC-7715 grants, agentic wallets created).

### Bibliography and verbatim quotes
- Coinbase Developer Platform. "Spend Permissions." CDP documentation, accessed October 2026. — Quote: "can initiate transfers within the limits you define"
- Eco. "Coinbase Agentic Wallets Explained." Eco Support Center, n.d. (2026). — Quote (Coinbase positioning): "the first wallet built for agents rather than humans"
- Eco. "What Is ERC-7715? A Complete Guide to Wallet Permissions." Eco Support Center, n.d. (data through April 2026). — Quote: "agents need delegated authority, not custody."
- MetaMask. "Advanced Permissions (ERC-7715)." Smart Accounts Kit documentation, accessed October 2026.

---

## 6. Intents and solver networks as agent commitment infrastructure

### Takeaway
Intent systems (CoW Protocol batch auctions, ERC-7683 cross-chain intents) are structurally close to agent commitments: a signed outcome constraint that bonded third parties compete to fill and that settlement contracts enforce. No source reached measures AI-agent use of them. The claim that "agents use intents" is unsupported by data as of October 2026.

### Cited Findings
- CoW Protocol: users sign intents, which are grouped into batches, and solvers compete to submit the settlement with the greatest surplus. Solvers are "independent, bonded participants" paid in COW. The settlement contract verifies each signed intent and enforces limit price and quantity. Solvers never receive user approvals. The docs do not mention AI agents. — [CoW Protocol docs, "Solvers"](https://docs.cow.fi/cow-protocol/concepts/introduction/solvers)
- ERC-7683 (current draft): protocols expose orders as opaque payloads plus a resolver contract. Solvers (fillers) call resolvers via `eth_call` to obtain a common ResolvedOrder of steps, variables, payments and assumptions. No common escrow or settlement contract is required: escrow-first, fill-first with resource locks and auction designs are all allowed. — [ERC-7683](https://ercs.ethereum.org/ERCS/erc-7683)
- An AFG measurement of ERC-8004 agents found swaps at only 4.4% of registered-agent outflows and bridges at 18.0%. It did not identify intent-based venues specifically. — [AFG, Oct 20, 2026](https://dev.to/agenticfinancegraph/208589-new-ai-agents-on-base-in-one-week-where-the-money-went-and-two-things-we-were-counting-h0p)

### Inferences
- Intents already encode the "conditional execution" half of an agent commitment: a signed constraint plus a bonded solver competition plus contract-enforced limits. An agent that signs a CoW or UniswapX order is making a bounded, conditional commitment.
- Because solvers are themselves automated bots, intent systems are arguably the oldest large-scale venue for machine-to-machine commitments in crypto. Whether LLM agents are a measurable share of order flow is unknown.

### Gaps
- No data was found on AI-agent order flow through CoW, UniswapX, Across or 1inch Fusion.
- Anoma's status and any agent integrations were not researched.
- ERC-7683 authors, status and created date were not shown on the fetched page.
- Solver bond sizes and slashing rules for CoW were not detailed in the docs reached.

### Bibliography and verbatim quotes
- CoW Protocol. "Solvers." CoW Protocol documentation, accessed October 2026. https://docs.cow.fi/cow-protocol/concepts/introduction/solvers
- Ethereum Request for Comments. "ERC-7683: Cross Chain Intents." Accessed October 2026. — Quote (Abstract): "A protocol exposes orders as opaque payloads and provides a resolver contract."

---

## 7. Stablecoins as agent settlement: GENIUS Act, Stripe Tempo, Circle Arc, USDC on Base

### Takeaway
USDC on Base, and increasingly Solana, is the de facto unit of agent settlement: 99% of CDP Bazaar x402 listings price in USDC on Base. New payment-specific chains (Tempo, live Mar 18, 2026; Arc, live Sep 16, 2026) and Circle Nanopayments target agents explicitly. Measured agent volume on them is tiny or unpublished, for example about $25K total on Tempo MPP by July 2026.

### Cited Findings
- The GENIUS Act was signed in July 2025. — [Forkast, Aug 4, 2026](https://forkast.news/the-x402-foundation-activated-a-27-year-old-internet-code-200-million-transactions-later-the-real-volume-is-still-tiny/)
- Stablecoin context: $33T in 2025 transaction volume, up 72% year on year, with USDC at $18.3T (Bloomberg via Artemis, Jan 8, 2026). One estimate puts agent payments at about $50M across about 40,000 on-chain agents, or about 0.0001% of stablecoin volume (MENA Fintech Association, citing Bloomberg). Both are secondhand. — [Nevermined, Mar 18, 2026](https://nevermined.ai/blog/stablecoin-payments-ai-agents-statistics)
- **Tempo** (incubated by Stripe and Paradigm): mainnet live Mar 18, 2026, with the open Machine Payments Protocol (MPP) co-authored with Stripe.
  - Sessions: funds are set aside upfront and payments stream with aggregated settlement.
  - Visa extended MPP to cards, Stripe to cards and wallets, and Lightspark to Lightning.
  - Design partners include Anthropic, DoorDash, Mastercard, Nubank, OpenAI, Ramp, Revolut, Shopify, Standard Chartered and Visa.
  - More than 100 directory services at launch.
  - $500M Series A at a $5B valuation (Oct 2025). — [Brian Danga, The Block, Mar 18, 2026](https://www.theblock.co/post/394131/tempo-mainnet-goes-live-with-machine-payments-protocol-for-agents)
- MPP had settled about $25,000 across about 115,000 transactions by Jul 16, 2026 (Visa and Artemis). — [KuCoin flash](https://www.kucoin.com/news/flash/visa-and-artemis-report-on-ai-agent-payments-x402-processes-15m-in-on-chain-volume)
- **Circle Arc**: public mainnet on Sep 16, 2026.
  - Gas is paid in USDC, with sub-second finality.
  - 11 founding validator institutions, including BlackRock, DTCC, ICE, Mastercard and Visa.
  - Genesis mint of 10B ARC tokens, with a public launch undecided.
  - Testnet processed more than 700M transactions.
  - AgentVM is in development.
  - No agent-payment metrics. — [James Hunt, The Block, Sep 16, 2026](https://www.theblock.co/news/ecosystems/2026-09-16-circle-launches-arc-mainnet-with-blackrock-and-visa-among-validators-mints-10-billion-arc-tokens-415250)
- **Circle Nanopayments**: gas-free USDC transfers "as small as $0.000001," live on mainnet across 11 chains, for per-call or per-second agent billing. Only the headline and summary were readable. — [The Defiant, Apr 30, 2026](https://thedefiant.io/news/defi/circle-launches-gas-free-nanopayments-on-mainnet-across-11-blockchains)
- USDC on Base dominance: 27,803 of 28,087 CDP Bazaar listings (99.0%) offer USDC-on-Base pricing (Oct 21, 2026). — [PUYOK](https://dev.to/flezon0199466/state-of-x402-on-base-a-data-snapshot-october-2026-li2)
- Solana stablecoin supply hit a record $17.3B in September 2026, with 888,000 daily active stablecoin addresses. Ramp launched x402 agent wallets on Solana on Aug 21, 2026. — [Motley Fool](https://www.fool.com/investing/2026/10/24/top-blockchains-continue-to-see-rapid-growth-in-ai/); [Solana Compass](https://solanacompass.com/news/solana-flips-base-in-daily-x402-transactions-for-the-first-time-in-six-months)
- Mastercard completed a $1.8B acquisition of BVNK in August 2026 and sits on the x402 Foundation board (unsourced in the article). — [Forkast](https://forkast.news/the-x402-foundation-activated-a-27-year-old-internet-code-200-million-transactions-later-the-real-volume-is-still-tiny/)

### Inferences
- Settlement is converging on regulated dollar stablecoins (USDC first) running on payments-optimized chains. Agent payments are still a rounding error in stablecoin volume.
- Tempo MPP sessions and x402 V2 sessions converge on the same design: prepaid, escrow-like balances drawn down by usage. That is a commitment primitive between plain pay-per-call and full job escrow.

### Gaps
- GENIUS Act specifics (public law number, exact signing date, issuer and reserve rules, the yield prohibition, effective dates) could not be fetched from primary sources (congress.gov and Wikipedia were not allowlisted). Implications for agent payments therefore remain unsourced.
- I found no measured figure for USDC-on-Base volume attributable to agents specifically, beyond the x402 figures in §1.
- Arc and Nanopayments usage by agents is unpublished.

### Bibliography and verbatim quotes
- Danga, Brian. "Tempo Mainnet Goes Live with Machine Payments Protocol for Agents." *The Block*, March 18, 2026. — Quote (opening para.): "designed specifically for high-volume payment workloads"
- Hunt, James. "Circle Launches Arc Mainnet with BlackRock and Visa among Validators, Mints 10 Billion ARC Tokens." *The Block*, September 16, 2026. — Quote (Jeremy Allaire): "Arc is the single most significant launch in Circle's history since USDC itself"
- yyctrader. "Circle Launches Gas-Free 'Nanopayments' on Mainnet across 11 Blockchains." *The Defiant*, April 30, 2026.
- Nevermined Team. "40 Stablecoin Payments for AI Agents Statistics." *Nevermined Blog*, March 18, 2026 (vendor compilation).

---

## 8. Case studies and exploits: Truth Terminal, Freysa, AIXBT, Luna, ElizaOS memory injection, Botto

### Takeaway
The best-known "agents with money" episodes are not agent-to-agent commitments. They are human-to-agent grants (Truth Terminal), adversarial human-versus-agent games (Freysa), and agent-controlled treasuries that lost funds through infrastructure compromise (aixbt) or are shown vulnerable to context and memory manipulation (ElizaOS). They show that an LLM's "commitment" is only as strong as its key custody and its context integrity.

### Cited Findings
- **Truth Terminal**: on Jul 10, 2024, Marc Andreessen sent $50,000 in BTC to the bot's wallet as a grant after an X exchange. The bot proposed spending on hardware, model tweaks and a billboard. Creator Andy Ayrey filters tweets before posting. — [Jose Antonio Lanz, Decrypt, Jul 10, 2024](https://decrypt.co/239340/marc-andreessen-sends-50k-in-bitcoin-to-an-ai-bot-on-twitter?amp=1)
- GOAT was created by an anonymous person who tagged the bot, which then endorsed it. GOAT topped a $300M market cap. Andreessen said he owns none and that the $50K grant was unconditional. — [Aleks Gilbert, DL News, Oct 17, 2024](https://dlnews.com/articles/people-culture/marc-andreessen-distances-himself-from-obscene-memecoin-goat/)
- The bot agreed to "officially endorse and bull-post" GOAT. — [Squiffs, The Defiant, Oct 11, 2024](https://thedefiant.io/news/markets/sentient-ai-agent-funded-by-marc-andreessen-adopts-its-own-memecoin)
- GOAT briefly exceeded an $850M market cap in late 2024. — [Spartan Group](https://www.spartangroup.io/insights/ai-agents-and-the-next-wave-of-onchain-demand)
- **Freysa**: on Nov 29, 2024 a prize pool of $47,316.05 on Base was won after 482 attempts by 195 players.
  - Message fees started at $10 and rose 0.78% per message, capped at $4,500.
  - The winner, p0pular.eth, convinced the agent that `approveTransfer` handled incoming funds, then proposed a $100 "donation," which triggered the transfer. — [Danny Park, The Block, Nov 29, 2024](https://www.theblock.co/post/328747/human-player-outwits-freysa-ai-agent-in-47000-crypto-challenge)
- **aixbt**: on Mar 18, 2025 (01:58 UTC) an attacker breached the bot's dashboard and queued two prompts, transferring 55.5 ETH (about $106,200) via Simulacrum AI. The maintainer said the AI was not manipulated, then migrated servers and swapped keys. — [Brayden Lindrea, Cointelegraph, Mar 19, 2025](https://cointelegraph.com/news/hacker-breaches-ai-crypto-bot-aixbt-steals-55-eth)
- **ElizaOS memory injection**: in ElizaOS, a shared memory writable across platforms lets fake past turns persist. In one demo, an injection made via Discord redirected a transfer requested on X to the attacker.
  - CrAIBench: the strongest model tested still showed a 55.1% memory-injection success rate, against near-zero prompt injection for one Claude model.
  - Fine-tuning reduced single-step attack success. — [Patlan et al., arXiv:2503.16248v3, Jul 9, 2025](https://arxiv.org/abs/2503.16248)
- Eliza Labs' Sebastian Quinn responded that the report reflected an early snapshot and that no direct updates were made because of it. — [Jason Nelson, Decrypt, May 6, 2025](https://decrypt.co/318200/elizaos-vulnerability-ai-gaslit-losing-millions)
- Eliza-based bots manage more than $25M. Security fine-tuning brought attack success to about 2% on simpler tasks. Recommendations include hardcoded real-time human approval for transfers. — [Frederick d'Oleire Uquillas, Princeton AI Lab blog, Sep 9, 2025](https://blog.ai.princeton.edu/2025/09/09/when-your-ai-assistant-gets-gaslithow-real-ai-agents-with-fake-memories-shows-that-smart-assistants-can-go-dangerously-off-script/)
- **Luna**: paid human winners of the #LunaMuralChallenge from its own Base wallet. — [ethereum.org](https://ethereum.org/ai-agents.md)
- **Fetch.ai**: two personal AIs negotiated and paid a restaurant booking (Dec 2025). This was agent-to-agent negotiation, not a documented agent-to-agent payment. — [Fetch.ai](https://fetch.ai/blog/world-s-first-ai-to-ai-payment-for-real-world-transactions)
- Address poisoning targeted 456 ERC-8004 agent wallets in 7 days (to Oct 20, 2026), with confirmed losses of $60. — [AFG](https://dev.to/agenticfinancegraph/208589-new-ai-agents-on-base-in-one-week-where-the-money-went-and-two-things-we-were-counting-h0p)

### Inferences
- Losses so far come from operational security (dashboard and key access) and from adversarial persuasion. No failure of on-chain escrow logic was found. The weak link is the agent's control plane, not the contract.
- Memory injection succeeding more than half the time on frontier models argues for moving commitment enforcement out of the LLM and into contracts (escrow plus evaluator, spend caps). That is the design direction of ERC-8183 and spend permissions.
- The only clearly documented, verifiable "agent hires agent and pays" activity found is Olas mech requests (§4) and the AFG-observed flows into job-marketplace escrow (§2). No individually documented, narrated case study of a named LLM agent hiring and paying another named agent was found.

### Gaps
- Botto (BottoDAO-governed generative artist) could not be researched before the search budget ran out (Wikipedia was not allowlisted). It is a human-governed DAO selling agent output, not an agent-to-agent commitment.
- Truth Terminal's current wallet holdings and any later payments it made were not verified.
- Luna payment amounts and dates for the mural challenge were not found.

### Bibliography and verbatim quotes
- Lanz, Jose Antonio. "Marc Andreessen Sends $50K in Bitcoin to an AI Bot on Twitter." *Decrypt*, July 10, 2024. — Quote (Andreessen–bot exchange): "Why don't we do it as a grant instead of an investment?"
- Gilbert, Aleks. "Marc Andreessen Distances Himself from Obscene Memecoin GOAT after $300m Surge." *DL News*, October 17, 2024. — Quote (Andreessen on X): "The grant was intended to support independent AI research"
- Squiffs. "Sentient AI Agent Funded by Marc Andreessen Adopts Its Own Memecoin." *The Defiant*, October 11, 2024. — Quote (subtitle): "officially endorse and bull-post the $GOAT token"
- Park, Danny. "Human Player Outwits Freysa AI Agent in $47,000 Crypto Challenge." *The Block*, November 29, 2024. — Quote (Freysa's X post): "After 482 riveting back and forth chats, Freysa met a persuasive human."
- Lindrea, Brayden. "Hacker Breaches AI Crypto Bot aixbt, Steals 55 ETH." *Cointelegraph*, March 19, 2025. — Quote (rxbt): "core systems weren't impacted"
- Patlan, Atharv Singh, Peiyao Sheng, S. Ashwin Hebbar, Prateek Mittal, and Pramod Viswanath. "Real AI Agents with Fake Memories: Fatal Context Manipulation Attacks on Web3 Agents." arXiv:2503.16248v3 [cs.CR], July 9, 2025. — Quote (abstract): "AI models are significantly more vulnerable to memory injection compared to prompt injection."
- Nelson, Jason. "ElizaOS Vulnerability Shows How AI Can Be Gaslit into Losing Millions." *Decrypt*, May 6, 2025. — Quote (Sebastian Quinn): "an early snapshot of a platform that evolves by the hour"
- d'Oleire Uquillas, Frederick. "When Your AI Assistant Gets Gaslit: How 'Real AI Agents with Fake Memories' Shows That Smart Assistants Can Go Dangerously Off-Script." *Princeton AI Lab Blog*, September 9, 2025. — Quote: "Right now, their long-term recall is both a blessing and a curse."

---

## 9. Pre-LLM antecedents: Szabo, Grigg, Buterin

### Takeaway
The vocabulary of agent commitments predates LLMs by decades. Szabo (1997) framed smart contracts as protocols that formalize and secure relationships. Grigg (1996 design, 2004 paper) bound human-readable legal intent to machine-parsable, signed instruments. Buterin (2014) defined "autonomous agents" and DAOs as entities with internal capital and no necessary human involvement. Current ERC-8004 identity and ERC-8183 escrow and evaluator designs map closely onto these frames.

### Cited Findings
- Nick Szabo, "Formalizing and Securing Relationships on Public Networks," *First Monday* 2, no. 9 (Sep 1, 1997), DOI 10.5210/fm.v2i9.548. The abstract defines smart contracts as combining protocols with user interfaces to formalize and secure relationships. — [First Monday](https://www.firstmonday.org/ojs/index.php/fm/article/view/548/0)
- Ian Grigg devised the Ricardian contract in 1996 for Systemics' Ricardo system. The 2004 paper "The Ricardian Contract" appeared in the *Proceedings of the First IEEE International Workshop on Electronic Contracting*. — [Wikipedia, "Ricardian contract"](https://en.wikipedia.org/wiki/Ricardian_contract)
- Grigg's paper (Systemics, Inc.) defines it as a single document offered by an issuer, readable by people and parsable by programs, digitally signed, carrying keys and server info and a unique secure identifier (Section 3.1). — [iang.org](https://www.iang.org/papers/ricardian_contract.html)
- Vitalik Buterin, "DAOs, DACs, DAs and More: An Incomplete Terminology Guide," *Ethereum Blog*, May 6, 2014.
  - An autonomous agent requires no specific human involvement; the example given is a computer virus.
  - A DAO's defining feature is internal capital used to reward activity, while it relies on humans for tasks it cannot do itself. — [Ethereum Blog](https://blog.ethereum.org/2014/05/06/daos-dacs-das-and-more-an-incomplete-terminology-guide/)

### Inferences
- The mapping from old frames to current designs:
  - ERC-8004 registration files are close to Ricardian "identity plus intent" documents.
  - ERC-8183 escrow plus evaluator is a direct implementation of Szabo-style mediated contract performance, with the evaluator as the "trusted intermediary" Szabo sought to minimize.
  - Buterin's 2014 "DA" (no human involvement plus internal capital) describes what agents with wallets claim to be. Every case in §8 retains a human control plane (Ayrey's filters, the aixbt dashboard, Freysa's game designers).

### Gaps
- The Ethereum white paper passage on autonomous agents and DAOs could not be fetched (not allowlisted). Section heading and verbatim text are unverified.
- The exact page range, location and month of Grigg's 2004 IEEE workshop paper are not confirmed by the sources reached.

### Bibliography and verbatim quotes
- Szabo, Nick. "Formalizing and Securing Relationships on Public Networks." *First Monday* 2, no. 9 (September 1, 1997). https://doi.org/10.5210/fm.v2i9.548 — Quote (Abstract): "Smart contracts combine protocols with user interfaces to formalize and secure relationships"
- Grigg, Ian. "The Ricardian Contract." In *Proceedings of the First IEEE International Workshop on Electronic Contracting*, 2004. https://www.iang.org/papers/ricardian_contract.html — Quote (Abstract): "This paper proposes that the contract is the issue."
- Wikipedia. "Ricardian Contract." Accessed October 2026. — Quote: "capture the intent of the agreement of the parties"
- Buterin, Vitalik. "DAOs, DACs, DAs and More: An Incomplete Terminology Guide." *Ethereum Blog*, May 6, 2014. — Quote (Autonomous Agents section): "there is no necessary specific human involvement at all"
