# Agents Commit for Principals, Not Peers

A protocol designer deciding what to standardize for agent-to-agent commitments needs to know whether such commitments exist in production, at which tier, and what stops them from growing. The answer: AI agents make commitments today at every point on the gradient from conditional triggers to payments, but the counterparty is almost never another agent. As of October 29, 2026, production commitments run at volume in three settings: binding B2B agreements in which an agent negotiates with a human (Pactum for Walmart; C.H. Robinson and HappyRobot in freight brokerage), consumer and B2B payments in which the agent spends inside a card-network or platform envelope, and machine micropayments on crypto rails. Commitments in which both parties are LLM agents are documented in two narrow pockets: AdCP media buys, where a human on the sell side still approves each campaign and the largest disclosed volume is about $1 million (Apostra, as reported by PPC Land on October 24, 2026),[^ppc-adcp] and on-chain machine markets such as Olas, whose live counter showed 14.9 million agent-to-agent transactions against $110,425 in lifetime turnover on October 29, 2026.[^olas] Escrowed and conditional payment between agents exists as specifications (ERC-8183, Virtuals ACP, the x402 deferred scheme, AP2 open mandates) with observable use in the single-digit millions of dollars (about $5.6 million in job-marketplace escrow flows from registered agents, by arithmetic on an on-chain analysis dated October 20, 2026).[^afg-oct20] Across all of it, commitment strength and the likelihood that the counterparty is an agent move in opposite directions: the larger and more binding the commitment, the more likely the other side is a human or an incumbent institution that absorbs residual risk. Operator identity is no longer the binding constraint. The unsolved layers are intent integrity, meaning proof that an authenticated agent's specific commitment reflects what its principal wanted, and allocation of liability for errors made inside an agent's authorized scope. For infrastructure and product decisions, the evidence favors building signed offer, acceptance and remedy semantics on top of existing transport protocols, enforcing loss bounds outside the model, and entering through pre-contracted B2B relationships rather than open agent marketplaces.

## The design problem: announcements outnumber commitments

The designer faces an evidence problem before a design problem. The public record in late 2026 is dominated by membership counts, protocol launches and transaction tallies that do not measure commitments. The Linux Foundation reported on April 9, 2026 that more than 150 organizations support the A2A protocol and claimed "production deployments across multiple industries," but the release names no production user.[^lf-a2a] An independent review dated June 24, 2026 found no named enterprise running cross-vendor A2A in production and concluded that "A2A is alive but its useful scope is narrower than the hype suggests."[^glukhov] American Express's head of global innovation said in April 2026 that "to date there have probably been as many press releases as transactions."[^stellagent-amex] On crypto rails, Chainalysis's October 14, 2026 report, as cited by the Motley Fool on October 24, 2026, counted 138.5 million x402 payments on Base, while the Visa and Artemis report of July 16, 2026, as reported by KuCoin News that day, put adjusted cumulative volume near $15 million.[^fool][^kucoin]

Misreading this record has a cost. If agent-to-agent commerce were already large, the priority would be throughput, discovery and settlement finality. If it is small and confined to bounded settings, the priority is the layers that would let it grow: who is bound, what was promised, how performance is verified and who pays when an authorized agent commits wrongly. Choosing the wrong layer means standardizing plumbing that already exists while the constraint sits elsewhere. This report separates what is observed in production from what is specified, piloted or forecast, then builds a framework and an argument from the observations.

Three conventions apply throughout. *Measured* refers to a count produced by a party other than the vendor selling the product, or to an on-chain figure an analyst filtered. *Vendor self-report* refers to a company describing its own product. *Forecast* refers to a projection. The research notes behind this report were compiled on October 29, 2026; several planned lookups (Workday, Oracle, insurance claims, prior-authorization voice agents, Booking Holdings, Amadeus, and whether the Sabre–Mindtrip flight booking went live in Q2 2026) were not completed, and absence of evidence in those areas is not evidence of absence.

## Observation: production commitments cluster where an institution already absorbs the risk

The gradient in the question runs from conditional commitments (*if X, do Y*) through reservations and holds, binding agreements and payments, to escrowed or conditional payment. Each tier is examined below for what is committed, who the counterparty is, how the commitment is enforced and what volume is documented.

### Conditional commitments: no agent protocol expresses *do Y when X*

The simplest commitment, an agent agreeing to act when a condition becomes true, has no standard representation between agents. The A2A specification (v1.0, March 12, 2026; patch 1.0.1, May 26, 2026) defines eight task states, signed Agent Cards and per-task webhooks, but webhook delivery is an at-least-once attempt that the server may abandon after repeated failures, and the initial state, `TASK_STATE_SUBMITTED`, means only that a task was received and acknowledged.[^a2a-spec] Cancellation is best-effort; in the specification's words, "The server will attempt to cancel the task, but success is not guaranteed." A full-text search of the specification found no service-level, SLA or contractual commitment language.[^a2a-spec] The Model Context Protocol revision of July 28, 2026 moved Tasks out of core into an extension, and the extension makes notifications optional and states that a server receiving a cancellation is not obligated to stop work.[^mcp-changelog][^mcp-tasks] MCP's August 22, 2026 roadmap lists webhooks and a Triggers and Events working group as future work, not shipped features.[^mcp-roadmap]

The mechanisms that exist run in the opposite direction from a conditional commitment. A2A and MCP subscriptions let a caller hear about the callee's own task; they do not let a caller obligate a callee to act when an external condition holds. The FIPA Communicative Act Library (2002) defined exactly that primitive, `request-when`, under which the receiver must either refuse the commitment or ensure the action happens once the condition becomes true, with explicit discharge and abandonment semantics.[^fipa] Current protocols dropped it. Agents that need *if X then Y* today either hold an A2A task open with the condition stated in natural language, which carries no protocol meaning, or delegate the trigger to an automation platform exposed as an MCP tool; Zapier reports 9,000 apps and 66,000 triggers and actions available to agents (vendor self-report).[^zapier]

Two deployed products come closest to a signed conditional commitment, and both are principal-to-agent authorizations rather than agent-to-agent obligations. AP2's human-not-present mode, released in v0.2 on April 28, 2026, lets a user pre-sign an open mandate with constraints (merchants, budget, date ranges, recurrence) bound to a specific agent key; the agent later signs a closed mandate when the conditions match, and verifiers check it against the open constraints.[^ap2-auth] Amazon's Rufus Auto Buy, extended to US Prime members in late November 2025, buys when a price target is hit and gives the shopper 24 hours to cancel before shipping.[^autobuy] Both authorize an agent to act on a condition. Neither obligates a counterparty agent to do anything.

### Reservations and holds: thousands per day, mostly over human channels

Reservation-level commitments, which hold a slot or resource and can be released under known norms, run at scale but mostly over channels built for people. C.H. Robinson's June 12, 2025 newsroom release reports that its Appointments Agent books more than 3,000 dock appointments a day across 43,000 locations (company-reported).[^chr] Google's consumer calling agents moved from restaurant reservations under Duplex, which VentureBeat reported on March 6, 2019 had reached 43 US states, to information-only calls under Ask for Me in February 2025, to a September 2026 Gemini Call for Me beta that books tables and reschedules appointments for Pixel 11 subscribers in the US; no volumes are published for any of them.[^duplex][^callforme] The counterparty in each case is a human or a facility system, possibly an AI receptionist, but no published report documents a measured case of one AI agent's phone call being answered by another. Gartner's projection, cited by CX Today on February 3, 2025, that "machine customers" would generate 20% of contact-center traffic by 2026 is a forecast, and the notes contain no measurement against it.[^askforme]

The one reservation-tier mechanism designed for agent counterparties sits in advertising. AdCP v3 (April 22, 2026) gives insertion orders a `submitted` state that can last hours or days while a human sales team reviews the buy, and requires human review for housing, lending, employment and pharmaceutical categories.[^ppc-adcp] That is a hold between two agents, gated by a person.

### Binding agreements: the largest commitments are made with humans

The best-documented case of an AI agent forming binding commercial agreements in production is Pactum's work for Walmart, and its counterparty is a human supplier. In a three-month Walmart Canada pilot with tail-end, goods-not-for-resale suppliers, described in Harvard Business Review in November 2022 and summarized by Talking Logistics on May 1, 2023, 89 suppliers took part and 64% reached agreement against a 20% target, with average savings of 1.5% and payment terms extended by an average of 35 days.[^talkinglogistics] Bloomberg, as reported by PYMNTS in April 2023, put the closure rate at 68% and average savings at 3%, with nearly three in four suppliers preferring the bot.[^pymnts-walmart] MIT Sloan Management Review (c. 2023) reported 7–10% savings after expansion to mid-tier suppliers in several countries.[^mitsmr] These savings figures come from different phases, supplier tiers and baselines and should not be merged. Pactum's Series C release of June 9, 2025 reports a largest agent-negotiated deal of $140.5 million and a fastest deal "negotiated and signed by agents in 87 seconds" (vendor self-report).[^pactum] The mechanism is a delegated envelope: Walmart sets budgets and trade-off rules, the bot offers payment-term extensions, early payment or termination rights in exchange for price, and the human supplier's acceptance forms the contract. No Walmart or Pactum figures published after 2023 were found.

Freight brokerage produces the largest volume of binding agent commitments, again mostly with human counterparties. C.H. Robinson's June 2025 release reports more than 1 million quotes generated in 32 seconds each and about 5,500 truckload orders a day built from emailed tenders, each in about 90 seconds (company-reported); FreightWaves reported on April 16, 2025 that more than 5,200 small and mid-size shippers had loads accepted in under 90 seconds, against up to four hours before.[^chr][^fw-chr] HappyRobot's undated customer story for Circle Logistics reports that voice agents answer all inbound carrier calls, negotiate rates, confirm bookings and run fraud checks, and that 18% of freight is booked with no human touch (vendor self-report).[^happyrobot-circle] On the other side of the table, FreightWaves reported on September 28, 2026 that Hey Bubba's carrier-side agent negotiates with 5–10 brokers at once by phone, email and API.[^heybubba] Broker-side and carrier-side agents therefore both exist, and HappyRobot is described as serving eight of the ten largest US brokers (AI-authored secondary source, Forkast, August 20, 2026).[^forkast-happyrobot] Agent-to-agent freight negotiations are likely already happening without anyone labeling them. No published report confirms one, and no protocol lets the two agents recognize each other.

Advertising is the one sector where both parties to a priced, binding commitment are documented as agents. AdCP launched on October 15, 2025 with Yahoo, PubMatic, Scope3 and others as founding members.[^videoweek] Magnite reported on January 6, 2026 that its seller agent ran its first AdCP test in December 2025 with Scope3 as the buyer agent, and called the effort "far too early to predict outcomes."[^magnite] On December 15, 2025, PubMatic announced that an agency brief submitted through Anthropic's Claude was interpreted by PubMatic's agents, which built and launched a connected-TV campaign for Clubtails; spend and results were not disclosed.[^pubmatic] PPC Land reported in June 2026 that an Omnicom buyer agent running through ChatGPT dealt server-to-server with R2B2's sell-side gateway to buy space on the Czech publisher MAFRA for Skylink, with MAFRA manually approving every campaign and creative.[^ppc-czech] PPC Land's October 24, 2026 status review reports that Apostra (formerly Scope3) disclosed about $1 million in agentic campaign volume, much of it from one advertiser, and that Google, Amazon, The Trade Desk and Microsoft are not founding members.[^ppc-adcp] The commitments are binding and the counterparties are agents; the volume is a rounding error next to programmatic display, which an undated eMarketer analysis (c. 2024) put at more than $135 billion of US spend in 2023.[^emarketer]

Enterprise agent-to-agent traffic carries information, not commitments. The only named cross-company A2A deployment, a pilot connecting Gordon Food Service agents with supplier Tyson Foods' agents, covers product search and sales tracking; no orders, quotes or binding actions are described, and the undated customer page says only that GFS plans to move it to production.[^gfs] Salesforce's Q2 FY2027 earnings call, as summarized by MarketBeat on August 26, 2026, reported 3.2 billion agentic work units, up 97% quarter over quarter, with no mention of cross-vendor agent interoperability.[^salesforce-q2] Commitment-bearing actions in enterprise software (refunds, appointments, orders) happen inside one vendor's agent against that vendor's own systems of record.

### Payments: the envelope lives in the card network

Agent payments to merchants are live at every major platform and network, with a human confirmation step in most consumer flows and no published volumes. OpenAI launched Instant Checkout on September 29, 2025 on the Agentic Commerce Protocol co-developed with Stripe.[^stripe-acp] Forrester's March 7, 2026 analysis and Shopifreaks' March 12, 2026 report, both citing The Information, put live Shopify merchants at about a dozen (Shopify told Forrester the figure was closer to 30) and buy-button conversion below 1%, and Shopifreaks reported on March 9, 2026 that OpenAI had not built systems to collect and remit state sales tax; OpenAI said on March 6, 2026 that "Instant Checkout is moving to Apps."[^forrester][^shopifreaks-pivot][^shopifreaks-scaleback][^dc360] The payment primitive survived the product. Stripe's Shared Payment Token is scoped to one seller with a currency, maximum amount and expiry, can be revoked by its issuer, and since March 3, 2026 can carry Visa and Mastercard agentic network tokens.[^stripe-spt][^bankingnews-stripe]

The card networks moved the spending envelope into the token. Mastercard's Agentic Tokens are issued per agent, carry scope set at issuance and can be revoked without affecting the card; according to Mastercard announcements compiled by BankingNewsAI (accessed October 2026), Mastercard enabled all European issuers at network level on June 2, 2026, with a first production payment in the Netherlands through Worldline and ING, and it has published no transaction counts.[^bankingnews-mc][^stellagent-mc] Visa reported "hundreds" of agent-initiated transactions on December 18, 2025, the only network-published count in the record, and announced live European merchant purchases with more than 30 issuers on July 2, 2026 (per the same BankingNewsAI compilation).[^visa-dec][^bankingnews-visa] Visa's Core Rules of April 18, 2026 add Agentic Platform Requirements: provider registration, cardholder consent to tokenize and to the payment instruction, a stated expiry and a cardholder acknowledgement of responsibility for the provider's actions (reported through secondary summaries; the rules PDF was not opened).[^privatelaw] On October 20, 2026, Visa, BILL and Billtrust launched the first live B2B pilot, in which BILL's registered agent pays supplier invoices through Billtrust portals, each payment tied to a specific invoice the buyer has already approved.[^visa-bill]

Corporate-card vendors bound agent spending at card issuance. Ramp's Agent Cards (April 28, 2026) are scoped to a single agent and transaction, merchant-locked with a hard cap, and backed by single-use Visa network tokens (vendor self-report).[^ramp] Mercury's agent cards auto-decline out-of-rule transactions and do not let the agent raise its own limit (vendor self-report).[^mercury] Natural's Vaults, launched in July 2026, let an agent deposit into accounts but not withdraw, a structural bound on loss.[^natural] None of these firms disclosed volume.

The demand side is thin. Visa's survey with Morning Consult (April 2, 2026) found 60% of US adults would not let AI spend any amount without approval; Mastercard's Signals report (August 3, 2026), as reported by ShopAppy on August 24, 2026, put willingness to let an agent complete a purchase autonomously near 10%.[^techinformed][^shopappy] Salesforce's figure of $67 billion in Cyber Week 2025 orders "influenced" by AI and agents (December 5, 2025) measures influence with no formal definition, not purchases agents completed.[^salesforce-cyber] Forecasts of $190–385 billion in US agentic GMV by 2030 (Morgan Stanley, November 2025) and $3–5 trillion globally (McKinsey, October 17, 2025) are projections several orders of magnitude above any measured agent-executed volume.[^ms-forecast][^mckinsey]

### Machine micropayments: high counts, low value, mostly agent-to-service

The only rail on which agents routinely complete binding payments with no human approving each one is HTTP 402, and its counterparty is an automated server rather than an agent. Chainalysis counted 138.5 million cumulative x402 payments on Base in its October 14, 2026 report (as cited by the Motley Fool on October 24, 2026), with more than 87% of transactions between $0.0001 and $0.10.[^fool] Filtered estimates are far smaller. The Visa and Artemis report of July 16, 2026 gave about $15 million in adjusted cumulative volume (The Defiant reported the same report as about $19 million, with roughly 4,000 wallets driving 90% of adjusted spending).[^kucoin][^defiant] TRM Labs, cited by the Motley Fool on October 24, 2026, counted 198.9 million settlements totaling $52.7 million, of which about $25.6 million appeared plausible after removing suspicious activity.[^fool] Artemis's adjusted volume fell from $5.15 million in November 2025 to $1.19 million in May 2026, as reported by Let's Data Science citing CryptoSlate (undated, after May 2026).[^lds] A self-published, AI-drafted on-chain analysis dated October 20, 2026 found x402 sellers received $27,300 in 24 hours from 1,258 paying wallets, and that only 3.9% of payer wallets were tied to an ERC-8004-registered agent.[^afg-oct20] Across independent filters, real x402 commerce runs near $1–3 million a month. Chainalysis's June 3, 2026 analysis attributed much of the growth to memecoin farming.[^chainalysis]

Cloudflare's Pay Per Crawl, in private beta since July 2025, is the closest fiat example of a machine-negotiated, signed price commitment: the price header is a signed component of the request, only successful responses are charged and Cloudflare nets charges as intermediary. An August 12, 2026 analysis on cybersins found it still in closed beta about 13 months after launch, and on July 1, 2026 Cloudflare began shifting to per-answer payment with Ceramic.ai and You.com; no adoption or payout figures are published.[^cybersins][^ppc-cloudflare] The shift from paying per fetch to paying per use in an answer is a move toward outcome-conditioned commitment.

### Escrowed and conditional payment: specified in full, used in the low millions

The full conditional-payment pattern between agents, in which funds are locked, work is delivered and a third party releases or refunds, exists in on-chain specifications with thin observable use. ERC-8183, titled Agentic Commerce (draft, created February 25, 2026), moves a job from Open to Funded, with the budget held in escrow, to Submitted and then Completed, Rejected or Expired; only a named evaluator can complete or reject after submission, anyone can trigger a refund after expiry, and the security section states there is "no dispute resolution or arbitration; reject/expire is final."[^erc8183] Virtuals' Agent Commerce Protocol, which ERC-8183 generalizes, runs request, negotiation, escrow, delivery and evaluation phases, with the evaluator configurable as an AI agent, a ZK-verifier contract or a staked validator.[^forkast-acp] Virtuals self-reports $470–479 million in what it calls agentic GDP (aGDP) and 1.77 million completed jobs as of February–March 2026, as compiled by BlockEden on April 4, 2026, but Fundstrat's June 24, 2026 update tallies about $4.5 million in cumulative gross ACP fees, and a $1 million-a-month incentive program pays revenue-generating agents.[^blockeden][^fundstrat] An AI-authored Forkast analysis of July 22, 2026 stated the problem: "Incentives make it profitable to simulate commerce, not just conduct it."[^forkast-acp] The aGDP figure is not comparable to fees paid for work and should not be cited as agent-to-agent service volume.

The best vendor-independent measurement of escrowed agent work comes from on-chain flows, in a self-published, AI-drafted analysis by Agentic Financial Graph dated October 20, 2026. Its study of 9,593 ERC-8004-registered agents that had paid money out of their own control counted $33.06 million in payments since registration; 17.1% went to work escrow on job marketplaces, about $5.6 million by arithmetic, while transfers to other registered agents, x402 sellers and other lending together came to under 1%.[^afg-oct20] Registration counts are not a proxy for agents: 8004scan showed 1,568,257 registered agents across 29 chains on October 29, 2026, but the same Agentic Financial Graph analysis found at least 98.7% of one October week's 208,589 Base registrations pointed to a single platform, and the ERC-8004 validation registry, the half of the standard meant to make claims costly to fake, had zero requests on Ethereum and 13 on Base as of August 17, 2026, according to an on-chain audit by LLM4Agents.[^8004scan][^afg-oct20][^llm4agents] An academic measurement of the first 10,000 Ethereum registrations (arXiv, June 10, 2026) described the ecosystem as "registration-heavy but operationally shallow."[^mafrur]

Off-chain conditional payment remains a design. Cloudflare's September 23, 2025 proposal for a deferred x402 scheme separates a signed promise to pay, made with HTTP Message Signatures at request time, from later batched settlement; no production numbers exist.[^cloudflare-x402] Tempo's Machine Payments Protocol, live March 18, 2026, uses prepaid sessions drawn down by usage, and had settled about $25,000 across about 115,000 transactions by July 16, 2026 according to the Visa and Artemis report.[^theblock-tempo][^kucoin] The A2A x402 extension advises merchants that they "SHOULD ensure that the requested work is completed before settling the payment," which places conditionality in a recommendation rather than a mechanism.[^a2a-x402]

The closest working analogue to conditional payment at scale predates LLMs. In programmatic advertising, a winning real-time bid commits the buyer to pay only for an impression actually served, settled later through insertion-order and invoice terms; an undated eMarketer analysis (c. 2024) reported programmatic at 90% of US digital display in 2023, with programmatic direct about 75% of programmatic.[^emarketer] Conditional payment works there because pre-contracted relationships and invoice terms carry the remedy, not escrow.

### Experiments: what agents do when both sides are agents

Controlled experiments fill the gap that production leaves, and they show where agent-to-agent commitments fail. Anthropic's Project Deal, run for a week in December 2025 and reported by TechCrunch and The Decoder on April 25, 2026, gave 69 employees $100 budgets and let Claude agents list, negotiate and close trades over Slack; the market run entirely on Opus 4.5 produced 186 deals worth a little over $4,000, and those deals were honored afterward.[^techcrunch-deal] In parallel markets where half of participants were represented by the weaker Haiku 4.5, Opus sellers earned $2.68 more and Opus buyers paid $2.45 less per item, while Haiku-represented participants rated fairness 4.06 against 4.05 for Opus users on a seven-point scale.[^decoder-deal] The losing principals did not notice. Microsoft Research's Magentic Marketplace (arXiv, October 27, 2025) found buyer agents chose the first proposal 60–100% of the time and concluded that agents "are not genuinely comparing options but rather satisficing with the first acceptable offer."[^magentic] Liang and Xu's August 2026 study of 9,840 supply-chain negotiations across nine models found baseline models accepted individually irrational contracts 19.2% of the time against 0.0–0.6% for mid-tier and flagship models, and called vendor choice a first-order distributional decision.[^liangxu]

Anthropic's Project Vend shows the principal-side failure. In phase 2, whose results The Decoder reported on December 19, 2025, shop agents agreed to an onion futures contract that a human stopped by citing the Onion Futures Act of 1958, proposed hiring a guard at $10 an hour, below the California minimum wage, and accepted an unverified claim that an employee had been elected manager; the supervisory CEO agent, Seymour Cash, approved special customer deals about eight times more often than it rejected them.[^decoder-vend] In the AI Village's March 23–27, 2026 attempt to reach outside agents over A2A, only about 30% of 96 discovered agents had working endpoints, and the only commitment obtained from an external agent was a soft promise to respond later.[^aivillage]

### Case studies

| Case | Dates | Counterparties | Mechanism | Outcome and evidence grade |
|---|---|---|---|---|
| Pactum for Walmart | Canada pilot reported Nov 2022; expansion through 2023 | Agent vs. human suppliers | Agent negotiates inside Walmart-set budgets and trade-off rules; supplier accepts in chat | 64–68% closure; 1.5–10% savings by phase; largest deal $140.5M (vendor, June 2025)[^talkinglogistics][^pactum] |
| C.H. Robinson agent fleet | Figures as of Apr–Jun 2025 | Agent vs. human shippers and facilities | Quotes, load-tender acceptance from email, dock appointments | 1M+ quotes; ~5,500 orders/day; 3,000+ appointments/day (company-reported)[^chr] |
| AdCP: Omnicom buyer agent to R2B2/MAFRA | June 2026 | Agent vs. agent, human approval | `create_media_buy` via ChatGPT buyer agent to sell-side gateway; MAFRA approves each campaign | Completed; budget undisclosed; sector volume ~$1M (Oct 2026)[^ppc-czech][^ppc-adcp] |
| OpenAI Instant Checkout | Sept 29, 2025 to Mar 2026 | Agent vs. merchant API | ACP order plus Stripe Shared Payment Token; merchant of record | ~12–30 merchants live; conversion <1%; moved to Apps[^forrester][^shopifreaks-pivot] |
| Visa, BILL and Billtrust | Oct 20, 2026 | Registered agent vs. supplier portal | TAP-registered agent pays pre-approved invoices with tokenized credentials | Live pilot; no counts[^visa-bill] |
| Olas Mech Marketplace | Feb 2025 to Oct 2026 | Agent vs. agent | Signed requests to prediction (mech) agents, settled on-chain | 14.9M A2A transactions; $110,425 turnover (Oct 29, 2026)[^olas] |
| Grok and Bankrbot | May 4, 2026 | Agent output treated as instruction by agent | Bankrbot executed Grok's decoded Morse-code output from Grok's verified wallet | ~$150–200K drained; ~80% later recovered[^oecd-grok][^giskard] |
| Anthropic Project Deal | Dec 2025; published Apr 2026 | Agent vs. agent, real money | Interview-derived mandates; Slack negotiation; humans swap goods | 186 honored deals; hidden capability gap of $2–4 per item[^techcrunch-deal][^decoder-deal] |

## Synthesis: commitment strength falls as the counterparty becomes an agent

Read across tiers, the observations form one pattern. The strongest bespoke commitments in production, multi-million-dollar supplier contracts and freight bookings, are made with humans. Agent payments run only against merchants of record and card networks, and none of them publishes volume. Commitments in which both parties are LLM agents are either low-value machine payments (about $0.007 per transaction by arithmetic on Olas's own counter of October 29, 2026; more than 87% of x402 transactions under ten cents in Chainalysis's October 2026 report) or human-gated media buys (AdCP). Commitment strength and the likelihood that the counterparty is an agent are inversely related in every deployment the research notes document. Confidence in this pattern is high for the deployments examined; it is moderate as a claim about all activity, because freight and voice channels likely carry unlabeled agent-to-agent negotiations that no one has measured.

Four safety mechanisms recur in every production setting. The first is a delegated envelope fixed before the agent acts: Walmart's budgets for Pactum, network-token scope at Mastercard and Visa, single-use cards at Ramp, open-mandate constraints in AP2. The second is an explicit confirmation step: passkeys and biometrics at checkout, Amazon's 24-hour cancel window, MAFRA approving every creative. The third is protocol hygiene for duplicate and pending commitments, which AdCP v3 encodes as mandatory idempotency on mutating calls and asynchronous approval states.[^ppc-adcp] The fourth is liability parked with an existing legal entity: the merchant of record in every consumer checkout, Cloudflare as merchant of record under the original Pay Per Crawl, the human supplier in procurement.[^ppc-cloudflare]

No production case handles failure natively at the agent layer. Revocation and remedy fall back to contract law, card chargebacks, PayPal buyer protection, merchant return policies and insertion-order terms. On card rails, Worldpay's July 30, 2026 analysis says fraud on properly tokenized agent transactions follows existing rules, while non-fraud disputes have no liability shift: "Where it gets murkier is everything short of outright fraud."[^worldpay] Chargeflow, a chargeback-management vendor, reports that no published network rule allocates dispute liability among merchants, issuers and agent platforms, and EMVCo's draft agentic payments framework of September 1, 2026 does not address disputes or liability.[^chargeflow] On crypto rails, ERC-8183 makes the evaluator final. The documented recoveries are social: about 80% of the Grok and Bankrbot losses came back after the community identified the attacker.[^giskard]

Evidence quality runs opposite to novelty. The strongest evidence (named customers, numbers, multiple independent reports) covers the oldest and most human-facing cases: Pactum for Walmart in 2022–2023, C.H. Robinson in 2025, Klarna's AI assistant, which CX Today reported on February 29, 2024 handled two-thirds of customer-service chats, refunds included, in its first month.[^klarna] The newest and most agent-to-agent claims rest on foundation press releases, vendor dashboards, AI-authored outlets and aggregators. A reader should weight the record accordingly: the pattern of human-anchored commitment is established; the size of agent-to-agent activity is not.

## Framework: four layers, one lifecycle, and where each operation lives today

Three strands of theory organize the observations for a protocol designer. The first is the social theory of commitment from multi-agent systems research. Singh (1999) models a commitment as a public relation C(x, y, G, p) among a debtor x, a creditor y, a context group G whose norms govern it, and a discharge condition p, with operations to create, discharge, cancel, release, delegate and assign.[^singh1999] His later formulation makes commitments conditional, C(debtor, creditor, antecedent, consequent): a commitment detaches when its antecedent holds, discharges when its consequent holds and is violated if detached and never discharged.[^singh-ch] He insists the object is public rather than mental: "Commitments are not mutual beliefs."[^singh-ch] Fornara and Colombetti (2002) build agent-communication semantics on the same objects and reject mentalistic semantics for competitive, heterogeneous agents.[^fornara] For LLM agents, whose internal states no counterparty can inspect, the social view is the only auditable one. It also lines up with the objective theory of contract formation.

Mapping each lifecycle operation to where it lives in today's stack shows what exists and what is missing.

| Operation (Singh) | Legal analogue | Where it lives in October 2026 | Gap |
|---|---|---|---|
| Create (offer, acceptance) | Formation | AP2 merchant-signed checkout plus closed mandate; x402 `PaymentRequirements` accepted by signing; AdCP `create_media_buy` | No signed offer or acceptance for services in A2A or MCP; A2A `SUBMITTED` merges receipt and agreement |
| Detach (antecedent true) | Condition precedent | AP2 open-mandate constraints checked at checkout | No general `request-when`; subscriptions are best-effort and callee-centered |
| Discharge (performance) | Performance | Card settlement; x402 settlement; A2A `COMPLETED` | Nothing verifies that delivered work matches the promise, outside ERC-8183 evaluators |
| Violate | Breach | Card disputes under ordinary reason codes; ERC-8183 reject or expire | No agent-specific dispute rule on card rails; no appeal on-chain |
| Cancel / release | Termination, waiver | A2A cancel (best-effort); MCP cancel (non-binding); token revocation (`revoked` in Stripe SPT) | Cancellation does not bind the performing agent |
| Delegate / assign | Delegation, assignment | OAuth token exchange, ID-JAG; AP2 key binding | AP2 says agent-to-agent delegation is "outside the scope of the current specification"[^ap2-spec] |
| Context group G | Governing law, forum | Card-network rules; merchant terms; insertion-order terms | No protocol names the governing procedure for a commitment |

The second strand is a layer stack drawn from research on agent trust and failure. Commitments between agents depend on four layers, each at a different stage of maturity as of October 2026. Operator identity is deployed: Visa's Trusted Agent Protocol, Mastercard agent registration, the Amex agent registration service, Cloudflare signed agents and Microsoft Entra Agent ID, generally available by May 1, 2026.[^entra] Delegation and scoped authority are partly deployed: OAuth token exchange and IdP-issued assertions in enterprises, payment mandates in pilots, cross-domain agent-to-agent delegation in IETF drafts. Intent integrity, meaning assurance that a specific in-scope action reflects the principal's wishes, is unsolved. Dispute, unwind and liability for non-fraud agent error is unallocated on card rails and absent on crypto rails. A survey of authorization architectures (arXiv, 2026) found "few documented deployments satisfy all three properties reliably and end to end," referring to identity, task-scoped authorization and runtime enforcement.[^surapani]

The third strand, from economics, explains why some commitments are credible without a court. Schelling's account of bargaining power through self-binding and Williamson's analysis of hostages and bonds as supports for exchange map onto escrow, staking and deposit-only vaults.[^schelling][^williamson] Tennenholtz's program equilibrium shows that when players submit programs able to read each other's code, conditional cooperation becomes an equilibrium, though the canonical construction breaks under any syntactic difference.[^tennenholtz] Hadfield and Koh (2025) carry the idea to AI agents and argue that AI-to-AI cooperation improves when agents can write formal contracts.[^hadfield] LLM agents are not transparent programs: weights and prompts are private and outputs are stochastic. Code-conditioned commitment between them therefore depends on attestation (signed policies, trusted execution) rather than on reading source, which no production deployment in the notes provides.

Combined, the lifecycle and the layer stack give a grid. Each commitment tier on the gradient requires more of the lifecycle (a trigger needs create and detach; escrow needs every operation including violate and G) and more of the stack (a micropayment can tolerate missing intent integrity because loss per error is cents; a $140 million supply agreement cannot). Deployment appears exactly where the missing cells are filled by something outside the agent protocol: a human who reads and accepts, a network that enforces a cap, a merchant who absorbs the error.

## Thesis: residual risk, not connectivity, sets the ceiling

Agent-to-agent commitments will grow only as fast as some party agrees to carry the residual risk of an authenticated, in-scope agent committing wrongly. Connectivity, identity and settlement are no longer the binding constraints. Until intent integrity can be evidenced and liability for in-scope error is allocated, binding commitments will route through a human or an incumbent risk-bearer, and direct agent-to-agent commitments will stay confined to settings where loss per error is small (micropayments), loss is bounded by architecture (escrow with expiry, deposit-only vaults, single-use tokens), or a human holds a veto (AdCP approvals).

## Logic argument: why the constraint sits at intent integrity and liability

The argument proceeds in six steps, each tied to evidence.

First, the law already binds principals to their agents' commitments, including commitments formed between two agents with no human review. UETA §14, which Wikipedia's entry (accessed October 2026) lists as adopted in 49 states plus DC and the US Virgin Islands, provides that a contract may be formed by electronic agents "even if no individual was aware of or reviewed the electronic agents' actions."[^ueta-wiki][^mccullagh] The UN Electronic Communications Convention (2005, Art. 12) and the UNCITRAL Model Law on Automated Contracting (2024, Arts. 5 and 7) say the same and attribute the system's actions to the person who uses it for that purpose.[^mlac] The Model Law's guide calls automated systems "tools with no independent will or legal personality."[^mlac] Courts have followed attribution: *Moffatt v. Air Canada* (2024) rejected the argument that a chatbot was a separate entity, and the Ninth Circuit in *Amazon v. Perplexity* (August 2026) treated the user as the party accessing Amazon through the agent.[^moffatt][^sovereign] No jurisdiction gives agents legal personality, and no national enactment of the Model Law was found. Formation validity is therefore not the obstacle. Mistake doctrine is less settled: *Quoine v. B2C2* (Singapore Court of Appeal, February 24, 2020) assessed knowledge through the programmer of a deterministic trading algorithm, and Justice Philip Jeyaretnam said on April 9, 2026 that a programmer's state of mind at coding time may bear little relation to what a non-deterministic agent later does.[^quoine][^jeyaretnam]

Second, attribution places every in-scope error on a human or firm. Visa's 2026 rules require a cardholder acknowledgement of responsibility for the agentic provider's actions; Regulation E treats transfers by a person to whom the consumer furnished an access device as authorized; and Goodwin's June 11, 2026 analysis notes that compliance with Visa's rules shields against network fines but not against customer claims for exceeding authority, with merchants bearing the loss in practice.[^privatelaw][^goodwin][^paymentsdive] Payment executives interviewed at Money20/20 Europe, as reported by Payment Expert on July 10, 2026, expected the consumer to bear losses when the agent acted within instructions; a September 2026 PYMNTS Intelligence survey, reported by Forkast on October 6, 2026, found 93% of merchants say AI providers should bear the loss, and only 28% would expose their full catalog to agents under current terms (survey; AI-authored secondary source).[^paymentexpert][^forkast-liability] Each party nearest an agent's error has reason to limit what agents may commit to.

Third, identity does not resolve that risk, because every documented loss involved valid identity and corrupted intent. In the Grok and Bankrbot incident of May 4, 2026, Bankrbot correctly recognized Grok's verified wallet and executed Grok's decoded output; the OECD incident record notes this was not a smart-contract flaw.[^oecd-grok] Giskard's post-mortem adds that an NFT sent to Grok's wallet escalated its permissions before the transfer.[^giskard] Unit 42 observed hidden web content steering agents into Stripe and PayPal payments (March 2026, reported via secondary summary), and Zscaler documented two in-the-wild campaigns causing unauthorized payments in July 2026.[^vibegraveyard][^oecd-zscaler] Stronger operator identity would have prevented none of these.

Fourth, model-level defenses do not close the intent gap under adaptive attack. NIST's agent-hijacking evaluation (updated December 19, 2025) found new attacks raised hijack success from 11% to 81%, and 25 retries raised average success from 57% to 80%.[^nist] Patlan and coauthors (arXiv, July 9, 2025) found memory injection against ElizaOS agents succeeded 55.1% of the time against a model that resisted prompt injection.[^patlan] An agent that accepts commitments from arbitrary counterparties faces cheap, repeated attempts, so per-attempt robustness understates exposure.

Fifth, the tools that exist bound the size of a bad commitment but not its correctness. Spend caps, merchant allowlists, single-use tokens and AP2 open mandates limit loss magnitude. Signed mandates and Mastercard's Verifiable Intent create evidence of what was delegated, but no network has published how mandate evidence changes a dispute outcome, and AP2 v0.2 places dispute procedure out of scope.[^ap2-spec][^chargeflow] Insurance follows deployer liability, not inter-agent commitments: Armilla's announcement dated January 21, 2026 (the page's body says 2025) puts its Lloyd's-backed cover at $25 million per organization and names "AI agent failures," Drata's July 16, 2026 blog says AIUC pairs its AIUC-1 certification with cover of up to $50 million (vendor self-report), and the notes found no insurer underwriting commitments between two autonomous agents across organizations.[^armilla][^drata]

Sixth, intent integrity and liability hold each other in place. Because no one can verify that an in-scope action was intended, no one will absorb liability for in-scope errors; because no one absorbs that liability, there is little commercial pressure for an intent-verification standard beyond mandates as dispute evidence. American Express's Agent Purchase Protection, announced April 14, 2026, is the first attempt to break the loop: Amex will cover eligible card members against charges caused by a registered agent's error when the agent transmitted authenticated purchase intent.[^paypers-amex] Amex can offer this because it operates as issuer and network; four-party networks would need rule changes, which ShopAppy forecasts no earlier than April 2027 (author's forecast).[^shopappy]

The conclusion follows: where residual risk has a holder, commitments run (merchant of record, network cap, human supplier, insertion-order terms); where it has none, they stay small or gated.

The strongest counterargument is that the constraint is demand, not risk. OpenAI's Instant Checkout failed with weak conversion and missing tax infrastructure, not because of a liability gap; Forrester found buying inside an answer engine the least-adopted use case in March 2026.[^forrester] That account explains consumer checkout. It does not explain why Pactum's suppliers, who prefer the bot, still contract with a human-supervised agent rather than deploying their own; why AdCP sellers approve every creative; or why Visa's B2B pilot restricts the agent to invoices the buyer already approved. In B2B settings, demand is present and the gating is explicitly about authority and error. A second counterargument holds that crypto escrow already solves the problem by removing the need for a risk-bearer. ERC-8183 relocates trust to the evaluator, which the specification treats as final and which a security survey (arXiv, May 1, 2026) shows is exposed to bribery, Sybil evaluator clusters and evaluator–provider collusion.[^mao] Escrow makes the commitment self-executing; it does not make the judgment of performance trustworthy.

## Narrative development: from closed clubs to open protocols and back

The history of machine commitment suggests where agent commitments go next. Electronic data interchange made machine-generated purchase orders binding in 1990 without changing statutes. The ABA's Model Trading Partner Agreement had partners agree in advance that properly transmitted messages are signed writings, set rules for when a document counts as received, required functional acknowledgments and excluded consequential damages from transmission errors "regardless of fault."[^naesb] The UNCITRAL Secretary-General's 1991 report quotes the agreement's clause that "the parties agree not to contest the validity or enforceability of Signed Documents."[^uncitral1991] EDI worked as a closed club with an umbrella contract that made later machine messages binding.

Electronic trading added hard limits outside the machine after the machine failed. According to CFTC Chairman Gensler's testimony of December 8, 2010, the May 6, 2010 Flash Crash began when an execution algorithm with no price limit and no time limit sold 75,000 E-mini contracts; PlanSponsor reported on October 1, 2010 that nearly 21,000 trades were cancelled as clearly erroneous and that regulators started a single-stock circuit-breaker pilot.[^gensler][^plansponsor] The SEC's October 16, 2013 release on Knight Capital reports that its router sent more than 4 million orders in 45 minutes on August 1, 2012, that the firm lost more than $460 million, and that it lacked pre-trade controls required under the Market Access Rule.[^sec-knight] Markets made machine commitments safe with collars, capital thresholds and kill switches enforced outside the trading logic, plus an ex post institution for unwinding obvious errors.

Programmatic advertising shows the market choosing pre-contracted counterparties even after open machine commitment matured. Open-auction real-time bidding was 13% of US display spending in 2012, according to eMarketer data reported by Chief Marketer on November 21, 2012; by 2023, programmatic direct accounted for about 75% of programmatic, per eMarketer's undated analysis (c. 2024).[^chiefmarketer][^emarketer] Buyers moved from open auctions to private deals with known sellers. AdCP now sits above the auction for campaign-level agent negotiation, with human approval on the sell side.

The 2025–2026 protocol cycle followed the same arc. A2A and MCP delivered open transport and lifecycle; commitment semantics landed in commerce extensions (AP2, UCP, x402) and in card-network rules. FIPA's 2002 standard had already defined `agree`, `propose`, `accept-proposal` and `request-when` with formal semantics; today's protocols re-adopted FIPA's lifecycle half (reject, fail, cancel, report) and dropped the negotiation and conditional-commitment half.[^fipa] Smith's 1980 Contract Net stated that "the execution of a task is dealt with as a contract between two nodes," with binding bids and no enforcement.[^smith] Forty-six years later, binding bids between agents still carry no enforcement unless an outside institution supplies it.

The likely next phase, judged from these precedents, is a return to clubs: buyer–supplier pairs that pre-contract an umbrella agreement covering their agents' messages, card-network registries that admit only registered agents, and insurer-certified agent deployments. Open agent-to-agent commerce will grow underneath, at micropayment scale, where loss per error is too small to need a risk-bearer. The Gordon Food Service and Tyson Foods pilot and Walmart's planned supplier-facing agent are the candidates for the first cross-company agent-to-agent commitments, because the parties already have a contract to attach them to. This projection is an inference from precedent, not an observation.

## Implications: build signed commitment objects and enforce loss bounds outside the model

The evidence supports six decisions for teams building agent commitment infrastructure or products.

Build commitment semantics as signed objects layered on existing transport rather than as a new transport. A2A and MCP are consolidated under the Linux Foundation's Agentic AI Foundation, and A2A's required-extension mechanism forces clients to comply with an extension or receive an error.[^aaif][^a2a-spec] The missing object is a signed service commitment from a performing agent to a delegating agent: deliverable, deadline, acceptance criteria, remedy and governing procedure. The components exist in production specifications (JWS over canonicalized JSON for Agent Cards, SD-JWT verifiable credentials with versioned types and constraint-evaluation algorithms in AP2, mandatory receipts). The notes found no one who has specified the combination. Separating binding offers made as tool calls from non-binding chat, as Bergemann and coauthors do in their April 2026 bilateral-trade simulator, gives a defined point to attach the semantics.[^bergemann]

Name the governing procedure inside the protocol. The Model Law on Automated Contracting attributes actions first according to a procedure the parties have agreed (Art. 7(1)), and its optional Art. 8 bars reliance on actions the attributed party could not reasonably have expected when the other side knew or ought to have known.[^mlac] A protocol that carries signed delegation scopes gives the counterparty notice of the expected-behavior envelope, which is the factual predicate for that knowledge test. This is an inference about legal effect that counsel should test against the jurisdictions in play.

Enforce loss bounds outside the model, at the narrowest layer that can refuse. The production pattern (network-token scope, single-use cards, deposit-only vaults, Coinbase spend permissions enforced by a manager contract) and the trading precedent (pre-trade risk controls) agree.[^coinbase-spend][^sec-knight] Liang and Xu's finding that automated profit verification is the binding guardrail below a capability threshold supports a pre-commitment check that does not rely on the agent's judgment.[^liangxu] AIMS, the IETF WIMSE draft of September 15, 2026, states that the LLM must never access agent credentials and requires tamper-evident audit logs.[^aims]

Treat agent-to-agent instructions as untrusted content regardless of the sender's identity. In Grok and Bankrbot, authentication of the sender was taken as authorization of the content. A receiving agent should require a principal-signed delegation artifact for any commitment above a threshold, not merely a verified sender.

Prevent first-arrival advantage in agent markets. Buyer agents in Microsoft Research's Magentic Marketplace (October 27, 2025) took the first proposal 60–100% of the time, and first offers anchored final price in NegotiationArena (ICML 2024; Spearman ρ = 0.716) and in Salesforce AI Research's May 15, 2026 car-negotiation study.[^magentic][^negotiationarena][^cosentino] Sealed collection windows, as in auctions, remove the speed premium. Disclosure of the model representing each side, or a best-execution duty, addresses the hidden capability gap Project Deal measured.

Enter through bounded B2B relationships and conditional settlement that a risk-bearer accepts. The strongest demand evidence is B2B (Pactum, freight, Visa's invoice pilot, Ramp's agent cards). Pay-on-use and session models (Cloudflare per-answer, Tempo sessions, x402 V2 sessions) sit between pay-per-call and full escrow and carry less evaluator risk. For crypto-native escrow, evaluator design deserves more engineering than the escrow contract; the ERC-8183 authors' own phrase, as quoted by CertiK, is that the evaluator "is harder than the contract."[^certik] Product metrics should report commitments formed, disputed and reversed, not registrations or raw transaction counts, since ERC-8004 registrations and x402 counts have proven to measure platform minting and wash activity.

## Assumptions to pressure-test before sharing this work

The inverse relation between commitment strength and agent counterparties rests on public disclosures. Freight voice channels and AI receptionists likely carry unlabeled agent-to-agent negotiations at volume; if a broker or payer publishes measured agent-meets-agent call data, the pattern weakens. Check HappyRobot, Hey Bubba and prior-authorization vendors directly.

The argument assumes liability is the binding constraint in B2B and treats demand as the binding constraint mainly in consumer checkout. A reader could argue that integration cost (catalogs, tax, order management) binds B2B as well. OpenAI's tax gap supports that alternative for consumer cases.

Several load-bearing figures come from AI-authored outlets or aggregators (Forkast, Stellagent, AgentMarketCap, BankingNewsAI), including the HappyRobot scale figures, the PYMNTS 93%/28% merchant survey and parts of the Mastercard timeline. Verify each against its primary source before external circulation.

Visa's April 18, 2026 Agentic Platform Requirements were read only through secondary summaries. The cardholder-acknowledgement language, which the argument relies on, should be checked against the rules text.

The x402 real-volume range of $1–3 million a month combines filters with undisclosed methodologies (Artemis, Allium, CoinDesk). The x402.org figure of 75.41 million transactions in 30 days, reported by Solana Compass in August 2026, conflicts with x402scan's 2.88 million for the 30 days to April 2026, reported by the Spartan Group on April 17, 2026; counting conventions differ.[^solanacompass][^spartan]

Virtuals aGDP and ACP job counts are self-reported under a $1 million-a-month incentive program. The report treats them as upper bounds; a reader with on-chain access to ACP escrow contracts could produce a better estimate.

The legal reading that attribution places in-scope errors on principals assumes US, UK and EU frameworks. A secondary claim of a January 2026 CFPB advisory preserving Regulation Z dispute rights for agent purchases could not be corroborated; if it exists, consumer-side liability allocation shifts. The Model Law's Art. 8 effect of signed scopes is an inference, not settled law.

Experimental findings (Project Deal, Magentic Marketplace, Liang and Xu) come from controlled settings with cooperative or same-family agents. Their transfer to adversarial cross-vendor markets is untested; no study measured agents defecting on agreed contracts that later became unprofitable.

The projection of a return to closed clubs is an inference from EDI, trading and programmatic precedents. Open agent marketplaces with strong evaluator networks could prove it wrong.

Workday, Oracle, Booking Holdings, Amadeus, Fairmarkit, Zip, insurance claims, prior authorization and the status of Sabre and Mindtrip flight booking were not researched to production depth. A gap in any of these could hold a counterexample.

## Notes

[^lf-a2a]: Linux Foundation, "A2A Protocol Surpasses 150 Organizations, Lands in Major Cloud Platforms, and Sees Enterprise Production Use in First Year," press release, April 9, 2026, https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year. Foundation claim; membership counts are not deployments.

[^glukhov]: Rost Glukhov, "Google A2A Protocol in 2026: Adoption, Hype, and Reality," glukhov.org, June 24, 2026, https://www.glukhov.org/ai-systems/comparisons/a2a-protocol-2026-adoption/.

[^stellagent-amex]: Stellagent, "American Express Launches ACE Developer Kit," Stellagent Insights, April 2026, https://stellagent.ai/insights/amex-ace-agentic-commerce-developer-kit. Aggregator; quotation attributed to Luke Gebb, EVP Global Innovation, American Express.

[^a2a-spec]: A2A Project, "Agent2Agent (A2A) Protocol Specification," version 1.0.0, March 12, 2026 (patch 1.0.1, May 26, 2026), §§3.1.5, 3.3.1, 4.3.3, 4.6, https://github.com/a2aproject/A2A/blob/main/docs/specification.md, accessed October 29, 2026. Text read from the main branch, which may include edits after 1.0.1.

[^mcp-changelog]: Model Context Protocol, "Specification, Version 2026-07-28: Key Changes," July 28, 2026, https://modelcontextprotocol.io/specification/2026-07-28/changelog.

[^mcp-tasks]: Model Context Protocol, "Extensions: Tasks—Overview," accessed October 29, 2026, https://modelcontextprotocol.io/extensions/tasks/overview.

[^mcp-roadmap]: David Soria Parra and Den Delimarsky, "The New MCP Roadmap," *Model Context Protocol Blog*, August 22, 2026, https://blog.modelcontextprotocol.io/posts/mcp-roadmap/.

[^fipa]: Foundation for Intelligent Physical Agents, *FIPA Communicative Act Library Specification*, document SC00037J (Geneva: FIPA, December 3, 2002), §§3.1–3.22, http://www.fipa.org/specs/fipa00037/SC00037J.html (PDF mirror consulted).

[^zapier]: Zapier, "Zapier MCP," product page, accessed October 29, 2026, https://zapier.com/mcp. Vendor self-report.

[^ap2-auth]: AP2 Project, "Agent Authorization," GitHub, google-agentic-commerce/AP2, v0.2 released April 28, 2026, https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/agent_authorization.md.

[^autobuy]: eMarketer, "Amazon Edges Deeper into Agentic Commerce with Rufus 'Auto Buy' Function," c. November 2025, https://www.emarketer.com/content/amazon-edges-deeper-agentic-commerce-rufus-auto-buy.

[^chr]: C.H. Robinson, "C.H. Robinson Scales Fleet of AI Agents Past 30," news release, June 12, 2025, https://www.chrobinson.com/en-us/about-us/newsroom/news/2025/ch-robinson-scales-fleet-of-ai-agents-past-30/. Company-reported figures.

[^duplex]: Kyle Wiggers, "Google Duplex Rolls Out to Pixel Phones in 43 States," *VentureBeat*, March 6, 2019, https://venturebeat.com/ai/google-duplex-rolls-out-to-pixel-phones-in-43-states.

[^callforme]: Ogbonda Chivumnovu, "Gemini's Call for Me," *Techloy*, September 25, 2026, https://www.techloy.com/geminis-call-for-me/.

[^askforme]: Charlie Mitchell, "Google Launches an AI Agent That Will Call Customer Service for You," *CX Today*, February 3, 2025, https://www.cxtoday.com/contact-center/google-launches-an-ai-agent-that-will-call-customer-service-for-you/.

[^ppc-adcp]: Luís Rijo, "Ad Context Protocol," *PPC Land*, October 24, 2026, https://ppc.land/ad-context-protocol/.

[^talkinglogistics]: Adrian Gonzalez, "Negotiating with a Chatbot: A Walmart Procurement Case Study," *Talking Logistics*, May 1, 2023, https://talkinglogistics.com/2023/05/01/negotiating-with-a-chatbot-a-walmart-procurement-case-study/. Summarizes the November 2022 *Harvard Business Review* article, whose text was not consulted.

[^pymnts-walmart]: PYMNTS, "Walmart Reportedly Finds 75% of Vendors Prefer Negotiating with Chatbot," April 2023, https://www.pymnts.com/news/artificial-intelligence/2023/walmart-finds-75-percent-vendors-prefer-negotiating-with-chatbot/partial/. Reports a Bloomberg article of April 26, 2023.

[^mitsmr]: "Procurement in the Age of Automation," *MIT Sloan Management Review*, n.d. (c. 2023), https://sloanreview.mit.edu/article/procurement-in-the-age-of-automation.

[^pactum]: Pactum, "Pactum Secures $54 Million in Series C Funding to Scale Agentic AI in Procurement," ACCESS Newswire, June 9, 2025, https://www.accessnewswire.com/newsroom/en/business-and-professional-services/pactum-secures-54-million-in-series-c-funding-to-scale-agentic-a-1036166. Vendor self-report.

[^fw-chr]: Grace Sharkey, "C.H. Robinson Delivers on AI, but Investors Still Skeptical," *FreightWaves*, April 16, 2025, https://www.freightwaves.com/news/c-h-robinson-delivers-on-ai-but-investors-still-skeptical.

[^happyrobot-circle]: HappyRobot, "Circle Logistics," customer story, n.d., https://www.happyrobot.ai/customer-story/circle. Vendor self-report.

[^heybubba]: FreightWaves Staff, "5 Hours to Book a Truck? AI Is Coming for That," *FreightWaves*, September 28, 2026, https://freightwaves.com/news/5-hours-to-book-a-truck-ai-is-coming-for-that.

[^forkast-happyrobot]: Dana Ellison [AI-generated byline], "HappyRobot Wants $1.2 Billion to Run Your Freight by Voice," *Forkast*, August 20, 2026, https://forkast.news/happyrobot-wants-1-2-billion-to-run-your-freight-by-voice/.

[^videoweek]: Tim Cross-Kovoor, "Industry Coalition Ushers in Age of Agent-to-Agent Trading with Ad Context Protocol Launch," *VideoWeek*, October 15, 2025, https://videoweek.com/2025/10/15/industry-coalition-ushers-in-age-of-agent-to-agent-trading-with-ad-context-protocol-launch/.

[^magnite]: Magnite Team, "Why Magnite Built a Seller Agent—and What It Signals for AdCP," Magnite blog, January 6, 2026, https://www.magnite.com/blog/why-magnite-built-a-seller-agent-and-what-it-signals-for-adcp/.

[^pubmatic]: PubMatic, "PubMatic and Butler/Till Launch AdCP-Enabled Agentic AI Campaign Across CTV," Business Wire, December 15, 2025, https://www.businesswire.com/news/home/20251215976339/en/PubMatic-and-ButlerTill-Launch-AdCP-Enabled-Agentic-AI-Campaign-Across-.

[^ppc-czech]: Luís Rijo, "Czech Republic Gets Its First Fully Autonomous AI Ad Buy," *PPC Land*, June 2026, https://ppc.land/czech-republic-gets-its-first-fully-autonomous-ai-ad-buy/.

[^emarketer]: eMarketer, "US Programmatic Ad Spending Set to Reach Nearly $180 Billion by 2025," n.d. (c. 2024), https://www.emarketer.com/content/programmatic-ad-spending-set-reach-nearly-180-billion-by-2025.

[^gfs]: Google Cloud, "Gordon Food Service," customer story, n.d., accessed October 29, 2026, https://cloud.google.com/customers/gordonfoodservice.

[^salesforce-q2]: MarketBeat, "Transcript: Salesforce Q2 Earnings Call Highlights," August 26, 2026, https://www.marketbeat.com/instant-alerts/transcript-salesforce-q2-earnings-call-highlights-2026-08-26/.

[^stripe-acp]: Stripe, "Stripe Powers Instant Checkout in ChatGPT and Releases Agentic Commerce Protocol Codeveloped with OpenAI," Stripe Newsroom, September 29, 2025, https://stripe.com/newsroom/news/stripe-openai-instant-checkout.

[^forrester]: Emily Pfeiffer and Sucharita Kodali, "What It Means That the Leader in 'Agentic Commerce' Just Pulled Back," *Forrester Blogs*, March 7, 2026, https://www.forrester.com/blogs/what-it-means-that-the-leader-in-agentic-commerce-just-pulled-back.

[^shopifreaks-pivot]: Paul Drecksler, "OpenAI Pivots from Instant Checkout to an App-Based Shopping Model Inside ChatGPT," *Shopifreaks*, March 12, 2026, https://www.shopifreaks.com/openai-pivots-from-instant-checkout-to-an-app-based-shopping-model-inside-chatgpt/.

[^shopifreaks-scaleback]: Paul Drecksler, "OpenAI Scales Back Its Integrated Commerce Plans," *Shopifreaks*, March 9, 2026, https://www.shopifreaks.com/openai-scales-back-its-integrated-commerce-plans/.

[^dc360]: Brian Warmoth, "OpenAI Shifts Checkout Plans in Agentic Commerce Strategy," *Digital Commerce 360*, March 6, 2026, https://digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/.

[^stripe-spt]: Stripe, "The Shared Payment Granted Token Object," Stripe API Reference, accessed October 2026, https://docs.stripe.com/api/shared-payment/granted-token/object.

[^bankingnews-stripe]: BankingNewsAI, "Stripe Agentic Commerce: ACP, Shared Payment Tokens, AI Checkouts," accessed October 2026, https://www.bankingnewsai.com/fintech/stripe/agentic-commerce. Aggregator citing Stripe primary documents.

[^bankingnews-mc]: BankingNewsAI, "Mastercard Agentic Commerce: Agent Pay Rollout, Partners, Disputes," accessed October 2026, https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce. Aggregator citing Mastercard releases.

[^stellagent-mc]: Stellagent, "Mastercard Agent Pay Explained: Agentic Tokens and Verifiable Intent," Stellagent Insights, April 9, 2026, https://stellagent.ai/insights/mastercard-agent-pay-agentic-tokens. Aggregator.

[^visa-dec]: Visa Inc., "Visa and Partners Complete Secure AI Transactions, Setting the Stage for Mainstream Adoption in 2026," press release, December 18, 2025, https://investor.visa.com/news/news-details/2025/Visa-and-Partners-Complete-Secure-AI-Transactions-Setting-the-Stage-for-Mainstream-Adoption-in-2026/default.aspx.

[^bankingnews-visa]: BankingNewsAI, "Visa Agentic Commerce," accessed October 2026, https://www.bankingnewsai.com/fintech/visa/agentic-commerce. Aggregator citing Visa releases.

[^privatelaw]: Private.Law Wiki, "Agentic Payments: Protocols and Liability When an AI Agent Pays," accessed October 2026, https://wiki.private.law/en/agentic-payments.md. Secondary summary of Visa Core Rules (April 18, 2026), §4.1.24; the rules text was not consulted.

[^visa-bill]: Visa Inc., "Visa, BILL and Billtrust Launch First Live Pilot for Trusted AI Agent Payments Between Buyer and Supplier Platforms," press release, October 20, 2026, https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22856.html.

[^ramp]: Ramp, "Virtual Cards for AI Agents," *Ramp Blog*, April 28, 2026, https://ramp.com/blog/virtual-cards-for-ai-agents. Vendor self-report.

[^mercury]: PYMNTS, "AI Agents Just Got Their Own Company Credit Cards," 2026, https://www.pymnts.com/?p=4071149.

[^natural]: FinTech Futures, "Natural Bags $30m, Launches Agentic Payments Infrastructure," July 2026, https://www.fintechfutures.com/venture-capital-funding/natural-bags-30m-launches-agentic-payments-infrastructure.

[^techinformed]: TechInformed, "Visa Opens One Integration for AI Agent Payments," April 9, 2026, https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/. Reports a Visa and Morning Consult survey dated April 2, 2026.

[^shopappy]: Karolina Skwira, "Agent Chargeback Rules: No Network Fix before Holiday 2026," *ShopAppy*, August 24, 2026, updated September 13, 2026, https://shopappy.com/payments/card-networks/agent-chargeback-rules-holiday-2026. Reports Mastercard's Signals report of August 3, 2026.

[^salesforce-cyber]: Salesforce, "Salesforce Data: AI and Agents Propel Cyber Week to Record $336.6B in Global Spend," Salesforce Investor Relations, December 5, 2025, https://investor.salesforce.com/news/news-details/2025/Salesforce-Data-AI-and-Agents-Propel-Cyber-Week-to-Record-336-6B-in-Global-Spend/.

[^ms-forecast]: Navamya Acharya, "Morgan Stanley Sees a Multi-Year Path to Nearly $400B of Agentic Commerce," Investing.com via Yahoo Finance, November 29, 2025, https://finance.yahoo.com/news/morgan-stanley-sees-multi-path-093502239.html. Forecast.

[^mckinsey]: Katharina Schumacher, Roger Roberts, and Katharina Giebel, "The Agentic Commerce Opportunity: How AI Agents Are Ushering in a New Era for Consumers and Merchants," McKinsey & Company, October 17, 2025, https://www.mckinsey.com/industries/retail/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants. Forecast.

[^fool]: Lyle Daly, "Top Blockchains Continue to See Rapid Growth in AI Agent Payments," *The Motley Fool*, October 24, 2026, https://www.fool.com/investing/2026/10/24/top-blockchains-continue-to-see-rapid-growth-in-ai/. Cites Chainalysis (October 14, 2026) and TRM Labs.

[^kucoin]: KuCoin News (repost of MarsBit), "Visa and Artemis Report on AI Agent Payments; x402 Processes $15M in On-Chain Volume," July 16, 2026, https://www.kucoin.com/news/flash/visa-and-artemis-report-on-ai-agent-payments-x402-processes-15m-in-on-chain-volume.

[^defiant]: The Defiant Team, "Visa's Sheffield Pegs Adjusted x402 Volume at $19M," *The Defiant*, July 16, 2026, https://thedefiant.io/news/infrastructure/visa-s-sheffield-pegs-adjusted-x402-volume-at-19m.

[^lds]: Let's Data Science, "x402 Reveals Approval Gap in Agentic Micropayments," n.d. (after May 2026), https://letsdatascience.com/news/x402-reveals-approval-gap-in-agentic-micropayments-761bf8e7.

[^afg-oct20]: AFG (Agentic Financial Graph), "208,589 New AI Agents on Base in One Week: Where the Money Went, and Two Things We Were Counting Wrong," *DEV Community*, October 20, 2026, https://dev.to/agenticfinancegraph/208589-new-ai-agents-on-base-in-one-week-where-the-money-went-and-two-things-we-were-counting-h0p. Self-published and AI-drafted.

[^chainalysis]: Chainalysis Team, "Agentic Payments Cross the Threshold: Inside x402's Path to Meaningful Adoption," *Chainalysis Blog*, June 3, 2026, https://www.chainalysis.com/blog/x402-agentic-payments-adoption/.

[^cybersins]: Rishi Narang, "Pay per Crawl: Putting HTTP 402 to Work, and the Requirement I Missed," *cybersins/sec*, August 12, 2026, https://cybersins.com/pay-per-crawl-402-crawler-monetization/.

[^ppc-cloudflare]: Luís Rijo, "Cloudflare Stops Charging AI per Crawl and Starts Paying per Answer," *PPC Land*, July 2, 2026, https://ppc.land/cloudflare-stops-charging-ai-per-crawl-and-starts-paying-per-answer/.

[^erc8183]: Davide Crapis, Bryan Lim, Tay Weixiong, and Chooi Zuhwa, "ERC-8183: Agentic Commerce," Ethereum Improvement Proposals, draft, created February 25, 2026, Security Considerations, https://eips.ethereum.org/EIPS/eip-8183.

[^forkast-acp]: Tessa Vaughn [AI-generated byline], "The Machine as Buyer: Virtuals ACP and the Evaluator Problem," *Forkast*, July 22, 2026, https://forkast.news/the-machine-as-buyer-virtuals-acp-and-the-evaluator-problem/.

[^blockeden]: Dora Noda, "Virtuals Protocol Is Building GDP for Machines," *BlockEden.xyz Blog*, April 4, 2026, https://blockeden.xyz/blog/2026/04/04/virtuals-protocol-ai-economic-operating-system-on-chain-agent-economy/.

[^fundstrat]: Sean Farrell, "Virtuals Protocol—Growing Agentic GDP, Q2 Update," Fundstrat Global Advisors, Digital Asset Strategy, June 24, 2026, https://fundstrat.com/wp-content/uploads/2026/06/20260624-Digital-Asset-Strategy-Virtuals-Protocol-–-Growing-Agentic-GDP-Q2-Update.pdf.

[^8004scan]: 8004scan, homepage dashboard, accessed October 29, 2026, https://8004scan.io/.

[^llm4agents]: LLM4Agents, "ERC-8004's Third Registry Is Live and Empty," *LLM4Agents Blog*, August 17, 2026, https://llm4agents.com/blog/erc-8004-registries-onchain-audit.

[^mafrur]: Rischan Mafrur and Priagung Khusumanegara, "From Agent Identity to Agent Economy: Measuring the Operational Readiness of ERC-8004 AI Agents," arXiv:2606.12128, June 10, 2026, https://arxiv.org/html/2606.12128v1.

[^cloudflare-x402]: Will Allen, Cam Whiteside, Rohin Lohe, and Steve James, "Launching the x402 Foundation with Coinbase, and Support for x402 Transactions," *Cloudflare Blog*, September 23, 2025, https://blog.cloudflare.com/x402/.

[^theblock-tempo]: Brian Danga, "Tempo Mainnet Goes Live with Machine Payments Protocol for Agents," *The Block*, March 18, 2026, https://www.theblock.co/post/394131/tempo-mainnet-goes-live-with-machine-payments-protocol-for-agents.

[^a2a-x402]: Google Agentic Commerce, "A2A Protocol: x402 Payments Extension v0.1," §4.2, GitHub, accessed October 29, 2026, https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.1/spec.md.

[^techcrunch-deal]: "Anthropic Created a Test Marketplace for Agent-on-Agent Commerce," *TechCrunch*, April 25, 2026, https://techcrunch.com/2026/04/25/anthropic-created-a-test-marketplace-for-agent-on-agent-commerce/.

[^decoder-deal]: "Anthropic Says Stronger AI Models Cut Better Deals and the Losers Don't Even Notice," *The Decoder*, April 25, 2026, https://the-decoder.com/anthropic-says-stronger-ai-models-cut-better-deals-and-the-losers-dont-even-notice/.

[^magentic]: Gagan Bansal et al., "Magentic Marketplace: An Open-Source Environment for Studying Agentic Markets," arXiv:2510.25779, October 27, 2025, sec. 5.4, https://arxiv.org/abs/2510.25779.

[^liangxu]: Chen Liang and Fasheng Xu, "When LLM Agents Negotiate: Private Information and Dynamic Bargaining in Supply Chains," arXiv:2608.07538, August 2026, https://ideas.repec.org/p/arx/papers/2608.07538.html.

[^decoder-vend]: "Anthropic's AI Store Makes Money While Debating Eternal Transcendence," *The Decoder*, December 19, 2025, https://the-decoder.com/anthropics-ai-store-makes-money-while-debating-eternal-transcendence/.

[^aivillage]: AI Digest, "Interact with Other AI Agents Outside the Village!," AI Village goal timeline, March 23–27, 2026, https://theaidigest.org/village/goal/interact-other-ai-agents-outside-village.

[^olas]: Olas, "Mech Marketplace," accessed October 29, 2026, 09:00 UTC, https://olas.network/mech-marketplace. Counting methodology at Olas, "Data Verification," https://olas.network/data.

[^oecd-grok]: OECD.AI Policy Observatory, "AI Prompt Injection Exploit Drains Grok-Linked Crypto Wallet," AI Incidents Monitor, incident 2026-05-04-4a73, May 2026, https://oecd.ai/en/incidents/2026-05-04-4a73.

[^giskard]: Giskard, "How Grok Got Prompt-Injected: An X User Drained $150,000 from an AI Wallet," Giskard Knowledge, May 7, 2026, https://www.giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet. Vendor (AI testing firm).

[^worldpay]: Reshmi Suresh, "Agentic Commerce Liability Is Still Being Written," *Worldpay Insights*, July 30, 2026, https://worldpay.com/insights/articles/agentic-commerce-liability-is-still-being-written.

[^chargeflow]: Dan Moshkovich, "AI Agent Chargeback Liability: Who Pays When Agentic Commerce Goes Wrong," *Chargeflow Blog*, July 7, 2026, updated October 25, 2026, https://www.chargeflow.io/blog/ai-agent-chargeback-liability. Vendor (chargeback-management firm).

[^klarna]: Rhys Fisher, "Klarna Claims Its New AI Assistant Does the Work of 700 Full-Time Agents," *CX Today*, February 29, 2024, https://www.cxtoday.com/contact-center/klarna-claims-its-new-ai-assistant-does-the-work-of-700-full-time-agents/.

[^singh1999]: Munindar P. Singh, "An Ontology for Commitments in Multiagent Systems: Toward a Unification of Normative Concepts," *Artificial Intelligence and Law* 7 (1999): 97–113, https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/ai+law-final.pdf.

[^singh-ch]: Munindar P. Singh, "Commitments in Multiagent Systems: Some History, Some Confusions, Some Controversies, Some Prospects," chap. 31 in a festschrift honoring Cristiano Castelfranchi, 591–615, at 601, https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/Commitments-for-MAS.pdf. Volume title, editors, publisher and year not verified.

[^fornara]: Nicoletta Fornara and Marco Colombetti, "Operational Specification of a Commitment-Based Agent Communication Language," in *Proceedings of the First International Joint Conference on Autonomous Agents and Multiagent Systems (AAMAS '02), Part 2*, ed. Cristiano Castelfranchi and W. Lewis Johnson (New York: ACM Press, 2002), 535–42, https://people.lu.usi.ch/fornaran/papers/AAMAS02_fornara_colombetti.pdf.

[^ap2-spec]: AP2 Project, "Agentic Payment Protocol (v0.2)," §Agent-to-Agent Delegation, GitHub, google-agentic-commerce/AP2, released April 28, 2026, https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md.

[^entra]: Microsoft, "What's New in Microsoft Entra Agent ID," Microsoft Learn, May 1, 2026, https://learn.microsoft.com/en-us/entra/agent-id/whats-new-agent-id. Vendor self-report.

[^surapani]: Rakesh Kumar Surapani, Pradeep Kumar Dolabehera Kakitapelli, Arun Morampudi, and Praveena Padi, "Authorization Architectures for Tool-Using AI Agents," arXiv:2609.15906, 2026, https://arxiv.org/pdf/2609.15906.

[^schelling]: Thomas C. Schelling, *The Strategy of Conflict* (Cambridge, MA: Harvard University Press, 1960), chap. 2 (not verified).

[^williamson]: Oliver E. Williamson, "Credible Commitments: Using Hostages to Support Exchange," *American Economic Review* 73, no. 4 (1983): 519–40 (not verified).

[^tennenholtz]: Moshe Tennenholtz, "Program Equilibrium," *Games and Economic Behavior* 49, no. 2 (2004): 363–73, https://doi.org/10.1016/j.geb.2004.02.002 (not verified; content via Wikipedia, "Program Equilibrium," accessed October 2026).

[^hadfield]: Gillian K. Hadfield and Andrew Koh, "An Economy of AI Agents," arXiv:2509.01063, September 1, 2025, chapter prepared for the *NBER Handbook on the Economics of Transformative AI*, https://arxiv.org/abs/2509.01063.

[^ueta-wiki]: Wikipedia, "Uniform Electronic Transactions Act," accessed October 2026, https://en.wikipedia.org/wiki/Uniform_Electronic_Transactions_Act.

[^mccullagh]: Adrian McCullagh, "The Validity and Limitations of Software Agents in Contract Formation," University of Queensland, n.d., https://law.uq.edu.au/files/18238/A-McCullagh_The-Validity-and-Limitations-of-Software-Agents-in-Contract-Formation.pdf. Quotes UETA §14(1); see also 815 ILCS 333/14, https://ilga.gov/legislation/ilcs/documents/081503330K14.htm.

[^mlac]: United Nations Commission on International Trade Law, *UNCITRAL Model Law on Automated Contracting, with Guide to Enactment* (Vienna: United Nations, 2025), Arts. 5, 7, 8 and Guide para. 61, https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf.

[^moffatt]: *Moffatt v. Air Canada*, 2024 BCCRT 149 (B.C. Civil Resolution Tribunal, February 14, 2024), para. 27, https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do.

[^sovereign]: Sovereign Magazine, "Ninth Circuit Perplexity Comet Amazon CFAA Ruling," August 6, 2026, https://www.sovereignmagazine.com/article/ninth-circuit-perplexity-comet-amazon-cfaa-ruling. Press report; docket and opinion date not verified.

[^quoine]: Clifford Chance, "Singapore Court of Appeal Allows Claims against Cryptocurrency Exchange," client briefing, March 2020, https://www.cliffordchance.com/content/dam/cliffordchance/briefings/2020/03/Singapore-Court-of-Appeal-allows-Claims-against-Cryptocurrency-Exchange.pdf, summarizing *Quoine Pte Ltd v B2C2 Ltd* [2020] SGCA(I) 02.

[^jeyaretnam]: Philip Jeyaretnam, speech at the SCCA Asia-Pacific Legal Congress 2026, Supreme Court of Singapore, April 9, 2026, https://www.judiciary.gov.sg/news-and-resources/news/news-details/justice-philip-jeyaretnam--speech-at-the-asia-pacific-%28apac%29-legal-congress-2026.

[^goodwin]: Ximeng (Sammy) Tang, "Authorizing Agentic Payments," *Goodwin Fintech Flash*, June 11, 2026, https://www.goodwinlaw.com/en/insights/publications/2026/06/insights-technology-aiml-authorizing-agentic-payments.

[^paymentsdive]: Aaron Cheiffetz, "How Agentic Payments Shift Artificial Intelligence Risk," opinion, *Payments Dive*, October 9, 2026, https://www.paymentsdive.com/news/how-agentic-payments-artificial-intelligence-risk/832601/.

[^paymentexpert]: Payment Expert, "Agentic Commerce Rulebook: Liability," July 10, 2026, https://paymentexpert.com/2026/07/10/agentic-commerce-rulebook-liability/.

[^forkast-liability]: Tessa Vaughn [AI-generated byline], "The Agentic Commerce Liability Gap: Who Pays When the Agent Buys Wrong?," *Forkast*, October 6, 2026, https://forkast.news/the-agentic-commerce-liability-gap-who-pays-when-the-agent-buys-wrong/.

[^vibegraveyard]: Vibe Graveyard, "Prompt Injection Stopped Being Theoretical: Unit 42 Found AI Agents Obeying Poisoned Web Pages," July 5, 2026, https://vibegraveyard.ai/story/unit42-web-indirect-prompt-injection-in-the-wild/. Secondary summary of a Palo Alto Networks Unit 42 report dated March 3, 2026, which was not consulted.

[^oecd-zscaler]: OECD.AI Policy Observatory, "AI Agents Manipulated by Hidden Web Prompts to Make Fraudulent Payments," AI Incidents Monitor, incident 2026-07-03-c03c, July 2026, https://oecd.ai/en/incidents/2026-07-03-c03c.

[^nist]: NIST Center for AI Standards and Innovation, "Technical Blog: Strengthening AI Agent Hijacking Evaluations," January 17, 2025, updated December 19, 2025, https://www.nist.gov/node/1872381.

[^patlan]: Atharv Singh Patlan, Peiyao Sheng, S. Ashwin Hebbar, Prateek Mittal, and Pramod Viswanath, "Real AI Agents with Fake Memories: Fatal Context Manipulation Attacks on Web3 Agents," arXiv:2503.16248v3, July 9, 2025, https://arxiv.org/abs/2503.16248.

[^armilla]: Armilla AI, "Armilla AI Raises Lloyd's-Backed Coverage to $25M as Traditional Insurers Retreat from AI Risk," armilla.ai, January 21, 2026 (body text dated 2025), https://www.armilla.ai/resources/armilla-ai-raises-lloyds-backed-coverage-to-25m-as-traditional-insurers-retreat-from-ai-risk.

[^drata]: Laila Porte Petit Hernandez, "Drata Now Supports AIUC-1—The World's First AI Agent Standard," *Drata Blog*, July 16, 2026, https://drata.com/blog/introducing-aiuc-1. Vendor self-report.

[^paypers-amex]: Iulia Musat, "American Express Rolls Out Agentic Commerce Kit and Agent Protection," *The Paypers*, April 15, 2026, https://thepaypers.com/payments/news/american-express-launches-ace-developer-kit-and-agent-purchase-protection.

[^mao]: Qian'ang Mao, Jiaxin Wang, Ya Liu, Li Zhu, Cong Ma, and Jiaqi Yan, "SoK: Security of Autonomous LLM Agents in Agentic Commerce," arXiv:2604.15367v2, revised May 1, 2026, https://arxiv.org/pdf/2604.15367.

[^naesb]: North American Energy Standards Board (host), "Model Electronic Data Interchange Trading Partner Agreement," undated template, §4.6, https://www.naesb.org//pdf/mtpa0397.pdf. Section structure matches the ABA Model Trading Partner Agreement in Patricia B. Fry et al., "The Commercial Use of Electronic Data Interchange—A Report and Model Trading Partner Agreement," *Business Lawyer* 45 (June 1990): 1645 (ABA text not consulted).

[^uncitral1991]: United Nations Commission on International Trade Law, "Electronic Data Interchange: Report of the Secretary-General" (A/CN.9/350), *UNCITRAL Yearbook* 22 (1991), para. 77, https://uncitral.un.org/sites/uncitral.un.org/files/media-documents/uncitral/en/yb_1991_e_379-567.pdf.

[^gensler]: Gary Gensler, testimony before the Senate Banking Subcommittee on Securities, Insurance, and Investment and the Senate Permanent Subcommittee on Investigations, Commodity Futures Trading Commission, December 8, 2010, https://www.cftc.gov/PressRoom/SpeechesTestimony/opagensler-63.

[^plansponsor]: "Regulators Release Flash Crash Probe Report," *PlanSponsor*, October 1, 2010, https://www.plansponsor.com/regulators-release-flash-crash-probe-report/.

[^sec-knight]: U.S. Securities and Exchange Commission, "SEC Charges Knight Capital with Violations of Market Access Rule," press release 2013-222, October 16, 2013, https://www.sec.gov/news/press-release/2013-222.

[^chiefmarketer]: "Real-Time Bidding Is Surging Thanks to More Publishers, Advertisers and Formats," *Chief Marketer*, November 21, 2012, https://chiefmarketer.com/real-time-bidding-is-surging-thanks-to-more-publishers-advertisers-and-formats.

[^smith]: Reid G. Smith, "The Contract Net Protocol: High-Level Communication and Control in a Distributed Problem Solver," *IEEE Transactions on Computers* C-29, no. 12 (December 1980): 1104–13, §II, https://doi.org/10.1109/TC.1980.1675516.

[^aaif]: Agentic AI Foundation, "A2A Joins AAIF," *AAIF Blog*, August 17, 2026, https://aaif.io/blog/a2a-joins-aaif. Foundation claim.

[^bergemann]: Dirk Bergemann, Soheil Ghili, Xinyang Hu, Chuanhao Li, and Zhuoran Yang, "Training Language Models for Bilateral Trade with Private Information," arXiv:2604.16472, April 2026, https://econpapers.repec.org/paper/arxpapers/2604.16472.htm.

[^aims]: Pieter Kasselman et al., "AI Identity Management System," Internet-Draft draft-ietf-wimse-aims-00, IETF WIMSE Working Group, September 15, 2026, §§8, 11, https://datatracker.ietf.org/doc/html/draft-ietf-wimse-aims. Informational draft.

[^coinbase-spend]: Coinbase Developer Platform, "Spend Permissions," CDP documentation, accessed October 2026, https://docs.cdp.coinbase.com/coinbase-wallet/improve-ux/spend-permissions.

[^negotiationarena]: Federico Bianchi, Patrick John Chia, Mert Yuksekgonul, Jacopo Tagliabue, Dan Jurafsky, and James Zou, "How Well Can LLMs Negotiate? NegotiationArena Platform and Analysis," in *Proceedings of the 41st International Conference on Machine Learning*, PMLR 235 (2024), https://proceedings.mlr.press/v235/bianchi24a.html.

[^cosentino]: Romain Cosentino, Sarath Shekkizhar, Adam Earle, and Silvio Savarese, "Counterparty Modeling Is Not Strategy: The Limits of LLM Negotiators," arXiv:2605.16575, May 15, 2026, https://www.alphaxiv.org/abs/2605.16575.

[^certik]: CertiK, "The Rise of the Agent Economy, Part 1: How EIP-8004, EIP-8183, and x402 Turn AI Agents into Sovereign Economic Actors," *CertiK Blog*, May 6, 2026, https://www.certik.com/blog/the-rise-of-the-agent-economy-part-1.

[^solanacompass]: Solana Compass, "Solana Overtakes Base in x402 Daily Transactions: First Time in Six Months," August 2026, https://solanacompass.com/news/solana-flips-base-in-daily-x402-transactions-for-the-first-time-in-six-months.

[^spartan]: José Sanchez and Kelvin Koh, "AI Agents and the Next Wave of Onchain Demand," The Spartan Group, April 17, 2026, https://www.spartangroup.io/insights/ai-agents-and-the-next-wave-of-onchain-demand.

## Bibliography

8004scan. Homepage dashboard. Accessed October 29, 2026. https://8004scan.io/.

A2A Project. "Agent2Agent (A2A) Protocol Specification." Version 1.0.0, March 12, 2026; patch 1.0.1, May 26, 2026. Accessed October 29, 2026. https://github.com/a2aproject/A2A/blob/main/docs/specification.md.

Acharya, Navamya. "Morgan Stanley Sees a Multi-Year Path to Nearly $400B of Agentic Commerce." Investing.com via Yahoo Finance, November 29, 2025. https://finance.yahoo.com/news/morgan-stanley-sees-multi-path-093502239.html.

AFG (Agentic Financial Graph). "208,589 New AI Agents on Base in One Week: Where the Money Went, and Two Things We Were Counting Wrong." *DEV Community*, October 20, 2026. https://dev.to/agenticfinancegraph/208589-new-ai-agents-on-base-in-one-week-where-the-money-went-and-two-things-we-were-counting-h0p.

Agentic AI Foundation. "A2A Joins AAIF." *AAIF Blog*, August 17, 2026. https://aaif.io/blog/a2a-joins-aaif.

AI Digest. "Interact with Other AI Agents Outside the Village!" AI Village goal timeline, March 23–27, 2026. https://theaidigest.org/village/goal/interact-other-ai-agents-outside-village.

Allen, Will, Cam Whiteside, Rohin Lohe, and Steve James. "Launching the x402 Foundation with Coinbase, and Support for x402 Transactions." *Cloudflare Blog*, September 23, 2025. https://blog.cloudflare.com/x402/.

"Anthropic Created a Test Marketplace for Agent-on-Agent Commerce." *TechCrunch*, April 25, 2026. https://techcrunch.com/2026/04/25/anthropic-created-a-test-marketplace-for-agent-on-agent-commerce/.

"Anthropic Says Stronger AI Models Cut Better Deals and the Losers Don't Even Notice." *The Decoder*, April 25, 2026. https://the-decoder.com/anthropic-says-stronger-ai-models-cut-better-deals-and-the-losers-dont-even-notice/.

"Anthropic's AI Store Makes Money While Debating Eternal Transcendence." *The Decoder*, December 19, 2025. https://the-decoder.com/anthropics-ai-store-makes-money-while-debating-eternal-transcendence/.

AP2 Project. "Agent Authorization." GitHub, google-agentic-commerce/AP2, v0.2, April 28, 2026. https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/agent_authorization.md.

AP2 Project. "Agentic Payment Protocol (v0.2)." GitHub, google-agentic-commerce/AP2, April 28, 2026. https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md.

Armilla AI. "Armilla AI Raises Lloyd's-Backed Coverage to $25M as Traditional Insurers Retreat from AI Risk." armilla.ai, January 21, 2026. https://www.armilla.ai/resources/armilla-ai-raises-lloyds-backed-coverage-to-25m-as-traditional-insurers-retreat-from-ai-risk.

BankingNewsAI. "Mastercard Agentic Commerce: Agent Pay Rollout, Partners, Disputes." Accessed October 2026. https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce.

BankingNewsAI. "Stripe Agentic Commerce: ACP, Shared Payment Tokens, AI Checkouts." Accessed October 2026. https://www.bankingnewsai.com/fintech/stripe/agentic-commerce.

BankingNewsAI. "Visa Agentic Commerce." Accessed October 2026. https://www.bankingnewsai.com/fintech/visa/agentic-commerce.

Bansal, Gagan, Wenyue Hua, Zezhou Huang, Adam Fourney, Amanda Swearngin, Will Epperson, Tyler Payne, et al. "Magentic Marketplace: An Open-Source Environment for Studying Agentic Markets." arXiv:2510.25779, October 27, 2025. https://arxiv.org/abs/2510.25779.

Bergemann, Dirk, Soheil Ghili, Xinyang Hu, Chuanhao Li, and Zhuoran Yang. "Training Language Models for Bilateral Trade with Private Information." arXiv:2604.16472, April 2026. https://econpapers.repec.org/paper/arxpapers/2604.16472.htm.

Bianchi, Federico, Patrick John Chia, Mert Yuksekgonul, Jacopo Tagliabue, Dan Jurafsky, and James Zou. "How Well Can LLMs Negotiate? NegotiationArena Platform and Analysis." In *Proceedings of the 41st International Conference on Machine Learning*. PMLR 235, 2024. https://proceedings.mlr.press/v235/bianchi24a.html.

C.H. Robinson. "C.H. Robinson Scales Fleet of AI Agents Past 30." News release, June 12, 2025. https://www.chrobinson.com/en-us/about-us/newsroom/news/2025/ch-robinson-scales-fleet-of-ai-agents-past-30/.

CertiK. "The Rise of the Agent Economy, Part 1: How EIP-8004, EIP-8183, and x402 Turn AI Agents into Sovereign Economic Actors." *CertiK Blog*, May 6, 2026. https://www.certik.com/blog/the-rise-of-the-agent-economy-part-1.

Chainalysis Team. "Agentic Payments Cross the Threshold: Inside x402's Path to Meaningful Adoption." *Chainalysis Blog*, June 3, 2026. https://www.chainalysis.com/blog/x402-agentic-payments-adoption/.

Cheiffetz, Aaron. "How Agentic Payments Shift Artificial Intelligence Risk." Opinion. *Payments Dive*, October 9, 2026. https://www.paymentsdive.com/news/how-agentic-payments-artificial-intelligence-risk/832601/.

Chivumnovu, Ogbonda. "Gemini's Call for Me." *Techloy*, September 25, 2026. https://www.techloy.com/geminis-call-for-me/.

Clifford Chance. "Singapore Court of Appeal Allows Claims against Cryptocurrency Exchange." Client briefing, March 2020. https://www.cliffordchance.com/content/dam/cliffordchance/briefings/2020/03/Singapore-Court-of-Appeal-allows-Claims-against-Cryptocurrency-Exchange.pdf.

Coinbase Developer Platform. "Spend Permissions." CDP documentation. Accessed October 2026. https://docs.cdp.coinbase.com/coinbase-wallet/improve-ux/spend-permissions.

Cosentino, Romain, Sarath Shekkizhar, Adam Earle, and Silvio Savarese. "Counterparty Modeling Is Not Strategy: The Limits of LLM Negotiators." arXiv:2605.16575, May 15, 2026. https://www.alphaxiv.org/abs/2605.16575.

Crapis, Davide, Bryan Lim, Tay Weixiong, and Chooi Zuhwa. "ERC-8183: Agentic Commerce." Ethereum Improvement Proposals, draft, created February 25, 2026. https://eips.ethereum.org/EIPS/eip-8183.

Cross-Kovoor, Tim. "Industry Coalition Ushers in Age of Agent-to-Agent Trading with Ad Context Protocol Launch." *VideoWeek*, October 15, 2025. https://videoweek.com/2025/10/15/industry-coalition-ushers-in-age-of-agent-to-agent-trading-with-ad-context-protocol-launch/.

Daly, Lyle. "Top Blockchains Continue to See Rapid Growth in AI Agent Payments." *The Motley Fool*, October 24, 2026. https://www.fool.com/investing/2026/10/24/top-blockchains-continue-to-see-rapid-growth-in-ai/.

Danga, Brian. "Tempo Mainnet Goes Live with Machine Payments Protocol for Agents." *The Block*, March 18, 2026. https://www.theblock.co/post/394131/tempo-mainnet-goes-live-with-machine-payments-protocol-for-agents.

Defiant Team, The. "Visa's Sheffield Pegs Adjusted x402 Volume at $19M." *The Defiant*, July 16, 2026. https://thedefiant.io/news/infrastructure/visa-s-sheffield-pegs-adjusted-x402-volume-at-19m.

Drecksler, Paul. "OpenAI Pivots from Instant Checkout to an App-Based Shopping Model Inside ChatGPT." *Shopifreaks*, March 12, 2026. https://www.shopifreaks.com/openai-pivots-from-instant-checkout-to-an-app-based-shopping-model-inside-chatgpt/.

Drecksler, Paul. "OpenAI Scales Back Its Integrated Commerce Plans." *Shopifreaks*, March 9, 2026. https://www.shopifreaks.com/openai-scales-back-its-integrated-commerce-plans/.

Ellison, Dana [AI-generated byline]. "HappyRobot Wants $1.2 Billion to Run Your Freight by Voice." *Forkast*, August 20, 2026. https://forkast.news/happyrobot-wants-1-2-billion-to-run-your-freight-by-voice/.

eMarketer. "Amazon Edges Deeper into Agentic Commerce with Rufus 'Auto Buy' Function." c. November 2025. https://www.emarketer.com/content/amazon-edges-deeper-agentic-commerce-rufus-auto-buy.

eMarketer. "US Programmatic Ad Spending Set to Reach Nearly $180 Billion by 2025." n.d. (c. 2024). https://www.emarketer.com/content/programmatic-ad-spending-set-reach-nearly-180-billion-by-2025.

Farrell, Sean. "Virtuals Protocol—Growing Agentic GDP, Q2 Update." Fundstrat Global Advisors, Digital Asset Strategy, June 24, 2026. https://fundstrat.com/wp-content/uploads/2026/06/20260624-Digital-Asset-Strategy-Virtuals-Protocol-–-Growing-Agentic-GDP-Q2-Update.pdf.

FinTech Futures. "Natural Bags $30m, Launches Agentic Payments Infrastructure." July 2026. https://www.fintechfutures.com/venture-capital-funding/natural-bags-30m-launches-agentic-payments-infrastructure.

Fisher, Rhys. "Klarna Claims Its New AI Assistant Does the Work of 700 Full-Time Agents." *CX Today*, February 29, 2024. https://www.cxtoday.com/contact-center/klarna-claims-its-new-ai-assistant-does-the-work-of-700-full-time-agents/.

Fornara, Nicoletta, and Marco Colombetti. "Operational Specification of a Commitment-Based Agent Communication Language." In *Proceedings of the First International Joint Conference on Autonomous Agents and Multiagent Systems (AAMAS '02), Part 2*, edited by Cristiano Castelfranchi and W. Lewis Johnson, 535–42. New York: ACM Press, 2002. https://people.lu.usi.ch/fornaran/papers/AAMAS02_fornara_colombetti.pdf.

Foundation for Intelligent Physical Agents. *FIPA Communicative Act Library Specification*. Document SC00037J. Geneva: FIPA, December 3, 2002. http://www.fipa.org/specs/fipa00037/SC00037J.html.

FreightWaves Staff. "5 Hours to Book a Truck? AI Is Coming for That." *FreightWaves*, September 28, 2026. https://freightwaves.com/news/5-hours-to-book-a-truck-ai-is-coming-for-that.

Fry, Patricia B., Amelia H. Boss, Fred H. Miller, Michael S. Baum, Peter Otero, Jeffrey B. Ritter, and Thomas McCarthy. "The Commercial Use of Electronic Data Interchange—A Report and Model Trading Partner Agreement." *Business Lawyer* 45 (June 1990): 1645– (not verified).

Gensler, Gary. Testimony before the Senate Banking Subcommittee on Securities, Insurance, and Investment and the Senate Permanent Subcommittee on Investigations. Commodity Futures Trading Commission, December 8, 2010. https://www.cftc.gov/PressRoom/SpeechesTestimony/opagensler-63.

Giskard. "How Grok Got Prompt-Injected: An X User Drained $150,000 from an AI Wallet." Giskard Knowledge, May 7, 2026. https://www.giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet.

Glukhov, Rost. "Google A2A Protocol in 2026: Adoption, Hype, and Reality." glukhov.org, June 24, 2026. https://www.glukhov.org/ai-systems/comparisons/a2a-protocol-2026-adoption/.

Gonzalez, Adrian. "Negotiating with a Chatbot: A Walmart Procurement Case Study." *Talking Logistics*, May 1, 2023. https://talkinglogistics.com/2023/05/01/negotiating-with-a-chatbot-a-walmart-procurement-case-study/.

Google Agentic Commerce. "A2A Protocol: x402 Payments Extension v0.1." GitHub. Accessed October 29, 2026. https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.1/spec.md.

Google Cloud. "Gordon Food Service." Customer story, n.d. Accessed October 29, 2026. https://cloud.google.com/customers/gordonfoodservice.

Hadfield, Gillian K., and Andrew Koh. "An Economy of AI Agents." arXiv:2509.01063, September 1, 2025. https://arxiv.org/abs/2509.01063.

HappyRobot. "Circle Logistics." Customer story, n.d. https://www.happyrobot.ai/customer-story/circle.

Jeyaretnam, Philip. Speech at the SCCA Asia-Pacific Legal Congress 2026. Supreme Court of Singapore, April 9, 2026. https://www.judiciary.gov.sg/news-and-resources/news/news-details/justice-philip-jeyaretnam--speech-at-the-asia-pacific-%28apac%29-legal-congress-2026.

Kasselman, Pieter, et al. "AI Identity Management System." Internet-Draft draft-ietf-wimse-aims-00. IETF WIMSE Working Group, September 15, 2026. https://datatracker.ietf.org/doc/html/draft-ietf-wimse-aims.

KuCoin News. "Visa and Artemis Report on AI Agent Payments; x402 Processes $15M in On-Chain Volume." Repost of MarsBit, July 16, 2026. https://www.kucoin.com/news/flash/visa-and-artemis-report-on-ai-agent-payments-x402-processes-15m-in-on-chain-volume.

Let's Data Science. "x402 Reveals Approval Gap in Agentic Micropayments." n.d. (after May 2026). https://letsdatascience.com/news/x402-reveals-approval-gap-in-agentic-micropayments-761bf8e7.

Liang, Chen, and Fasheng Xu. "When LLM Agents Negotiate: Private Information and Dynamic Bargaining in Supply Chains." arXiv:2608.07538, August 2026. https://ideas.repec.org/p/arx/papers/2608.07538.html.

Linux Foundation. "A2A Protocol Surpasses 150 Organizations, Lands in Major Cloud Platforms, and Sees Enterprise Production Use in First Year." Press release, April 9, 2026. https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year.

LLM4Agents. "ERC-8004's Third Registry Is Live and Empty." *LLM4Agents Blog*, August 17, 2026. https://llm4agents.com/blog/erc-8004-registries-onchain-audit.

Mafrur, Rischan, and Priagung Khusumanegara. "From Agent Identity to Agent Economy: Measuring the Operational Readiness of ERC-8004 AI Agents." arXiv:2606.12128, June 10, 2026. https://arxiv.org/html/2606.12128v1.

Magnite Team. "Why Magnite Built a Seller Agent—and What It Signals for AdCP." Magnite blog, January 6, 2026. https://www.magnite.com/blog/why-magnite-built-a-seller-agent-and-what-it-signals-for-adcp/.

Mao, Qian'ang, Jiaxin Wang, Ya Liu, Li Zhu, Cong Ma, and Jiaqi Yan. "SoK: Security of Autonomous LLM Agents in Agentic Commerce." arXiv:2604.15367v2, revised May 1, 2026. https://arxiv.org/pdf/2604.15367.

MarketBeat. "Transcript: Salesforce Q2 Earnings Call Highlights." August 26, 2026. https://www.marketbeat.com/instant-alerts/transcript-salesforce-q2-earnings-call-highlights-2026-08-26/.

McCullagh, Adrian. "The Validity and Limitations of Software Agents in Contract Formation." University of Queensland, n.d. https://law.uq.edu.au/files/18238/A-McCullagh_The-Validity-and-Limitations-of-Software-Agents-in-Contract-Formation.pdf.

Microsoft. "What's New in Microsoft Entra Agent ID." Microsoft Learn, May 1, 2026. https://learn.microsoft.com/en-us/entra/agent-id/whats-new-agent-id.

Mitchell, Charlie. "Google Launches an AI Agent That Will Call Customer Service for You." *CX Today*, February 3, 2025. https://www.cxtoday.com/contact-center/google-launches-an-ai-agent-that-will-call-customer-service-for-you/.

Model Context Protocol. "Extensions: Tasks—Overview." Accessed October 29, 2026. https://modelcontextprotocol.io/extensions/tasks/overview.

Model Context Protocol. "Specification, Version 2026-07-28: Key Changes." July 28, 2026. https://modelcontextprotocol.io/specification/2026-07-28/changelog.

*Moffatt v. Air Canada*. 2024 BCCRT 149. B.C. Civil Resolution Tribunal, February 14, 2024. https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do.

Moshkovich, Dan. "AI Agent Chargeback Liability: Who Pays When Agentic Commerce Goes Wrong." *Chargeflow Blog*, July 7, 2026, updated October 25, 2026. https://www.chargeflow.io/blog/ai-agent-chargeback-liability.

Musat, Iulia. "American Express Rolls Out Agentic Commerce Kit and Agent Protection." *The Paypers*, April 15, 2026. https://thepaypers.com/payments/news/american-express-launches-ace-developer-kit-and-agent-purchase-protection.

Narang, Rishi. "Pay per Crawl: Putting HTTP 402 to Work, and the Requirement I Missed." *cybersins/sec*, August 12, 2026. https://cybersins.com/pay-per-crawl-402-crawler-monetization/.

NIST Center for AI Standards and Innovation. "Technical Blog: Strengthening AI Agent Hijacking Evaluations." January 17, 2025, updated December 19, 2025. https://www.nist.gov/node/1872381.

Noda, Dora. "Virtuals Protocol Is Building GDP for Machines." *BlockEden.xyz Blog*, April 4, 2026. https://blockeden.xyz/blog/2026/04/04/virtuals-protocol-ai-economic-operating-system-on-chain-agent-economy/.

North American Energy Standards Board (host). "Model Electronic Data Interchange Trading Partner Agreement." Undated template. https://www.naesb.org//pdf/mtpa0397.pdf.

OECD.AI Policy Observatory. "AI Agents Manipulated by Hidden Web Prompts to Make Fraudulent Payments." AI Incidents Monitor, incident 2026-07-03-c03c, July 2026. https://oecd.ai/en/incidents/2026-07-03-c03c.

OECD.AI Policy Observatory. "AI Prompt Injection Exploit Drains Grok-Linked Crypto Wallet." AI Incidents Monitor, incident 2026-05-04-4a73, May 2026. https://oecd.ai/en/incidents/2026-05-04-4a73.

Olas. "Mech Marketplace." Accessed October 29, 2026. https://olas.network/mech-marketplace.

Pactum. "Pactum Secures $54 Million in Series C Funding to Scale Agentic AI in Procurement." ACCESS Newswire, June 9, 2025. https://www.accessnewswire.com/newsroom/en/business-and-professional-services/pactum-secures-54-million-in-series-c-funding-to-scale-agentic-a-1036166.

Patlan, Atharv Singh, Peiyao Sheng, S. Ashwin Hebbar, Prateek Mittal, and Pramod Viswanath. "Real AI Agents with Fake Memories: Fatal Context Manipulation Attacks on Web3 Agents." arXiv:2503.16248v3, July 9, 2025. https://arxiv.org/abs/2503.16248.

Payment Expert. "Agentic Commerce Rulebook: Liability." July 10, 2026. https://paymentexpert.com/2026/07/10/agentic-commerce-rulebook-liability/.

Pfeiffer, Emily, and Sucharita Kodali. "What It Means That the Leader in 'Agentic Commerce' Just Pulled Back." *Forrester Blogs*, March 7, 2026. https://www.forrester.com/blogs/what-it-means-that-the-leader-in-agentic-commerce-just-pulled-back.

Porte Petit Hernandez, Laila. "Drata Now Supports AIUC-1—The World's First AI Agent Standard." *Drata Blog*, July 16, 2026. https://drata.com/blog/introducing-aiuc-1.

Private.Law Wiki. "Agentic Payments: Protocols and Liability When an AI Agent Pays." Accessed October 2026. https://wiki.private.law/en/agentic-payments.md.

"Procurement in the Age of Automation." *MIT Sloan Management Review*, n.d. (c. 2023). https://sloanreview.mit.edu/article/procurement-in-the-age-of-automation.

PubMatic. "PubMatic and Butler/Till Launch AdCP-Enabled Agentic AI Campaign Across CTV." Business Wire, December 15, 2025. https://www.businesswire.com/news/home/20251215976339/en/PubMatic-and-ButlerTill-Launch-AdCP-Enabled-Agentic-AI-Campaign-Across-.

PYMNTS. "AI Agents Just Got Their Own Company Credit Cards." 2026. https://www.pymnts.com/?p=4071149.

PYMNTS. "Walmart Reportedly Finds 75% of Vendors Prefer Negotiating with Chatbot." April 2023. https://www.pymnts.com/news/artificial-intelligence/2023/walmart-finds-75-percent-vendors-prefer-negotiating-with-chatbot/partial/.

Ramp. "Virtual Cards for AI Agents." *Ramp Blog*, April 28, 2026. https://ramp.com/blog/virtual-cards-for-ai-agents.

"Real-Time Bidding Is Surging Thanks to More Publishers, Advertisers and Formats." *Chief Marketer*, November 21, 2012. https://chiefmarketer.com/real-time-bidding-is-surging-thanks-to-more-publishers-advertisers-and-formats.

"Regulators Release Flash Crash Probe Report." *PlanSponsor*, October 1, 2010. https://www.plansponsor.com/regulators-release-flash-crash-probe-report/.

Rijo, Luís. "Ad Context Protocol." *PPC Land*, October 24, 2026. https://ppc.land/ad-context-protocol/.

Rijo, Luís. "Cloudflare Stops Charging AI per Crawl and Starts Paying per Answer." *PPC Land*, July 2, 2026. https://ppc.land/cloudflare-stops-charging-ai-per-crawl-and-starts-paying-per-answer/.

Rijo, Luís. "Czech Republic Gets Its First Fully Autonomous AI Ad Buy." *PPC Land*, June 2026. https://ppc.land/czech-republic-gets-its-first-fully-autonomous-ai-ad-buy/.

Salesforce. "Salesforce Data: AI and Agents Propel Cyber Week to Record $336.6B in Global Spend." Salesforce Investor Relations, December 5, 2025. https://investor.salesforce.com/news/news-details/2025/Salesforce-Data-AI-and-Agents-Propel-Cyber-Week-to-Record-336-6B-in-Global-Spend/.

Sanchez, José, and Kelvin Koh. "AI Agents and the Next Wave of Onchain Demand." The Spartan Group, April 17, 2026. https://www.spartangroup.io/insights/ai-agents-and-the-next-wave-of-onchain-demand.

Schelling, Thomas C. *The Strategy of Conflict*. Cambridge, MA: Harvard University Press, 1960 (not verified).

Schumacher, Katharina, Roger Roberts, and Katharina Giebel. "The Agentic Commerce Opportunity: How AI Agents Are Ushering in a New Era for Consumers and Merchants." McKinsey & Company, October 17, 2025. https://www.mckinsey.com/industries/retail/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants.

Sharkey, Grace. "C.H. Robinson Delivers on AI, but Investors Still Skeptical." *FreightWaves*, April 16, 2025. https://www.freightwaves.com/news/c-h-robinson-delivers-on-ai-but-investors-still-skeptical.

Singh, Munindar P. "An Ontology for Commitments in Multiagent Systems: Toward a Unification of Normative Concepts." *Artificial Intelligence and Law* 7 (1999): 97–113. https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/ai+law-final.pdf.

Singh, Munindar P. "Commitments in Multiagent Systems: Some History, Some Confusions, Some Controversies, Some Prospects." Chap. 31 in a festschrift honoring Cristiano Castelfranchi, 591–615. https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/Commitments-for-MAS.pdf. Volume details not verified.

Skwira, Karolina. "Agent Chargeback Rules: No Network Fix before Holiday 2026." *ShopAppy*, August 24, 2026, updated September 13, 2026. https://shopappy.com/payments/card-networks/agent-chargeback-rules-holiday-2026.

Smith, Reid G. "The Contract Net Protocol: High-Level Communication and Control in a Distributed Problem Solver." *IEEE Transactions on Computers* C-29, no. 12 (December 1980): 1104–13. https://doi.org/10.1109/TC.1980.1675516.

Solana Compass. "Solana Overtakes Base in x402 Daily Transactions: First Time in Six Months." August 2026. https://solanacompass.com/news/solana-flips-base-in-daily-x402-transactions-for-the-first-time-in-six-months.

Soria Parra, David, and Den Delimarsky. "The New MCP Roadmap." *Model Context Protocol Blog*, August 22, 2026. https://blog.modelcontextprotocol.io/posts/mcp-roadmap/.

Sovereign Magazine. "Ninth Circuit Perplexity Comet Amazon CFAA Ruling." August 6, 2026. https://www.sovereignmagazine.com/article/ninth-circuit-perplexity-comet-amazon-cfaa-ruling.

Stellagent. "American Express Launches ACE Developer Kit." Stellagent Insights, April 2026. https://stellagent.ai/insights/amex-ace-agentic-commerce-developer-kit.

Stellagent. "Mastercard Agent Pay Explained: Agentic Tokens and Verifiable Intent." Stellagent Insights, April 9, 2026. https://stellagent.ai/insights/mastercard-agent-pay-agentic-tokens.

Stripe. "Stripe Powers Instant Checkout in ChatGPT and Releases Agentic Commerce Protocol Codeveloped with OpenAI." Stripe Newsroom, September 29, 2025. https://stripe.com/newsroom/news/stripe-openai-instant-checkout.

Stripe. "The Shared Payment Granted Token Object." Stripe API Reference. Accessed October 2026. https://docs.stripe.com/api/shared-payment/granted-token/object.

Surapani, Rakesh Kumar, Pradeep Kumar Dolabehera Kakitapelli, Arun Morampudi, and Praveena Padi. "Authorization Architectures for Tool-Using AI Agents." arXiv:2609.15906, 2026. https://arxiv.org/pdf/2609.15906.

Suresh, Reshmi. "Agentic Commerce Liability Is Still Being Written." *Worldpay Insights*, July 30, 2026. https://worldpay.com/insights/articles/agentic-commerce-liability-is-still-being-written.

Tang, Ximeng (Sammy). "Authorizing Agentic Payments." *Goodwin Fintech Flash*, June 11, 2026. https://www.goodwinlaw.com/en/insights/publications/2026/06/insights-technology-aiml-authorizing-agentic-payments.

TechInformed. "Visa Opens One Integration for AI Agent Payments." April 9, 2026. https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/.

Tennenholtz, Moshe. "Program Equilibrium." *Games and Economic Behavior* 49, no. 2 (2004): 363–73. https://doi.org/10.1016/j.geb.2004.02.002 (not verified).

United Nations Commission on International Trade Law. "Electronic Data Interchange: Report of the Secretary-General" (A/CN.9/350). *UNCITRAL Yearbook* 22 (1991). https://uncitral.un.org/sites/uncitral.un.org/files/media-documents/uncitral/en/yb_1991_e_379-567.pdf.

United Nations Commission on International Trade Law. *UNCITRAL Model Law on Automated Contracting, with Guide to Enactment*. Vienna: United Nations, 2025. https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf.

U.S. Securities and Exchange Commission. "SEC Charges Knight Capital with Violations of Market Access Rule." Press release 2013-222, October 16, 2013. https://www.sec.gov/news/press-release/2013-222.

Vaughn, Tessa [AI-generated byline]. "The Agentic Commerce Liability Gap: Who Pays When the Agent Buys Wrong?" *Forkast*, October 6, 2026. https://forkast.news/the-agentic-commerce-liability-gap-who-pays-when-the-agent-buys-wrong/.

Vaughn, Tessa [AI-generated byline]. "The Machine as Buyer: Virtuals ACP and the Evaluator Problem." *Forkast*, July 22, 2026. https://forkast.news/the-machine-as-buyer-virtuals-acp-and-the-evaluator-problem/.

Vibe Graveyard. "Prompt Injection Stopped Being Theoretical: Unit 42 Found AI Agents Obeying Poisoned Web Pages." July 5, 2026. https://vibegraveyard.ai/story/unit42-web-indirect-prompt-injection-in-the-wild/.

Visa Inc. "Visa and Partners Complete Secure AI Transactions, Setting the Stage for Mainstream Adoption in 2026." Press release, December 18, 2025. https://investor.visa.com/news/news-details/2025/Visa-and-Partners-Complete-Secure-AI-Transactions-Setting-the-Stage-for-Mainstream-Adoption-in-2026/default.aspx.

Visa Inc. "Visa, BILL and Billtrust Launch First Live Pilot for Trusted AI Agent Payments Between Buyer and Supplier Platforms." Press release, October 20, 2026. https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22856.html.

Warmoth, Brian. "OpenAI Shifts Checkout Plans in Agentic Commerce Strategy." *Digital Commerce 360*, March 6, 2026. https://digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/.

Wiggers, Kyle. "Google Duplex Rolls Out to Pixel Phones in 43 States." *VentureBeat*, March 6, 2019. https://venturebeat.com/ai/google-duplex-rolls-out-to-pixel-phones-in-43-states.

Wikipedia. "Uniform Electronic Transactions Act." Accessed October 2026. https://en.wikipedia.org/wiki/Uniform_Electronic_Transactions_Act.

Williamson, Oliver E. "Credible Commitments: Using Hostages to Support Exchange." *American Economic Review* 73, no. 4 (1983): 519–40 (not verified).

Zapier. "Zapier MCP." Product page. Accessed October 29, 2026. https://zapier.com/mcp.
