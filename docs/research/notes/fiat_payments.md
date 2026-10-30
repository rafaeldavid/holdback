# Fiat, Card-Network and Fintech Rails for Agent Monetary Commitments (as of late October 2026)

*Scope: non-crypto-native ways AI agents pay, authorize, hold funds, or buy for a principal. Notes are organized around four questions for each rail: how a commitment is created, how it is bounded, how it is verified, and how it is unwound. Tags used below: **[VENDOR CLAIM]** marks a company describing its own product with no independent confirmation; **[SECONDARY]** marks an aggregator or trade-press summary of a primary document I could not open; **[FORECAST]**, **[MEASURED]** and **[SURVEY]** mark the type of a number. Verbatim quotes are under 15 words, with at most one per source. The WebSearch budget ran out partway through, and several primary domains were blocked by the fetch allowlist: ap2-protocol.org, Visa's rules PDF, openai.com, blog.cloudflare.com, mastercard.com/us, and blog.google/products/shopping. Some primary claims are therefore cited through secondary summaries and tagged that way.*

## 1. Google's Agent Payments Protocol (AP2): mandates, verifiable credentials, human-present and human-not-present flows, x402 extension, partners, and 2026 status

### Takeaway
AP2 is the most fully specified way to capture a principal's intent as signed evidence. A chain of signed "mandates" (intent → cart → payment, restructured in v0.2 as open and closed Checkout and Payment Mandates) creates a non-repudiable audit trail. Google gave AP2 to the FIDO Alliance on April 28, 2026, alongside Mastercard's Verifiable Intent. As of October 2026 there is still no public AP2 card-rail transaction volume. Production use runs through pilots (PayPal, Mastercard) and through AP2-compatible layers such as UCP, Adyen Agentic and Amex ACE, not through standalone AP2 deployments.

### Cited Findings
**Mechanism (v0.1, September 2025)**
- AP2 launched September 16, 2025. Google defines mandates as tamper-proof, cryptographically signed digital contracts that act as verifiable proof of a user's instructions, signed with verifiable credentials (VCs). Verbatim quote ("How it works" section): "AP2 builds trust by using Mandates—tamper-proof, cryptographically-signed digital contracts." — [Stavan Parikh and Rao Surapaneni, "Powering AI commerce with the new Agent Payments Protocol (AP2)," *Google Cloud Blog*, September 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)
- **Intent Mandate:** records the user's request and gives auditable context. In real-time purchases it comes from the initial request. In delegated tasks the user signs a detailed Intent Mandate upfront with rules such as price limits and timing. **Cart Mandate:** created when the user approves a specific cart, as an unchangeable record of the exact items and price. **Payment Mandate:** the blog post does not define it. It says only that the chain ends by securely linking the payment method to the verified contents of the Cart Mandate. — [Parikh and Surapaneni, *Google Cloud Blog*, Sept. 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)
- **Flows:** *Human present (real-time):* request → Intent Mandate → agent shows cart → user approval signs the Cart Mandate. *Human not present (delegated):* the user pre-signs an Intent Mandate, and once its conditions are met the agent generates the Cart Mandate for the user. — [Parikh and Surapaneni, *Google Cloud Blog*, Sept. 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)
- **Disputes:** the launch post describes no dispute procedure. It claims the intent → cart → payment chain creates a non-repudiable audit trail for authorization, authenticity and accountability. — [Parikh and Surapaneni, *Google Cloud Blog*, Sept. 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)
- **x402 extension:** Google worked with Coinbase, the Ethereum Foundation, MetaMask and others on the "A2A x402 extension," which it describes as production-ready for agent-based crypto payments. — [Parikh and Surapaneni, *Google Cloud Blog*, Sept. 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)
- **Partners at launch:** more than 60 organizations. Named: Adyen, American Express, Ant International, Coinbase, Etsy, Forter, Intuit, JCB, Mastercard, Mysten Labs, PayPal, Revolut, Salesforce, ServiceNow, UnionPay International, Worldpay. Endorsers quoted include Accenture, Adobe, Checkout.com, Deloitte, MetaMask, Okta and Shopee. — [Parikh and Surapaneni, *Google Cloud Blog*, Sept. 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)

**v0.2 and governance transfer (April 2026)**
- On April 28, 2026, Google donated AP2 to the FIDO Alliance and released AP2 v0.2 on GitHub. v0.2 adds "Human Not Present" payments, in which agents execute autonomously from pre-authorized instructions (example: buying limited-run tickets at release). Verifiable Intent, co-developed with Mastercard and AP2-compatible, was donated at the same time. Verbatim (first body paragraph): "ensures AP2 remains platform-agnostic and community-led." — [Stavan Parikh, "We're donating Agent Payments Protocol to the FIDO Alliance…," *The Keyword (Google blog)*, April 28, 2026](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/)
- FIDO set up two groups. The **Agentic Authentication Technical Working Group** is chaired by members from CVS Health, Google and OpenAI, with vice-chairs from Amazon, Google and Okta. The **Payments Technical Working Group** is chaired by members from Mastercard and Visa. No draft-spec timeline was announced. PayPal's Rakan Khalid is quoted: "agents can transact only within authorized limits." — ["FIDO Alliance forms working groups to lock down AI agent payments," *PPC Land*, April 2026](https://ppc.land/fido-alliance-forms-working-groups-to-lock-down-ai-agent-payments/) [SECONDARY, relaying the FIDO press release]
- The Payments TWG will develop specifications for agent-initiated commerce, building on AP2 and Verifiable Intent. FIDO CEO Andrew Shikiar said people must "trust that these actions are secure, authorized and truly reflect their intent." — ["Google and Mastercard Contribute Agentic Commerce Standards to FIDO Alliance," *PYMNTS*, April 28, 2026](https://www.pymnts.com/artificial-intelligence-2/2026/google-and-mastercard-contribute-agentic-commerce-standards-to-fido-alliance/)
- FIDO's own post gives no adopter names or figures. It says the aim is to "accelerate adoption across the payments ecosystem." — ["Google donates Agent Payments Protocol to FIDO Alliance," *FIDO Alliance*, April 29, 2026](https://fidoalliance.org/google-donates-agent-payments-protocol-to-fido-alliance/?cst)
- **v0.2 mandate mechanics as summarized by a secondary source (not verified against ap2-protocol.org, which was blocked):**
  - Mandates are **SD-JWTs** with selective disclosure.
  - *Direct mode (human present):* the merchant returns a merchant-signed Checkout JWT. A non-agentic "Trusted Surface" renders the closed mandates and collects the user's signature. The agent then gets a payment credential from the Credential Provider.
  - *Autonomous mode (human not present):* the user pre-signs **open** Checkout and Payment Mandates carrying constraints (merchants, line items, budget, payees, amount and date ranges, recurrence). These must include the agent's public key in a `cnf` claim. At checkout the agent signs **closed** mandates with its own key, and verifiers check them against the open-mandate constraints.
  - A `checkout_hash` binds both mandates to a single checkout.
  - The user's private key sits on the user's device or in the credential provider's HSM.
  - Schema IDs: `mandate.checkout.1`, `mandate.payment.1`, `mandate.checkout.open.1`, `mandate.payment.open.1`.
  - — ["AP2 (Agent Payments Protocol) Explained," *Eco Support Center*, ca. April 2026](https://eco.com/support/en/articles/14845479-ap2-agent-payments-protocol-explained) [SECONDARY; Eco is a payments vendor]

**Production status (2025–2026)**
- The PayPal Conversational Commerce Agent on Google Cloud (announced October 27, 2025, with PayPal as credential provider) is described as the most fully wired AP2 production flow. Also announced October 27, 2025: a pilot of Mastercard's Agent Pay Acceptance Framework inside PayPal's wallet. The same source says these pilots have produced no public transaction volumes and that card-rail proof points are still pending. — [*Eco Support Center*, ca. April 2026](https://eco.com/support/en/articles/14845479-ap2-agent-payments-protocol-explained) [SECONDARY]
- Restatement: AP2 was donated to FIDO in April 2026; standard card interchange applies with no protocol fee (no source given for the fee claim); samples are on GitHub (google-agentic-commerce/AP2). — ["Agent Payment Protocols Compared: AP2, ACP & x402 in Production (May 2026)," *OpenHermit Blog*, May 17, 2026](https://www.openhermit.com/blog/agent-payment-protocols-compared) [SECONDARY]
- AP2 shows up mainly as a compatibility target for other products. Google's UCP developer page lists AP2 as a compatible standard. — ["Getting started with Universal Commerce Protocol on Google," *Google for Developers*, accessed Oct. 2026](https://developers.google.com/merchant/ucp). Adyen Agentic supports ACP, UCP and AP2. — ["Adyen Agentic" press release, *Adyen*, June 16, 2026](https://www.adyen.com/press-and-media/adyen-agentic). Amex is "contributing to" AP2 and calls ACE protocol-agnostic. — ["American Express Launches ACE Developer Kit…," *Stellagent*, April 2026](https://stellagent.ai/insights/amex-ace-agentic-commerce-developer-kit) [SECONDARY]
- Several PSPs are reportedly shipping implementations that emit AP2 Mandates as Verifiable Intent artifacts. As of April 2026, Verifiable Intent was in pilot. — ["Mastercard Agent Pay Explained: Agentic Tokens and Verifiable Intent…," *Stellagent*, April 9, 2026](https://stellagent.ai/insights/mastercard-agent-pay-agentic-tokens) [SECONDARY]
- One vendor writes that AP2's crypto (x402) extension is production-ready while broader card-based implementation is "still maturing." — ["Agentic payments protocols compared," *Crossmint*, March 12, 2026](https://www.crossmint.com/learn/agentic-payments-protocols-compared) [VENDOR]

### Inferences
- The source descriptions suggest v0.2 renamed and restructured the v0.1 triad. The **Intent Mandate's role passes to "open" Checkout/Payment Mandates** that bind an agent key (`cnf`). The **Cart Mandate becomes the closed Checkout Mandate**, tied to a merchant-signed checkout. In autonomous mode the agent, not the human, signs the closed mandate. This is the key change for "agent-to-agent commitment" theory: the human signs a bounded delegation, and the agent signs each specific commitment under it. It needs checking against the v0.2 spec text.
- AP2 creates *evidence* of intent. It does not create *liability rules*. No network rule I found says an AP2 mandate shifts chargeback liability. Its value in disputes depends on whether networks (e.g., through Verifiable Intent / Mastercard Agentic Disputes) accept the mandates as compelling evidence.
- The FIDO handover and Visa co-chairing the FIDO Payments TWG suggest AP2/Verifiable Intent may become the cross-network intent-evidence format. Product rails (ACP, UCP, TAP) would sit on top.

### Gaps
- No public AP2 production transaction counts or named live merchants doing card payments under AP2. Eco explicitly says none were published as of ~April 2026.
- Could not open the AP2 v0.2 specification (ap2-protocol.org blocked) to verify the Payment Mandate fields, how the Payment Mandate is handed to networks/issuers, or the exact dispute-signal fields.
- No FIDO draft-spec timeline.

## 2. OpenAI and Stripe: Agentic Commerce Protocol (ACP), ChatGPT Instant Checkout, Shared Payment Tokens, and Stripe's 2026 agentic stack

### Takeaway
ACP and Stripe's Shared Payment Token (SPT) bound a commitment at the credential level. An agent-issued token is scoped to one seller and carries a currency, a maximum amount and an expiry. The merchant stays merchant of record and owns refunds and chargebacks. ChatGPT Instant Checkout, the flagship ACP deployment launched September 29, 2025, was scaled back in March 2026 ("moving to Apps") after weak uptake: about a dozen to ~30 Shopify merchants went live, and reported conversion was under 1%. Stripe has since generalized SPTs: they can carry Visa/Mastercard agentic network tokens and BNPL from March 2026, power the Machine Payments Protocol (MPP), and plug into Google AI Mode/Gemini and Meta. Stripe has published no agentic transaction volume.

### Cited Findings
**Original design (September 2025)**
- Instant Checkout launched September 29, 2025. The user asks for products in ChatGPT, and a Stripe-powered checkout appears inline (Link supported). ChatGPT sends the order to the merchant backend through ACP. The merchant accepts or declines, charges the payment, handles sales tax, and manages fulfillment and returns. US Etsy sellers went live first. Over a million Shopify merchants were listed as coming soon (Glossier, Vuori, Spanx, SKIMS). — ["Stripe powers Instant Checkout in ChatGPT and releases Agentic Commerce Protocol codeveloped with OpenAI," *Stripe Newsroom*, September 29, 2025](https://stripe.com/newsroom/news/stripe-openai-instant-checkout)
- **SPT as originally described:** Stripe issues the SPT once the buyer completes payment. It lets ChatGPT start a transaction without exposing the buyer's credentials. Each token is limited to one merchant and one cart total. The merchant can process the payment through Stripe *or another provider* and still use Stripe risk scores. Verbatim (Will Gaybrick, Stripe president of technology and business): "Stripe is building the economic infrastructure for AI." — [*Stripe Newsroom*, Sept. 29, 2025](https://stripe.com/newsroom/news/stripe-openai-instant-checkout)
- **SPT object (API reference):** `SharedPaymentGrantedToken` has the following fields.
  - `usage_limits` {`currency`, `max_amount`, `expires_at`}
  - `usage_details.amount_captured`
  - `agent_details.network_business_profile`, identifying the issuing agent
  - `risk_details`, `payment_method_details` (brand, last4, funding, wallet), and `shared_metadata`
  - `deactivated_at`, plus `deactivated_reason` ∈ {`consumed` (amount limit hit), `expired`, `resolved` (by seller), `revoked` (by issuer)}
  - Verbatim (deactivated_reason enum): "`revoked` indicates that this token has been revoked by the issuer."
  - — ["The Shared Payment Granted Token object," *Stripe API Reference*, accessed October 2026](https://docs.stripe.com/api/shared-payment/granted-token/object)
- Separate API objects exist for the agent side (`SharedPaymentIssuedToken` create and revoke) and the seller side. — [*Stripe API Reference: Create a SharedPaymentIssuedToken*](https://docs.stripe.com/api/shared-payment/issued-token/create); [*Revoke a SharedPaymentIssuedToken*](https://docs.stripe.com/api/shared-payment/issued-token/revoke)
- The ACP delegated-payment spec puts settlement, refunds and chargebacks with the merchant and its PSP. The agent platform is not merchant of record. — [Karolina Skwira, "Agent chargeback rules: no network fix before holiday 2026," *ShopAppy*, August 24, 2026 (updated Sept. 13, 2026)](https://shopappy.com/payments/card-networks/agent-chargeback-rules-holiday-2026) [SECONDARY]

**Pullback (March 2026)**
- Digital Commerce 360 (citing The Information) reported OpenAI sidelining Instant Checkout in favor of merchants' ChatGPT apps and refocusing on discovery. An OpenAI spokesperson described ACP as the infrastructure connecting users to merchants across the whole shopping journey. Retailer apps cited: Target, The Knot, DoorDash, Instacart. Verbatim (OpenAI spokesperson): "Instant Checkout is moving to Apps, where purchases can happen more seamlessly." — [Brian Warmoth, "OpenAI shifts checkout plans…," *Digital Commerce 360*, March 6, 2026](https://digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/)
- Forrester: The Information reported about a dozen Shopify merchants live, while Shopify had told Forrester a month earlier that the number was closer to 30. In Forrester's March 2026 survey (US, UK, Canada answer-engine users), buying inside an answer engine was the least-adopted use case. Verbatim: "Commerce isn't just checkout, and buying directly in answer engines was unproven." — [Emily Pfeiffer and Sucharita Kodali, "What It Means That The Leader In 'Agentic Commerce' Just Pulled Back," *Forrester Blogs*, March 7, 2026](https://www.forrester.com/blogs/what-it-means-that-the-leader-in-agentic-commerce-just-pulled-back)
- Reported buy-button conversion was below 1%, against a 3–4% industry average (attributed to The Information). Instacart was the only retailer supporting direct checkout inside a ChatGPT app. Shopify said it would not build a ChatGPT checkout app. Walmart called the original experience "rudimentary" and planned to put its Sparky agent into ChatGPT with full cart and checkout. — [Paul Drecksler, "OpenAI Pivots From Instant Checkout to an App-Based Shopping Model Inside ChatGPT," *Shopifreaks*, March 12, 2026](https://www.shopifreaks.com/openai-pivots-from-instant-checkout-to-an-app-based-shopping-model-inside-chatgpt/) [SECONDARY]
- "Roughly 12" merchants went live, and as of February 2026 OpenAI had not set up systems to collect and remit state sales tax. — [Arjun Bhargava, "OpenAI Scales Back ChatGPT Checkout…," *Rye Blog*, March 5, 2026](https://rye.com/blog/openai-chatgpt-checkout-agentic-commerce) [VENDOR — Rye sells competing checkout infrastructure]
- An OpenAI post ("Powering Product Discovery in ChatGPT," March 2026) reportedly said Instant Checkout did not offer enough flexibility. ACP continues for discovery: Target, Sephora and The Home Depot integrated it for discovery, and payments remain technically supported but are not offered in ChatGPT. — ["ChatGPT Instant Checkout is dead. Long live AI shopping," *Exploding Topics*, updated May 18, 2026](https://explodingtopics.com/blog/agentic-commerce-protocol) [SECONDARY]
- **Conflicting claim:** OpenHermit (May 17, 2026) says "over 1 million Shopify merchants are live in ChatGPT Instant Checkout," citing an April 2026 OpenAI page — [*OpenHermit Blog*](https://www.openhermit.com/blog/agent-payment-protocols-compared). Elogic cites a February 16, 2026 OpenAI "Buy it in ChatGPT relaunch" — ["ChatGPT Commerce & Agentic Shopping Statistics 2026," *Elogic*](https://elogic.co/blog/chatgpt-commerce-statistics/). Both are **contradicted** by Forrester/The Information (~12–30 live) and by Exploding Topics, which calls the 1M figure a plan that "did not materialize." Treat "1M+ live" as a reach claim, not a deployment count.
- **OpenAI merchant fee of 4%:** this appears only in secondary sources (OpenHermit, Elogic, Launchcodex) and none links an OpenAI primary document. Unverified.

**Stripe's 2026 generalization**
- Stripe's Agentic Commerce Suite launched December 11, 2025; named adopters were Coach, Kate Spade, URBN, Etsy, Wix and Squarespace. From **March 3, 2026**, SPTs can carry **Mastercard or Visa agentic network tokens**, and Stripe may use Mastercard Agent Pay, Visa Intelligent Commerce and the Amex ACE Kit. Affirm and Klarna can also be carried. SPTs are available in the US, Canada and select European countries. **MPP** launched March 18, 2026. Stripe's annual letter (February 24, 2026) reported $1.9T processed by businesses on Stripe in 2025 (+34%). On October 13, 2026, John Collison said agentic stats "went vertical" in September 2026 but gave no figures (Payments Dive, October 15, 2026). — ["Stripe Agentic Commerce: ACP, Shared Payment Tokens, AI Checkouts," *BankingNewsAI*, accessed October 2026](https://www.bankingnewsai.com/fintech/stripe/agentic-commerce) [SECONDARY aggregator citing Stripe primaries]
- At Stripe Sessions (April 29, 2026):
  - Agents can pay over MPP in stablecoins or fiat (cards, Klarna, Affirm) using SPTs with the Payment Intents API.
  - A **Link agent wallet** offers spending approvals and purchase visibility.
  - **Issuing for agents (preview)** provides single-use virtual cards.
  - **Agent guardrails (preview)** cover agent identities, scope rules and approval flows.
  - Agent-ready Treasury accounts require human confirmation for key actions.
  - Partnerships: Meta (native checkout in Facebook ads) and Google (AI Mode and Gemini via UCP, coming soon).
  - Stablecoin-backed accounts are on the roadmap (Q4 private preview).
  - No agentic volume was disclosed.
  - Verbatim (Payments › Agentic commerce): "You can now sell through AI agents by uploading your product catalog."
  - — ["Everything we announced at Sessions 2026," *Stripe Blog*, April 29, 2026](https://stripe.com/blog/everything-we-announced-at-sessions-2026)
- MPP was co-developed by Stripe and Tempo. It uses a "sessions" model in which agents pre-authorize a spending limit and stream micropayments. Fiat runs through SPTs. Visa reportedly extended MPP to card payments. — [*Crossmint*, March 12, 2026](https://www.crossmint.com/learn/agentic-payments-protocols-compared) [VENDOR; the article is dated before the MPP launch it describes, so treat the timeline with caution]

### Inferences
- An SPT is a **bounded, revocable, seller-scoped authorization object**. Commitment is created by issuance (agent/platform), bounded by `usage_limits`, verified by Stripe risk signals and agent profile, and unwound by `revoked`/`expired`, with post-capture refunds and disputes handled by the merchant. It is the closest fiat analogue to a cryptographic spending allowance, except that enforcement depends on the platform.
- The Instant Checkout retreat shows the bottleneck was merchant operations (tax, catalog, order management) and user behavior, not the payment primitive. The primitive survived and spread (MPP, Google, Meta). The "checkout inside the chatbot" product did not.
- Allowing network agentic tokens inside SPTs (March 2026) layers two controls: the platform-level SPT cap and the network-level token scope. That gives two separate points where a transaction can be refused or revoked.

### Gaps
- No Stripe, OpenAI or Shopify figures on ACP/SPT transaction count, GMV, dispute rates or refund rates.
- Could not open the OpenAI primary posts ("Buy it in ChatGPT," "Powering Product Discovery") to confirm the fee or the February 2026 relaunch claim (openai.com blocked).
- No data on whether ChatGPT app-based checkouts (Instacart, Walmart Sparky) use ACP/SPT or merchant-native rails.

## 3. Card networks, wallets, PSPs and platforms: what is live and what is still pilot

### Takeaway
Both major networks now enforce agent spending limits **inside the network token**: Visa Intelligent Commerce tokens and Mastercard Agentic Tokens. Both register and verify agents (Visa Trusted Agent Protocol/Agentic Directory; Mastercard Agent Pay Acceptance Framework). Both have completed live transactions in multiple regions: Mastercard network-enabled all European issuers on June 2, 2026, and Visa reported live European merchant purchases with 30+ issuers on July 2, 2026. Neither has published transaction counts beyond "hundreds" (Visa, December 2025). Amex is the only network offering a consumer guarantee against agent error (April 14, 2026). PSP products (Adyen Agentic, Visa Intelligent Commerce Connect) were in limited or pilot availability in mid-2026. On the platform side, Amazon (Buy for Me, auto-buy), Perplexity/PayPal Instant Buy and Google UCP checkout are live in the US in limited form.

### Cited Findings
**Visa (Visa Intelligent Commerce, Trusted Agent Protocol, Connect, rules)**
- December 18, 2025:
  - Visa reported "hundreds" of agent-initiated transactions [MEASURED, qualitative].
  - Partner counts: 100+ partners overall, 30+ building in the VIC sandbox, 20+ agents and enablers integrating directly.
  - US pilot partners: Skyfire with Consumer Reports; Nekuda with Gensmo, Fabrique, Rye, Henry Labs, Price.com and Honeylove; PayOS with BeyondStyle and Jomashop; Ramp (B2B). Aldar runs UAE real-estate fees. Akamai supports TAP.
  - TAP was introduced in October 2025 with 10+ partners.
  - Forecast: millions of consumers using agents to buy by holiday 2026 [FORECAST].
  - Verbatim (Rubail Birwadker, SVP Growth Products): "AI agents won't just assist your shopping—they will complete your purchases."
  - — ["Visa and Partners Complete Secure AI Transactions, Setting the Stage for Mainstream Adoption in 2026," *Visa Investor Relations*, December 18, 2025](https://investor.visa.com/news/news-details/2025/Visa-and-Partners-Complete-Secure-AI-Transactions-Setting-the-Stage-for-Mainstream-Adoption-in-2026/default.aspx)
- **Visa Intelligent Commerce Connect** (unveiled April 8, 2026) is a single integration through the Visa Acceptance Platform covering payment initiation, tokenization, spend controls, authentication and PCI orchestration. It supports four protocols (TAP, MPP, ACP, UCP) and both Visa and non-Visa cards. Pilot partners: Aldar, AWS, Diddo, Highnote, Mesh, Payabli, Sumvin. Broader rollout is planned for 2026. Verbatim (Visa announcement as quoted): "single integration into agentic commerce." — ["Visa opens one integration for AI agent payments," *TechInformed*, April 9, 2026](https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/)
- **Visa dated timeline** (primary sources as listed by the aggregator):
  - October 14, 2025: TAP introduced, with signed intent and payment data passed to merchants.
  - November 6, 2025: the FY2025 10-K flagged that AI rules "may create uncertainty around compliance obligations and potential liability exposure."
  - February 16, 2026: DBS becomes the first APAC VIC issuer pilot.
  - March 17, 2026: Agentic Ready launches in Europe.
  - April 29, 2026: Agentic Ready reaches 85+ partners in APAC and LatAm.
  - June 10, 2026: OpenAI collaboration and Agentic Directory announced.
  - **July 2, 2026:** AI agents complete purchases on independent European merchant sites in live environments with 30+ issuers (lastminute.com, Frasers, Cleverbridge, BrickDepot).
  - September 17, 2026: Visa, Mastercard and Ant International begin work on a "Know Your Agent" framework (American Banker).
  - — ["Visa Agentic Commerce," *BankingNewsAI*, accessed October 2026](https://www.bankingnewsai.com/fintech/visa/agentic-commerce) [SECONDARY aggregator; primary/secondary flags as given there]
- **First live B2B pilot (October 20, 2026):**
  - BILL's payment agent, registered through TAP and the Agentic Directory, pays supplier invoices through Billtrust portals.
  - It uses tokenized credentials instead of shared portal logins.
  - Each payment is tied to a specific invoice, and the agent executes only payments the buyer has already approved.
  - No counts were disclosed.
  - Verbatim (Mark Nelsen, SVP Commercial & Money Movement, Visa): "Businesses should not have to choose between automation and control when making payments."
  - — ["Visa, BILL and Billtrust Launch First Live Pilot for Trusted AI Agent Payments Between Buyer and Supplier Platforms," *Visa Newsroom*, October 20, 2026](https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22856.html)
- The companion October 21, 2026 release adds Visa Commercial Payment Controls (spend, MCC, location and timing parameters; available to eligible issuers) and a Juniper Research forecast of $14.6T B2B virtual-card volume by 2029 [FORECAST]. Verbatim (Darren Parslow, global head of Visa Commercial Solutions): "designed to help them do that with the data, security and controls." — ["Visa Announces Enhanced Capabilities That Can Bring Trust and Control to the Future of Business Payments," *Visa Newsroom*, October 21, 2026](https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22866.html)
- **TAP mechanism (secondary):**
  - Agents sign requests with RFC 9421 HTTP Message Signatures (`Signature-Input`/`Signature`), bound to the merchant domain and the operation (browse or pay), with timestamps and a session ID for replay protection.
  - An "Agentic Consumer Recognition Object" checks for an existing account.
  - Merchants receive consented identifiers, including Payment Account References.
  - Issuer-side SCA uses Visa Payment Passkeys.
  - Cloudflare and Akamai embed the signals.
  - — ["Trusted Agent Protocol Explained," *US Tech Automations*, September 2, 2026](https://ustechautomations.com/resources/blog/trusted-agent-protocol-explained-what-it-changes) [SECONDARY]
- Visa's survey with Morning Consult (April 2, 2026) found 38% of US adults comfortable with AI completing a purchase, and 60% would not let AI spend *any* amount without approval [SURVEY]. — [*TechInformed*, April 9, 2026](https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/)

**Mastercard (Agent Pay, Agentic Tokens, Verifiable Intent, Agent Pay for Machines)**
- **Dated timeline** (P = Mastercard primary or SEC filing, S = secondary, as flagged by the aggregator):
  - April 29, 2025: Agent Pay launches with Agentic Tokens and agent registration (P).
  - September 30, 2025: Agent Pay works on ChatGPT Instant Checkout; Citi and U.S. Bank cardholders enabled; all US cardholders "due" by mid-November 2025 (P).
  - October 14, 2025: Agent Pay Acceptance Framework (P).
  - October 30, 2025: CEO Miebach says the first agentic transaction ran in Q3 2025 (S, earnings call).
  - November 19, 2025: first non-US transaction, in the UAE (P).
  - March 2, 2026: Santander live agent payment in Spain, in a controlled environment (P).
  - March 27, 2026: Hong Kong (P).
  - April 7, 2026: Singapore and Malaysia (S).
  - **June 2, 2026: all European issuers enabled at network level; first production payment in the Netherlands with Worldline and ING** (P).
  - September 30, 2026: "Trust for agentic commerce" white paper, Agent Pay Trust Framework, and a **transaction probability score** entering US testing using Cloudflare data and Skyfire verification (P).
  - October 20, 2026: Agent Pay for Machines early access on x402 (S).
  - No transaction counts or volumes are published.
  - Verbatim (Miebach, Q2 2026 call, relayed): "the chargeback process can kick back in."
  - — ["Mastercard Agentic Commerce: Agent Pay Rollout, Partners, Disputes," *BankingNewsAI*, accessed October 2026](https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce) [SECONDARY aggregator]
- The LAC rollout was announced December 3, 2025, with issuers to be enabled by February 2026. Mechanism: **Agentic Tokens**, described as dynamic digital credentials, with verification, traceability and dispute support. Agents act only within consumer-set permissions and limits. Authentication uses tokenized credentials plus **payment passkeys**. The Acceptance Framework requires agent registration and verification before transacting. Partners: Bemobi, Checkout.com, Davivienda, Evertec, Getnet, Inti, MagaluPay, Yuno. Verbatim (Guida Sousa, SVP Digital Payments LAC): "Agentic payments mark a new chapter in the evolution of commerce." — ["Mastercard unveils Agent Pay in Latin America and the Caribbean…," *Mastercard Newsroom*, December 3, 2025](https://www.mastercard.com/news/latin-america/en/newsroom/press-releases/pr-en/2025/december/mastercard-unveils-agent-pay-in-latin-america-and-the-caribbean/)
- Agentic Tokens are issued per agent, so one card can have separate tokens for separate agents. Scope (limits, categories) is set at issuance and enforced by the network. A user can revoke one agent's token without affecting the card. Tokens extend MDES. — [*Stellagent*, April 9, 2026](https://stellagent.ai/insights/mastercard-agent-pay-agentic-tokens) [SECONDARY]
- **Verifiable Intent** (announced March 5, 2026) is an open-source framework. It links consumer identity, specific instructions and transaction outcome into one tamper-resistant record for disputes, using Selective Disclosure. It builds on FIDO, EMVCo, IETF and W3C specs and is designed to work alongside AP2 and UCP. Commitments came from Google, Fiserv, IBM, Checkout.com, Basis Theory and Getnet. Verbatim (Pablo Fourez, CDO): "As autonomy increases, trust cannot be implied." — ["Mastercard Unveils Open Standard to Verify AI Agent Transactions," *PYMNTS*, March 5, 2026](https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/)
- **Agent Pay for Machines** (June 10, 2026):
  - Each agent gets an Agentic Token bound to a consent policy, merchant scope and spending limit.
  - The network enforces the policy at authorization, so out-of-policy spend fails before settlement.
  - Human-granted permissions are logged on Polygon, Solana and Base.
  - One layer covers cards, bank accounts and stablecoins.
  - 30+ partners, including Adyen, Checkout.com, Stripe, Global Payments, Coinbase, Cloudflare, Skyfire, Nevermined, Crossmint, Basis Theory, Catena, Tempo and Ant International.
  - No volume figures.
  - Verbatim (article's own line): "move money across the Mastercard network without human approval on every transaction."
  - — ["Mastercard's Agent Pay for Machines Goes Live with 30+ Partners…," *Genfinity*, June 10, 2026](https://genfinity.io/2026/06/10/mastercard-agent-pay-for-machines-launch/) [SECONDARY; primary release at mastercard.com/us was blocked]
- Mastercard's Signals report "Encoding Trust" (August 3, 2026) treats liability and dispute resolution as open problems needing shared industry approaches. It describes agentic tokens carrying task-specific limits (agent, merchant, category, amount, timeframe, usage rules) and reports ~10% of consumers willing to let an agent complete a purchase autonomously [SURVEY]. — [Skwira, *ShopAppy*, Aug. 24, 2026](https://shopappy.com/payments/card-networks/agent-chargeback-rules-holiday-2026) [SECONDARY]

**American Express**
- On April 14, 2026, Amex launched the **ACE Developer Kit**, available to select developers. It has five services:
  - agent registration
  - account enablement (Card Members register cards for agentic use)
  - **intent intelligence** (captures purchase intent for authentication, authorization and dispute support)
  - tokenized payment credentials
  - **cart context** sharing for validation and dispute investigation
  - **Agent Purchase Protection** covers eligible customers against charges arising from a *registered* agent's error. It applies when the Card Member authorized the agent and the agent transmitted *authenticated purchase intent* to Amex. No effective date or exclusions were published.
  - — [Iulia Musat, "American Express rolls out agentic commerce kit and agent protection," *The Paypers*, April 15, 2026](https://thepaypers.com/payments/news/american-express-launches-ace-developer-kit-and-agent-purchase-protection)
- Partners: Adyen, Fiserv, Forter, Global Payments, PayPal and Stripe, with merchants Delta, Expedia and Hilton. Only US-issued proprietary cards were eligible at launch, and rollout starts in travel and hospitality. "Thousands" of AI-assisted transactions were completed in pilots [VENDOR CLAIM]. Verbatim (Luke Gebb, EVP Global Innovation): "To date there have probably been as many press releases as transactions." — [*Stellagent*, April 2026](https://stellagent.ai/insights/amex-ace-agentic-commerce-developer-kit) [SECONDARY]

**PayPal**
- On October 28, 2025, PayPal announced **Agent Ready**, letting existing PayPal merchants accept agent-initiated transactions, with rollout in early 2026. **Store Sync** pushes catalog, inventory and fulfillment to AI platforms. Transactions name the seller as merchant of record. Initial integrations: Wix, Cymbio, Commerce/BigCommerce/Feedonomics and Shopware. Verbatim (Michelle Gill, PayPal): "AI is driving the next wave of innovation in how payments are made." — [Mark Brohan, "PayPal agentic commerce AI-driven shopping services," *Digital Commerce 360*, October 28, 2025](https://www.digitalcommerce360.com/2025/10/28/paypal-agentic-commerce-ai-driven-shopping-services/)
- **Perplexity Instant Buy** (December 2025) makes PayPal merchants discoverable in Perplexity and lets users check out in chat. PayPal handles processing, identity, fraud and buyer and seller protection, and the brand stays merchant of record. Initial brands: Abercrombie & Fitch, Ashley Furniture, Fabletics, Adorama, Newegg. Verbatim (Perplexity): "capture high-intent shoppers at the moment of discovery." — [Paul Drecksler, "PayPal and Perplexity deepen their partnership with Instant Buy," *Shopifreaks*, December 1, 2025](https://www.shopifreaks.com/paypal-and-perplexity-deepen-their-partnership-with-instant-buy/)
- Perplexity's earlier "Shop Like A Pro" checkout (November 2024) was later replaced by a free discovery experience. — [*Exploding Topics*, May 2026](https://explodingtopics.com/blog/agentic-commerce-protocol) [SECONDARY]
- PayPal is reported to be building its own ACP server. — [*Crossmint*, March 12, 2026](https://www.crossmint.com/learn/agentic-payments-protocols-compared) [VENDOR]

**PSPs: Adyen, Worldpay, Checkout.com**
- **Adyen Agentic** (June 16, 2026) has three layers: Agentic Feed, Agentic Cart and Agentic Payments (authentication, token portability, merchant-of-record preservation, risk). It supports ACP, UCP and AP2 and is compatible with Meta AI checkout. Early participants: Amex, Mastercard, Salesforce, Visa, ESW, Scheels, Sézane, SharkNinja. Limited availability for US enterprise merchants. Verbatim (Karan Katyal, Global Head of Agentic Commerce): "Every new agentic surface asks merchants to rebuild from scratch." — [*Adyen*, June 16, 2026](https://www.adyen.com/press-and-media/adyen-agentic)
- **Checkout.com** adopted ACP in November 2025. — ["Checkout.com agentic commerce strategy," *Stellagent*, January 17, 2026](https://stellagent.ai/insights/checkout-com-agentic-commerce-strategy) [SECONDARY]. It is also a Mastercard LAC Agent Pay partner (Dec. 2025), a Verifiable Intent supporter (Mar. 2026) and an AP4M partner (June 2026); see the sources above.
- **Worldpay** is an AP2 launch partner (Google, Sept. 2025). A July 2026 Worldpay analysis reportedly says network-authenticated agent transactions follow existing tokenized-transaction rules. — [Dan Moshkovich, "AI Agent Chargeback Liability…," *Chargeflow*, July 7, 2026](https://www.chargeflow.io/blog/ai-agent-chargeback-liability) [SECONDARY]
- The first European production agentic payment, in the Netherlands, ran with **Worldline** and ING, not Worldpay (June 2026). — [*BankingNewsAI* Mastercard page](https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce); see also ["AI Commerce News Digest (June 17, 2026)," *Stellagent*](https://stellagent.ai/insights/ec-ai-news-digest-2026-06-17)

**Platforms: Google, Amazon**
- **Google UCP** was announced January 11, 2026 at NRF. Co-developers named: Shopify, Walmart, Etsy. Verbatim (Liz Miller, Constellation): "offers any merchant a means to be discovered on a Google surface." — ["Google's Universal Commerce Protocol Drives AI Shopping," *AI Business*, January 12, 2026](https://aibusiness.com/agentic-ai/google-s-universal-commerce-protocol)
- On Google's developer page:
  - UCP is "a new open standard that unifies digital commerce."
  - Native checkout in AI Mode and Gemini, plus an iframe embedded option for approved merchants.
  - Tokenized payments through "payment handlers."
  - The merchant remains merchant of record.
  - Waitlist only; the Gemini app is listed as coming soon.
  - — [*Google for Developers*, accessed October 2026](https://developers.google.com/merchant/ucp)
- More secondary detail on UCP:
  - Co-developers also include Target and Wayfair.
  - 20+ endorsers, including Mastercard, Stripe, Visa, Adyen, Home Depot and Zalando.
  - The native path uses Google Pay with cards in Google Wallet.
  - Available to select US merchants as of April 2026.
  - — ["Sell directly in Google AI Mode: A merchant's guide to the Universal Commerce Protocol," *Launchcodex*, April 21, 2026](https://launchcodex.com/blog/web-digital-infrastructure/universal-commerce-protocol-merchant-guide/) [SECONDARY]
- Stripe's Agentic Commerce Suite was extended to AI Mode and Gemini on April 29, 2026, with named builders Kate Spade, Best Buy and Coach. — [*BankingNewsAI* Stripe page](https://www.bankingnewsai.com/fintech/stripe/agentic-commerce) [SECONDARY]
- **Amazon:**
  - Alexa for Shopping (all US customers) can buy at a target price "using your default payment method."
  - **Buy For Me** completes purchases from other merchants' stores using the customer's Amazon payment and shipping details. The page does not say how credentials are passed to the third-party merchant.
  - — ["How to use Amazon's shopping AI assistant," *About Amazon*, February 11, 2026 (modified Sept. 1, 2026)](https://www.aboutamazon.com/news/retail/how-to-use-amazon-shopping-ai-assistant)
- Rufus **Auto Buy** (late November 2025, all US Prime members): the shopper ticks "Auto Buy" for a price target and has 24 hours to cancel before shipping. Rufus had 250M active customers in 2025. — ["Amazon edges deeper into agentic commerce with Rufus 'Auto Buy' function," *eMarketer*, ca. Nov. 2025](https://www.emarketer.com/content/amazon-edges-deeper-agentic-commerce-rufus-auto-buy)

### Inferences
- A **network-level spending envelope** has emerged. The agent token encodes merchant, amount, category and time constraints, and the network declines out-of-scope authorizations. That moves the "bounding" of a commitment from the agent platform to the issuer/network, the same place card-on-file and MIT controls already live.
- "Live" mostly means *first transactions completed with real money in controlled settings* (Santander Spain, ING Netherlands, the BILL pilot). Visa's "hundreds" (Dec. 2025) and Amex's "thousands" (Apr. 2026) are the only quantities, and Gebb's quote suggests volumes are still trivial.
- Most deployed consumer flows keep the *human-present confirm step* (Amazon's 24-hour cancel window, Perplexity Instant Buy, UCP checkout). Fully autonomous, human-not-present card purchases remain mostly pilots, plus price-triggered auto-buy inside closed ecosystems like Amazon.
- Amex can offer a guarantee because it is a closed loop: it is issuer, network and often acquirer. Visa and Mastercard would need four-party rule changes, which ShopAppy argues are unlikely before the April 2027 cycle.

### Gaps
- No Visa, Mastercard, Amex, PayPal, Adyen or Google figures on agentic transaction counts, GMV or approval rates for 2026.
- Could not verify Google's November 2025 "agentic checkout" in AI Mode (price-tracking auto-buy via Google Pay); the primary blog was blocked.
- Could not verify whether Mastercard completed enablement of all US cardholders. Sources give only "due" dates.
- PayPal in ChatGPT: search results suggest an October 2025 PayPal–OpenAI ACP announcement, but I could not fetch it. Its status after the March 2026 pullback is unknown.
- Worldpay's own agentic product details were not found.

## 4. Agents paying for content: Cloudflare pay-per-crawl, HTTP 402, Web Bot Auth / signed agents, TollBit

### Takeaway
Cloudflare's Pay Per Crawl (private beta since July 1, 2025) is a working HTTP 402 price-negotiation loop. Price headers are cryptographically bound to Web Bot Auth signatures, and Cloudflare aggregates billing as intermediary. It was still in closed beta about 13 months later, and in July 2026 Cloudflare began moving to per-answer or "pay per use" payment (Ceramic.ai, You.com). No aggregate publisher payout figures exist. Web Bot Auth (RFC 9421 signatures) has become the agent-identity layer reused by Visa TAP and Mastercard. TollBit measures a widening scrape-to-return gap but publishes no paid-access volume.

### Cited Findings
- **Pay Per Crawl mechanism:**
  - Per-crawler actions: Allow, Charge or Block.
  - An unsigned GET gets **402** with a `crawler-price` header.
  - *Reactive* path: the crawler retries with a signed request carrying `crawler-exact-price`. *Proactive* path: it sends `crawler-max-price` on the first request.
  - Success returns 200 with `crawler-charged`.
  - Only successful responses are charged, and re-crawls are charged again.
  - **Cloudflare aggregates charges, bills the crawler and pays the publisher**, so the two sides have no direct billing relationship.
  - Web Bot Auth uses Ed25519 keys and RFC 9421 signatures, with a key directory at `/.well-known/http-message-signatures-directory` and headers `Signature-Agent`, `Signature-Input` (`tag="web-bot-auth"`) and `Signature`.
  - Cloudflare does not validate nonces, so replay protection depends on the `expires` window. Cloudflare guidance, verbatim: "a minute is often sufficient."
  - Status: still closed beta about 13 months after launch. July 2026 announced a shift to "Pay Per Use." A Monetization Gateway uses Coinbase x402. The IETF has chartered a Web Bot Auth WG. No aggregate publisher payouts or take rate are published.
  - — [Rishi Narang, "Pay per crawl: putting HTTP 402 to work, and the requirement I missed," *cybersins/sec*, August 12, 2026](https://cybersins.com/pay-per-crawl-402-crawler-monetization/)
- Cloudflare changelog (December 10, 2025; "Pay Per Crawl (Private beta)"):
  - Payment headers must be included in the signed `signature-input` components to stop tampering and replay at a modified price.
  - A Web Bot Auth–authenticated discovery API lists charging zones.
  - A `crawler-error` header carries 11 codes.
  - Some paths are always free (robots.txt, sitemap.xml, security.txt).
  - — ["Pay Per Crawl enhancements," *Cloudflare Developers Changelog*, December 10, 2025](https://developers.cloudflare.com/changelog/2025-12-10-pay-per-crawl-enhancements/)
- On July 1, 2026, Cloudflare moved from per-crawl toward **per-answer payment**: Ceramic.ai and You.com pay publishers per query result. Its Web Search API for agents is priced at provider list prices: $0.25 (Ceramic), $5 (Linkup) and $7 (Exa) per 1,000 requests. The attribution dashboard (opened July 1, 2026) shows crawl-to-referral ratios from 118 to nearly 50,000 fetches per visit. — ["Cloudflare web search for AI agents costs $0.25 to $7 per 1,000 requests," *PPC Land*, October 4, 2026](https://ppc.land/cloudflare-web-search-for-ai-agents-costs-0-25-to-7-per-1-000-requests/) [SECONDARY; the same article's bot-share figures (57.4% of HTML requests; 50.6% training + 10.7% search) are internally inconsistent]
- From September 15, 2026, new domains on ad-monetized pages block Training and Agent bots by default while allowing Search bots. Configurable HTTP 402 crawler responses have been available on paid plans since August 2025. — ["Cloudflare AI Crawler Controls: New Sept 2026 Defaults," *Shattered*, September 21, 2026 (updated Oct. 22, 2026)](https://shattered.io/cloudflare-ai-crawler-default-20-bots-2026/) [SECONDARY; has internal date inconsistencies]
- Web Bot Auth message signatures were folded into Cloudflare's Verified Bots Program on July 1, 2025. — [*PPC Land*, Oct. 4, 2026](https://ppc.land/cloudflare-web-search-for-ai-agents-costs-0-25-to-7-per-1-000-requests/)
- Visa published TAP with Cloudflare on October 14, 2025. — [*Chargeflow*, July 7, 2026](https://www.chargeflow.io/blog/ai-agent-chargeback-liability) [SECONDARY]. Mastercard's transaction probability score (September 30, 2026) uses Cloudflare data. — [*BankingNewsAI* Mastercard page](https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce)
- Crawl-to-refer ratios from Cloudflare data, July 2025 [MEASURED]: Anthropic 38,065:1; OpenAI 1,091:1; Perplexity 194:1; Microsoft 41:1; Google 5.4:1. — [*cybersins/sec*, Aug. 12, 2026](https://cybersins.com/pay-per-crawl-402-crawler-monetization/) [SECONDARY relaying Cloudflare]
- **TollBit** (Q3 & Q4 2025 State of the Bots) [MEASURED]:
  - By Q4 2025, publishers saw ~31 human visits per AI-bot visit, down from ~200 at the start of 2025.
  - Click-through from AI platforms for publishers without licensing deals fell from 0.8% to 0.27%.
  - AI apps drove 0.12% of referrals, against 80.5% for Google.
  - Top-tier scraping services cost up to $22.50 per 1,000 pages.
  - No paid-access volume through TollBit was given.
  - Verbatim: "The volume of scraping is up. The return to publishers is effectively zero."
  - — ["The Data Acquisition Stack Scraping Your Site," *TollBit Blog*, April 13, 2026](https://tollbit.com/blog/scraper-index-and-audit/)

### Inferences
- Pay Per Crawl is the cleanest deployed fiat example of a **machine-negotiated, signed price commitment**. The price is a signed request component, so the commitment cannot be altered in transit. Settlement is netted by a trusted intermediary (Cloudflare) rather than per request. Unwinding is limited because only successful 200 responses are charged.
- The move from per-crawl to per-answer pricing (July 2026) suggests per-fetch pricing did not clear the market. Value is being priced at the point of *use in an answer*, which requires attribution rather than access control.
- The same RFC 9421 / Web Bot Auth signature now serves three roles: content-access identity, the payment-price binding, and (through TAP) shopping-agent identity at merchants. Agent identity and agent payment authorization are converging on one HTTP layer.

### Gaps
- No published Pay Per Crawl GA date, participant count, payout volume or Cloudflare take rate.
- No TollBit paid-transaction volume or number of AI companies paying through TollBit.
- Primary Cloudflare blog posts were blocked, so the mechanism comes from the changelog and secondary write-ups.

## 5. Agent-specific fintechs and corporate-card agent features: mechanisms (virtual cards, spending policies, prefunded wallets)

### Takeaway
Three bounding mechanisms dominate: (1) **single-use or merchant-locked virtual cards** issued per agent or task, often on Visa Intelligent Commerce or Mastercard Agent Pay tokens (Ramp, Mercury, Stripe Issuing for agents, Crossmint); (2) **prefunded or committed wallets with signed, capped tokens** (Skyfire KYAPay JWTs, Natural Wallets/Vaults); and (3) **delegated-card authority with policy caps and revocation**, exposed through x402-style flows (Nevermined). Catena Labs is pursuing a regulated route with an OCC national trust bank charter application. Almost all claims are vendor-sourced, and none of these firms disclosed volume.

### Cited Findings
- **Ramp Agent Cards** (April 28, 2026): "Each card is scoped to a single agent and transaction" (verbatim). Cards can be merchant-locked with a per-transaction hard cap. Each **VIC token is single-use and scoped at the Visa network level**, issued by API in seconds, with MCP-server issuance. — ["Virtual cards for AI agents," *Ramp Blog*, April 28, 2026](https://ramp.com/blog/virtual-cards-for-ai-agents) [VENDOR]
- Ramp agent docs: the agent selects from funds available to the connected Ramp user. A standalone agent identity is in limited early access. Purchases follow the fund's spend limit, merchant rules, approval policies and accounting defaults. The agent confirms merchant, total and funding source before buying and confirms acceptance afterwards. — ["Agent cards overview," *Ramp Agents Docs*, accessed October 2026](https://agents.ramp.com/docs/agent-cards/overview) [VENDOR]
- Ramp was a Visa Intelligent Commerce B2B pilot partner in December 2025. — [*Visa IR*, Dec. 18, 2025](https://investor.visa.com/news/news-details/2025/Visa-and-Partners-Complete-Secure-AI-Transactions-Setting-the-Stage-for-Mainstream-Adoption-in-2026/default.aspx)
- **Mercury Agent Cards** (undated, ca. Aug–Oct 2026): a human creates a virtual card that an agent can use without per-transaction approval. The company sets budget, eligible merchants and categories, and out-of-rule transactions are auto-declined. The agent cannot raise its own spending limit. Ramp data across 50,000 businesses shows agent use cut out-of-policy spend events by 62% [VENDOR CLAIM]. Verbatim (Immad Akhund, Mercury CEO): "People have already been manually issuing our virtual cards to agents." — ["AI Agents Just Got Their Own Company Credit Cards," *PYMNTS*, 2026](https://www.pymnts.com/?p=4071149)
- **Skyfire (KYAPay)** [VENDOR, described by a competitor]:
  - Token types `kya`, `pay` and `kya-pay` are signed JWTs (ES256, JWKS verification). Sellers check signature, issuer, audience, expiry and type.
  - A buyer creates a payment token against wallet funds, which commits that amount. The seller can charge less or charge several times within the remaining authorization.
  - Funding: cards and USDC, with ACH and wire in some configurations.
  - Tokenized cards give the agent a restricted credential; the merchant and amount are part of the authorization.
  - — ["Skyfire review," *Nevermined Blog*, August 16, 2026](https://nevermined.ai/blog/skyfire-review)
- Skyfire KYA IDs are recorded as ERC-8004 on-chain attributes. KYA verification covers provider review, policy review, purpose verification and a security check. — ["Skyfire KYAPay: Know Your Agent," *Stellagent*, April 9, 2026](https://stellagent.ai/insights/skyfire-kyapay-know-your-agent) [SECONDARY]
- Skyfire powered the Consumer Reports agent in Visa's pilot (December 2025). — [*Visa IR*](https://investor.visa.com/news/news-details/2025/Visa-and-Partners-Complete-Secure-AI-Transactions-Setting-the-Stage-for-Mainstream-Adoption-in-2026/default.aspx). It provides verification for Mastercard's transaction probability score (September 30, 2026). — [*BankingNewsAI* Mastercard](https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce)
- **Nevermined** [VENDOR]: protected APIs return payment requirements, and Nevermined verifies the caller's authorization before running the workload. Two x402 schemes: `nvm:erc4337` (smart accounts and session keys) and **`nvm:card-delegation`**, which gives bounded card authority with spending limits, duration, transaction caps, API-key scope and revocation, without exposing the card. Fee: 1–2% of settled volume. — [*Nevermined Blog*, Aug. 16, 2026](https://nevermined.ai/blog/skyfire-review)
- **Catena Labs** (May 20, 2026): $30M Series A co-led by a16z crypto (with Acrew, per the Quick Take). It was **accepted for filing for an OCC National Trust Bank charter**, which would let it hold customer funds and process agent payments as a regulated fiduciary. Mechanism: humans set spending limits, approved recipients, holding caps and audit trails before handing execution to agents. The company was co-founded by Circle co-founder Sean Neville. Verbatim (a16z): "bank accounts and payment rails they can access programmatically." — ["Catena Labs lands $30 million Series A, files for national trust bank charter…," *The Block*, May 20, 2026](https://theblock.co/post/402029/catena-labs-lands-30-million-series-a-files-for-national-trust-bank-charter-to-underpin-agentic-finance)
- **Natural** (July 2026):
  - $30M Series A led by Forerunner (Kirsten Green), $40M in total; founded August 2025.
  - 13 products, 6 live (Connect, Wallets, Transfer, Vaults); Cards, Charge (per-API-call billing), Credit and others are planned.
  - **Vaults** are deposit-only. Verbatim: "Vaults enables agents to move money into accounts but not withdraw it."
  - No volume disclosed.
  - — ["Natural bags $30m, launches agentic payments infrastructure," *FinTech Futures*, July 2026](https://www.fintechfutures.com/venture-capital-funding/natural-bags-30m-launches-agentic-payments-infrastructure); date corroborated by ["Natural raises $30m to power payments for AI agents," *FinTech Global*, July 21, 2026](https://fintech.global/2026/07/21/natural-raises-30m-to-power-payments-for-ai-agents/)
- **Crossmint** [VENDOR]: issues virtual Visa and Mastercard numbers to agents and offers fiat and stablecoin wallets. Card data is tokenized. A "dual-key" design lets humans set permissions while agents can only request payments within them. — ["Agent card payments compared," *Crossmint*, March 12, 2026](https://crossmint.com/learn/agent-card-payments-compared)
- **Stripe Issuing for agents** (preview, April 2026) offers single-use virtual cards for agent purchases. — [*Stripe Blog*, Apr. 29, 2026](https://stripe.com/blog/everything-we-announced-at-sessions-2026)
- **Basis Theory** committed to Mastercard Verifiable Intent. — [*PYMNTS*, March 5, 2026](https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/). It is also an AP4M partner. — [*Genfinity*, June 10, 2026](https://genfinity.io/2026/06/10/mastercard-agent-pay-for-machines-launch/)

### Inferences
- In practice, the commitment for corporate agents is bounded at **card issuance** (amount, merchant, single use) and verified by the issuer's authorization engine. Unwinding goes through ordinary card disputes. This explains why corporate-card vendors (Ramp, Mercury) moved first: B2B card programs already have per-card controls and an employer who absorbs losses.
- Skyfire's wallet-commit model ("payment token commits that amount") behaves like a pre-authorization or hold. Natural's deposit-only Vaults are a structural safeguard: the agent can fund but not drain. Both bound loss by architecture rather than by after-the-fact dispute.
- Catena's trust-charter route shows some founders think agent fund custody and fiduciary duty eventually need a regulated balance sheet, not just API-level limits.

### Gaps
- No data fetched on **Payman**, **Lithic** agent cards or **Brex** agent features (search budget ran out). Ramp's own comparison page and Brex docs were not reached.
- No transaction volume, loss rates or customer counts for any agent-specific fintech.
- Could not confirm Skyfire's 2025–2026 funding or KYAPay's card-network integrations from primary sources.

## 6. Liability and disputes: network treatment of agent-initiated transactions, Reg E / Reg Z, network rule changes in 2025–2026, regulator statements, and EU PSD3/PSR

### Takeaway
As of October 2026 **no card network has published agent-specific chargeback reason codes or a liability shift**. Disputes run through ordinary CNP reason codes (fraud vs. consumer dispute), and merchants bear losses by default. Visa's April 18, 2026 Core Rules add **Agentic Platform Requirements**: registration, consent to tokenize and to the payment instruction, a stated expiry, no card-present use, no aggregation, and a cardholder acknowledgement of responsibility for the provider's actions. That gives a documented delegation without reallocating loss. Mastercard is building evidence (Verifiable Intent, "Agentic Disputes"), and Amex offers a consumer guarantee. In US law, Reg E's "furnished access device" exclusion and Reg Z's apparent-authority test make agent errors look *authorized*, though Reg Z's not-as-agreed dispute right remains. I found no CFPB agent-payment guidance. The UK is furthest along: the FCA said in March 2026 it is considering whether rules need to change, and HM Treasury's July 14–October 6, 2026 consultation (Q15) asks about consent, authentication and unauthorized-transaction liability. EU PSD3/PSR (provisional deal November 27, 2025) does not yet contain an agent-specific SCA accommodation.

### Cited Findings
**Network rules**
- **Visa Core Rules (April 18, 2026 edition), §4.1.24 "Agentic Platform Requirements":**
  - Two roles are defined, **Agentic Payment Enabler** and **Agentic Payment Provider**, and both must enroll in VIC.
  - Agentic transactions are barred card-present and may not be aggregated.
  - Before transacting, the provider must obtain the cardholder's consent to tokenize and to the payment instruction, state the instruction's expiry date, and obtain the cardholder's acknowledgement of responsibility for the provider's actions.
  - There is no dedicated agentic chargeback regime.
  - On US law: Reg E "has no concept of an AI-initiated payment" (verbatim). Chargeback codes cannot tell apart agent error within the mandate, agent excess beyond it, and buyer's remorse.
  - — ["Agentic Payments: Protocols and Liability When an AI Agent Pays," *Private.Law Wiki*, accessed October 2026](https://wiki.private.law/en/agentic-payments.md) [SECONDARY summary of the Visa rules PDF, which I could not open]
- The same rules as reported elsewhere: the provider must verify cardholder identity; purchases must use only cardholder-defined criteria; digital wallets may be used. Verbatim rule text as relayed: "Cardholder acknowledgement that they are responsible for actions taken by the Agentic Payment Provider." — [*BankingNewsAI* Visa page](https://www.bankingnewsai.com/fintech/visa/agentic-commerce) [SECONDARY]
- Stinson attorneys note that the April 18 Visa framework covers AI-driven payments "without consumer-merchant interaction" and raises tension with disclosure and fee-transparency laws. — [Tom Witherspoon, Audrey Carroll and Marisa Perfetti, "Visa's Agentic Payment Rules Expose Compliance Tensions," *Law360 UK*, May 28, 2026](https://www.law360.co.uk/articles/2479142) [paywalled; only the lede was read]
- Visa's new rules require agentic payment providers to register and keep a defensible chain of authorization: verified user instructions, transaction controls matching the delegation scope, and preserved records. Compliance shields against network fines but not against customer claims for exceeding authority. Issuers must credit consumers after investigation, and merchants bear the loss in practice. — [Ximeng (Sammy) Tang, "Authorizing Agentic Payments," *Goodwin Fintech Flash*, June 11, 2026](https://www.goodwinlaw.com/en/insights/publications/2026/06/insights-technology-aiml-authorizing-agentic-payments)
- **Reason codes:**
  - Visa 10.4 and Mastercard 4837 (fraud) apply when the cardholder denies authorization. Visa 13.3 and Mastercard 4853 apply when the cardholder accepts that the agent acted but disputes the outcome.
  - Visa CE 3.0 depends on matching IP, device and account identifiers, which agent traffic from platform servers may not produce.
  - Citing an FBT Gibbons May 2026 analysis: Mastercard's public Transaction Processing Rules do not address agents; it governs them through Agent Pay.
  - **EMVCo published a draft Agentic Payments framework on September 1, 2026** (feedback through September 30) that does not address disputes or liability.
  - Visa VAMP's Excessive Merchant criteria took effect April 1, 2026.
  - — [Dan Moshkovich, "AI Agent Chargeback Liability: Who Pays…," *Chargeflow*, July 7, 2026 (page also dated Oct. 25, 2026)](https://www.chargeflow.io/blog/ai-agent-chargeback-liability) [VENDOR (chargeback-management firm)]
- No published Visa or Mastercard **agent-specific** dispute rule exists. Visa's dispute rules change on April and October cycles, and the author forecasts that the first binding rule would arrive no earlier than April 2027 [FORECAST, author's inference]. The CMA (March 9, 2026) treats businesses as responsible for their agents like employees. — [Skwira, *ShopAppy*, Aug. 24, 2026](https://shopappy.com/payments/card-networks/agent-chargeback-rules-holiday-2026)
- **Reconciling the sources:** ShopAppy's "no rule" claim and the Visa §4.1.24 reports agree. Visa has *platform/authorization* requirements, not *dispute* rules.
- On Mastercard disputes, Miebach said Verifiable Intent lets a cardholder challenge a purchase so the chargeback process can resume. The September 30, 2026 white paper describes "Agentic Disputes" that use the VI audit trail as evidence. Mastercard has not published how losses are split. — [*BankingNewsAI* Mastercard page](https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce) [SECONDARY]
- Merchants bear agent-error costs by default, and no network rule makes agent platforms liable. Amex APP is the only network-level remedy. PYMNTS Intelligence (September 2026): 93% of merchants say AI or agent providers should bear the loss, and 28% would offer their full range to agents under current terms [SURVEY]. Verbatim: "the merchant is the party left holding the bill." — [Tessa Vaughn, "The Agentic Commerce Liability Gap: Who Pays When the Agent Buys Wrong?," *Forkast*, October 6, 2026](https://forkast.news/the-agentic-commerce-liability-gap-who-pays-when-the-agent-buys-wrong/) [caution: Forkast identifies the byline as an AI reporter]

**US law (Reg E / Reg Z / UCC 4A)**
- Reg E: a transfer is presumed authorized when a consumer gives credentials to an agent, human or AI, even if the agent exceeds intent. Reg Z: a card use is authorized if the initiator had actual, implied or apparent authority, but Reg Z also allows disputes over goods not accepted or not delivered as agreed. Commercial payment orders fall under UCC 4A security procedures. Verbatim (Introduction): "The legal question that arises is whether a particular payment was actually authorized." — [Tang, *Goodwin*, June 11, 2026](https://www.goodwinlaw.com/en/insights/publications/2026/06/insights-technology-aiml-authorizing-agentic-payments)
- Reg E excludes from "unauthorized" any transfer by a person the consumer furnished the access device to, until the consumer notifies the institution, and official commentary keeps the consumer liable even if that person exceeds authority. A Consumer Bankers Association report (January 2026) asks whether sharing credentials with an AI tool triggers this exclusion. Visa and Mastercard zero-liability policies still depend on an "unauthorized" classification. Verbatim (author): "There's no clear legal rule for who bears the loss." — [Aaron Cheiffetz, "How agentic payments shift artificial intelligence risk" (opinion), *Payments Dive*, October 9, 2026](https://www.paymentsdive.com/news/how-agentic-payments-artificial-intelligence-risk/832601/)
- **CFPB:** neither Goodwin (June 2026) nor Payments Dive (October 2026) cites any agent-payment guidance. Forkast (October 2026) says the CFPB and the Fed have said nothing. **Contradiction:** a sponsored FraudBeat piece claims a January 2026 CFPB advisory on autonomous-agent purchases under Regulation Z, holding that dispute rights survive delegation. It also cites a 2.4× agent dispute rate attributed to TrustSphere. — [Ben Herut, "Agentic Commerce Disputes: A Fraud Window Left Open," *FraudBeat* (sponsored by Chargeflow), May 31, 2026](https://www.fraudbeat.com/agentic-commerce-disputes-friendly-fraud/). **I could not corroborate either claim, and both should be treated as unreliable.**
- CFPB's only AI-adjacent consumer-finance document found is the June 6, 2023 "Chatbots in Consumer Finance" spotlight. The Fed's SR 26-2 (April 17, 2026) places generative and agentic AI models outside the scope of model-risk guidance. — ["What Regulators Say About AI Agents in Banking (2026)," *BankingNewsAI*, accessed October 2026](https://www.bankingnewsai.com/agentic-banking/regulation) [SECONDARY]

**UK**
- The FCA's 2026 Payments Regulatory Priorities (March 25, 2026) say it will consider, verbatim, "whether change or development of regulation is needed to support agentic AI payments." This is described as a step beyond applying existing frameworks. No rules have changed. — ["FCA eyes rule change as agentic AI comes to payments," *Payment Expert*, March 25, 2026](https://paymentexpert.com/2026/03/25/fca-2026-payments-regulatory-priorities-report/)
- HM Treasury, "Modernising Payment Services Regulation," published July 14, 2026, closed October 6, 2026. HMT commits to revoking the SCA rules in the PSRs so the FCA can make outcomes-based authentication rules, and wants the UK to "lead globally on agentic payments." — [Simon Lovegrove, Charlotte Carnegie and Matthew Gregory, "HMT consults on Modernising Payment Services Regulation," *Global Regulation Tomorrow (Norton Rose Fulbright)*, July 16, 2026](https://www.regulationtomorrow.com/2026/07/hmt-consults-on-modernising-payment-services-regulation/)
- **Question 15** asks whether the consent, authentication and unauthorized-transaction liability provisions need updating for agentic payments. The relevant PSRs 2017 provisions:
  - **reg. 67** (consent in the agreed form and procedure; an agent payment may fall within a well-defined delegation)
  - **regs. 76–77** (unauthorized-transaction refunds; payer liability up to £35, or all losses for fraud or gross negligence)
  - **reg. 100** (SCA and dynamic linking)
  - Verbatim ("The Treasury has opened the policy question" section): "The consultation says the PSRs were written before AI."
  - — [Rob Bratby, "Agentic payments: consent and liability under UK payment law," *Bratby Law*, July 15, 2026 (updated Oct. 25, 2026)](https://bratby.law/agentic-payments-accountability-gap/)
- HMT's July 14, 2026 AI adoption plan for financial services recommends a trust framework covering agent-transaction liability, Know Your Agent and machine-to-machine authentication. The FCA Mills Review (July 6, 2026) touches agentic payments only in passing. — [*Private.Law Wiki*](https://wiki.private.law/en/agentic-payments.md) [SECONDARY]
- BoE Governor Bailey (September 30, 2026), verbatim as relayed: "regulation is not, in my view, the right place to start." He frames frontier AI, including agentic payments, as a financial-stability issue. — [*BankingNewsAI* regulation page](https://www.bankingnewsai.com/agentic-banking/regulation) [SECONDARY]

**EU (PSD3/PSR, EBA, ECB)**
- PSD3/PSR provisional agreement, November 27, 2025:
  - PSPs must "refund the amount in full" (verbatim) for bank-employee impersonation fraud reported to police and the PSP.
  - Online platforms are liable to reimbursing PSPs if they fail to remove reported fraudulent content.
  - Formal adoption was expected around end-Q1/Q2 2026, with an ~21-month transition.
  - — [Taylor Wessing, "EU lawmakers strike a deal on payments reforms," *Taylor Wessing Insights*, December 1, 2025](https://www.taylorwessing.com/en/insights-and-events/insights/2025/11/eu-lawmakers-strike-a-deal-on-payments-reforms)
- The SCA accommodation that would let an agent pay has not been written yet and would sit in the PSR. Final texts were expected in the Official Journal in summer 2026, the PSR applies 20 days after publication, and PSD3 applies around 2028. Sources give transition lengths of 18 or 21 months. Verbatim: "the legal authority for AI agents to pay is not yet established." — [Thorsten Meyer, "The rails: why European agentic commerce is co-defined by two converging regimes," *Digitech Bytes*, June 23, 2026 (essay dated June 4, 2026)](https://digitechbytes.com/legal-operations/the-rails-why-european-agentic-commerce-is-co-defined-by-two-converging-regimes/) [SECONDARY; AI-assisted page]
- The PSR proposal (Art. 87 in the 2023 Commission text) allows PSPs to outsource SCA to technical service providers, including wallets, merchants, gateways and marketplaces, under outsourcing agreements in which the PSP keeps liability. The page is internally inconsistent on whether liability shifts. — ["Delegated authentication PSD3/PSR passkeys," *Corbado Blog*, updated October 19, 2026](https://www.corbado.com/es/blog/autenticacion-delegada-psd3-psr-passkeys) [VENDOR]
- PSD3 "still assumes a human initiated the purchase" (verbatim, author), blurring merchant-initiated and customer-initiated transaction categories. — [Simon Hunter (Signifyd), "PSD3, agentic commerce and the new frontier of payment risk," *British Retail Consortium*, May 19, 2026](https://brc.org.uk/news-and-events/news/associate-insight/2026/psd3-agentic-commerce-and-the-new-frontier-of-payment-risk/) [VENDOR author]
- There is no published EBA position on agentic payments; they fall under PSD2 and the SCA RTS. The EBA's September 25, 2025 report found 55% of EU banks using GPAI or agentic AI in consumer-facing processes [SURVEY]. ECB Supervisory Board member Machado said on February 24, 2026 that banks remain accountable regardless of the technology. — [*Private.Law Wiki*](https://wiki.private.law/en/agentic-payments.md); [*BankingNewsAI* regulation page](https://www.bankingnewsai.com/agentic-banking/regulation) [both SECONDARY]

**Other supervisors (context)**
- FSB final AI sound practices (October 15, 2026): Sound Practice 10 asks for extra human-oversight measures for highly autonomous agents. HKMA (October 15, 2026) floats a possible central registry of AI agents and kill switches. MAS AI Risk Management Guidelines (October 7, 2026) cover "AI agents." — [*BankingNewsAI* regulation page](https://www.bankingnewsai.com/agentic-banking/regulation) [SECONDARY]

### Inferences
- The current settlement is **"documented delegation, unchanged liability."** Networks (the Visa rules, Mastercard VI, Amex intent intelligence) are standardizing *evidence* of what was delegated. Loss allocation still follows ordinary CNP rules, so merchants bear risk unless an issuer (Amex) volunteers to absorb it.
- Visa's cardholder-acknowledgement requirement and Reg E's furnished-access-device exclusion point the same way: **consumers who delegate are presumed to own the agent's in-scope actions**. Disputes therefore shift from "unauthorized" (fraud codes) to "not as described" or out-of-mandate (consumer-dispute codes), and that is exactly where signed mandates matter as evidence.
- The UK consultation and the FCA statement are the most concrete public-law moves toward rules on agent consent and liability. The EU is about two years behind (PSD3 applies ~2028), and the US has no agency action.

### Gaps
- Could not read Visa's rules PDF or Mastercard's September 30, 2026 white paper directly. §4.1.24 wording comes from secondary summaries.
- I found no evidence of the alleged January 2026 CFPB advisory. CFPB's position remains unknown or non-existent.
- The EMVCo draft framework content was not obtained.
- Whether PSD3/PSR final texts were actually published in the Official Journal by October 2026 is unconfirmed.
- The HMT consultation response is not yet published, since the consultation only closed October 6, 2026.

## 7. Quantitative evidence: measured volume, adoption surveys and forecasts

### Takeaway
**Measured agent-*executed* payment volume is essentially unpublished.** The only counts are qualitative: Visa's "hundreds" (December 2025), Amex's "thousands" in pilots (April 2026), and 12–30 Shopify merchants live on ChatGPT checkout (March 2026). The large figures in circulation measure **AI-referred traffic** (Adobe) or **AI-"influenced" sales** (Salesforce, $67B in Cyber Week 2025), not purchases an agent completed. Forecasts range from Morgan Stanley's $190–385B US agentic GMV by 2030 to McKinsey's $3–5T globally. Surveys consistently show low willingness to let agents buy autonomously (~10–38%).

### Cited Findings
**Measured (actuals)**
- **Salesforce, Cyber Week (Nov. 25–Dec. 1, 2025)** [MEASURED, "influence" metric]: global spend $336.6B (+7% YoY); US $79.6B (+5%). **AI and agents influenced $67B, or 20% of global orders**, with no formal definition of "influenced." Data covers 1.5B+ shoppers in 89+ countries. Retailers using Agentforce saw sales grow 32% faster [VENDOR CLAIM]. Verbatim (Caila Schwartz, Salesforce): "The modern shopper is digital-first." — ["Salesforce Data: AI and Agents Propel Cyber Week to Record $336.6B in Global Spend," *Salesforce Investor Relations*, December 5, 2025](https://investor.salesforce.com/news/news-details/2025/Salesforce-Data-AI-and-Agents-Propel-Cyber-Week-to-Record-336-6B-in-Global-Spend/)
- Salesforce also reportedly put full-holiday 2025 AI-influenced orders at **$262B / 20%** (State of Marketing 2026, February 19, 2026). — [*Elogic*, 2026](https://elogic.co/blog/chatgpt-commerce-statistics/) [SECONDARY; not verified against Salesforce]
- **Adobe Analytics** [MEASURED, traffic and conversion, not agent purchases]:
  - AI traffic to US retail sites: +393% YoY in Q1 2026, +269% in March 2026, +693% in holiday Nov–Dec 2025.
  - AI-referred conversion: 42% *better* than non-AI sources in March 2026, against 38% *worse* in March 2025.
  - Revenue per visit 37% higher.
  - Sample: more than 1 trillion US retail visits.
  - — [Jose Antonio Lanz, "AI Traffic to US Retailers Jumps 393% in Q1 as Agentic Shoppers Outspend Humans," *Decrypt* via *Yahoo Finance*, April 19, 2026](https://finance.yahoo.com/sectors/technology/articles/ai-traffic-us-retailers-jumps-160141756.html) [SECONDARY relaying Adobe]
- Adobe Black Friday 2025 AI traffic +805% YoY; Cyber Monday +670%. — [*Elogic*](https://elogic.co/blog/chatgpt-commerce-statistics/) [SECONDARY]
- **Visa:** "hundreds" of agent-initiated transactions as of December 18, 2025 [MEASURED, qualitative]. — [*Visa IR*, Dec. 18, 2025](https://investor.visa.com/news/news-details/2025/Visa-and-Partners-Complete-Secure-AI-Transactions-Setting-the-Stage-for-Mainstream-Adoption-in-2026/default.aspx). No 2026 counts are published. — [*BankingNewsAI* Visa](https://www.bankingnewsai.com/fintech/visa/agentic-commerce)
- **Amex:** "thousands" of AI-assisted pilot transactions (April 2026) [VENDOR CLAIM]. — [*Stellagent*](https://stellagent.ai/insights/amex-ace-agentic-commerce-developer-kit)
- **Mastercard:** no counts published; the first network agentic transaction came in Q3 2025. — [*BankingNewsAI* Mastercard](https://www.bankingnewsai.com/fintech/mastercard/agentic-commerce)
- **Stripe:** no agentic volume; Collison said agentic stats rose sharply in September 2026 but gave no numbers (Payments Dive, October 15, 2026). — [*BankingNewsAI* Stripe](https://www.bankingnewsai.com/fintech/stripe/agentic-commerce) [SECONDARY]
- **ChatGPT checkout:** about a dozen merchants live (The Information) or ~30 (Shopify to Forrester). — [*Forrester*, March 7, 2026](https://www.forrester.com/blogs/what-it-means-that-the-leader-in-agentic-commerce-just-pulled-back). Buy-button conversion below 1% (The Information, via Shopifreaks). — [*Shopifreaks*, March 12, 2026](https://www.shopifreaks.com/openai-pivots-from-instant-checkout-to-an-app-based-shopping-model-inside-chatgpt/) [SECONDARY]
- About 2% of ChatGPT queries are shopping (OpenAI Economic Research working paper), and ChatGPT had 900M WAU (OpenAI, February 27, 2026). — [*Elogic*](https://elogic.co/blog/chatgpt-commerce-statistics/) [SECONDARY]
- **Context (non-Western fiat):** Alipay AI Pay reportedly passed 120M weekly transactions in 2026 (The Asian Banker / Financial IT). — ["Agentic commerce," *Wikipedia*, accessed October 2026](https://en.wikipedia.org/wiki/Agentic_commerce) [SECONDARY; unverified]
- **Context (crypto rail, for contrast; outside this scope):** x402 had settled 167M+ transactions by April 2026, 85% on Base (Coinbase Developer Platform). — [*OpenHermit*, May 17, 2026](https://www.openhermit.com/blog/agent-payment-protocols-compared) [SECONDARY]
- Visa processed 106M disputes globally in 2025, +35% since 2019 (a baseline for dispute-load concerns). — [Rajesh Beri, "Visa's 4-Protocol Bet: AI Agents and the $5T Market," *The D(AI)LY Brief*, May 20, 2026](https://www.beri.net/article/visa-intelligent-commerce-connect-ai-agent-payments-2026) [SECONDARY]

**Surveys**
- Morgan Stanley AlphaWise: ~23% of Americans made at least one AI-assisted purchase in the past month. — [*Digital Commerce 360*, December 9, 2025](https://www.digitalcommerce360.com/2025/12/09/morgan-stanley-ai-agentic-shoppers-385-billion-online-sales/amp/)
- Visa/Morning Consult (April 2, 2026): 38% of US adults comfortable with AI completing a purchase; 60% would not allow any spend without approval. — [*TechInformed*, April 9, 2026](https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/)
- Visa/Harris Poll (September 9, 2026): 23% of US consumers trust generative AI with payments; 61% would trust Visa. — [*BankingNewsAI* Visa](https://www.bankingnewsai.com/fintech/visa/agentic-commerce) [SECONDARY]
- Mastercard Signals (August 3, 2026): ~10% willing to let an agent complete a purchase autonomously. — [*ShopAppy*](https://shopappy.com/payments/card-networks/agent-chargeback-rules-holiday-2026) [SECONDARY]
- Bain: shoppers are 3× more likely to trust retailers' AI (25%) than AI platforms (7%). — [*eMarketer*](https://www.emarketer.com/content/amazon-edges-deeper-agentic-commerce-rufus-auto-buy)
- Forrester (March 2026): buying inside an answer engine is the least-adopted use case. — [*Forrester*](https://www.forrester.com/blogs/what-it-means-that-the-leader-in-agentic-commerce-just-pulled-back)
- PYMNTS Intelligence (September 2026): 93% of merchants say AI providers should bear loss. — [*Forkast*](https://forkast.news/the-agentic-commerce-liability-gap-who-pays-when-the-agent-buys-wrong/) [SECONDARY]
- Adobe survey of 5,000+ US consumers: 39% have used AI for online shopping. — [*Decrypt/Yahoo*](https://finance.yahoo.com/sectors/technology/articles/ai-traffic-us-retailers-jumps-160141756.html)

**Forecasts**
- **McKinsey** (October 17, 2025) [FORECAST]: US B2C retail orchestrated by agents of **$900B–$1T by 2030**; global **$3–5T**. Goods only. Verbatim (Executive summary, "At a glance"): "agents can traverse the same digital paths to purchase as humans." — [Katharina Schumacher, Roger Roberts and Katharina Giebel, "The agentic commerce opportunity: How AI agents are ushering in a new era for consumers and merchants," *McKinsey & Company*, October 17, 2025](https://www.mckinsey.com/industries/retail/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants)
- **Morgan Stanley** (November 2025) [FORECAST]: US agentic GMV of **~$190B base case / ~$385B bull case by 2030**, or ~10–20% of US e-commerce. Grocery and CPG make up 19% of 2030 agentic spend. — [Navamya Acharya, "Morgan Stanley sees a multi-year path to nearly $400B of Agentic Commerce," *Investing.com* via *Yahoo Finance*, November 29, 2025](https://finance.yahoo.com/news/morgan-stanley-sees-multi-path-093502239.html). Analysts: Nathan Feather and Brian Nowak. — [*Digital Commerce 360*, Dec. 9, 2025](https://www.digitalcommerce360.com/2025/12/09/morgan-stanley-ai-agentic-shoppers-385-billion-online-sales/amp/)
- **Bain** [FORECAST]: $300–500B US by 2030 (15–25% of e-commerce). **Gartner** [FORECAST]: 20% of digital commerce via AI platforms by 2030, and $15T in B2B agent purchases by 2028. — [Beri, *The D(AI)LY Brief*, May 20, 2026](https://www.beri.net/article/visa-intelligent-commerce-connect-ai-agent-payments-2026) [SECONDARY; original reports not opened]
- **Visa** [FORECAST]: millions of consumers using agents to buy by holiday 2026. — [*Visa IR*, Dec. 18, 2025](https://investor.visa.com/news/news-details/2025/Visa-and-Partners-Complete-Secure-AI-Transactions-Setting-the-Stage-for-Mainstream-Adoption-in-2026/default.aspx)
- **Mastercard** (Jorn Lambert, CPO, via Fortune, June 10, 2026): agentic payments won't drive near-term revenue and will grow over five years (paraphrase). — [*Genfinity*, June 10, 2026](https://genfinity.io/2026/06/10/mastercard-agent-pay-for-machines-launch/)
- **BCG** [FORECAST]: 15–20% of e-commerce transactions AI-mediated by 2028. — [*Launchcodex*](https://launchcodex.com/blog/web-digital-infrastructure/universal-commerce-protocol-merchant-guide/) [SECONDARY]
- **Juniper** [FORECAST]: $14.6T in B2B virtual-card volume by 2029 (relevant to the agent-card rails). — [*Visa Newsroom*, Oct. 21, 2026](https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22866.html)

### Inferences
- The spread between forecasts (hundreds of billions to trillions by 2030) and measured agent-executed volume (no published counts beyond "hundreds" or "thousands") is several orders of magnitude. Most 2025–2026 "agentic commerce" numbers measure discovery and referral, not delegated payment commitments.
- Low autonomous-spend willingness (Mastercard ~10%, Visa 60% "no spend without approval") fits the deployment pattern in Q3: human-confirmed checkout is live, while human-not-present card spending stays pilot-scale outside closed ecosystems and B2B.

### Gaps
- No network, PSP or platform has published agent-executed transaction counts, GMV, approval rates, dispute rates or fraud rates for 2026.
- Could not open the Salesforce or Adobe primary reports for 2026 holiday forecasts. Holiday 2026 measured data does not exist yet (as of October 29, 2026).
- Bain, Gartner and BCG figures come only through secondary citations.
- The WebSearch budget ran out before I could look for 2026 agentic forecasts from eMarketer, J.P. Morgan or Juniper, or for any Q3 2026 earnings-call disclosures of agentic volume by Visa, Mastercard or PayPal.
