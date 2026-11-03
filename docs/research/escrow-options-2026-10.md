# Escrow options agents can call (October 2026)

Compiled October 29–30, 2026. T-002 updates this file with a fuller prior-art sweep.

## Summary

No single product lets an agent open and fund an escrow by API from whatever funds it can access (cards, Stripe, bank, stablecoin) and get a neutral release rule. The pieces exist separately. The funding source decides who may hold the money:
- card funds can sit only with a merchant (an authorization hold) or a platform balance;
- stablecoins can sit in a contract.

## Options

| Option | Funding | Who holds | Who releases | Agent-ready? | Neutral? |
| --- | --- | --- | --- | --- | --- |
| Escrow.com API | Wire, ACH, card | Escrow.com (licensed escrow company) | Buyer accepts by API (`PATCH … action: accept`); acceptance is automatic when the inspection period lapses. Disputes go to human case managers | Callable by API, but built for human parties | No |
| Stripe Connect (manual payouts, separate charges and transfers) | Card, bank, Shared Payment Token | The platform's Stripe balance | The platform | Buildable. Stripe "doesn't provide escrow services or support escrow accounts." Payout holding limit: 2 years US, 90 days most other countries, 10 days Thailand | No |
| Stripe manual-capture hold | Card and some wallets | The card issuer, through the authorization | The merchant or platform captures or cancels | Card holds last 7 days for customer-initiated payments, about 4 days 18 hours for Visa merchant-initiated (Stripe, "Place a hold on a payment method", https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) | No |
| Commerce Payments Protocol (Coinbase, Shopify; June 2025) | USDC on Base (ERC-3009 and other token collectors) | `AuthCaptureEscrow` contract | The operator captures or voids; the payer reclaims after expiry; refunds after capture | Open source; anyone can be an operator. Not marketed for agents | Custody yes; release depends on the operator |
| ERC-8183 / Virtuals ACP | Crypto | Contract | One named evaluator; "no dispute resolution or arbitration"; anyone can refund after expiry | Agent-native; low real use (about $5.6M of job-escrow outflows from registered agents, AFG analysis, October 20, 2026) | Partly |
| Kustodia (June 4, 2026, paid press release) | Not stated | Arbitrum contract (upgradeable) | Inconsistent descriptions | MCP tools claimed | Unclear: upgradeable contract |
| Boson x402B (April/May 2026) | Not stated | Non-custodial escrow contract | Buyer confirms; game-theoretic disputes escalate to resolvers | Claimed; no usage data | Unclear |
| x402r (2026, hackathon stage) | Stablecoins | Escrow contract | Arbiter on dispute | Early | Unclear |
| Trustless Work | USDC on Stellar | Contract | Roles: approver, release signer, dispute resolver (docs incomplete) | API and SDK; no agent focus documented | Depends on role assignment |

## Anthropic API credits

API credits cannot serve as escrow value.
- Supplemental Credit Terms (March 4, 2024): "Customer may not transfer or sell Credits." Only the account holder may use credits. They have no cash value, are non-refundable, and expire one year after issue.
- Commercial Terms (June 17, 2025), §D.4(a): no resale of the Services except as expressly approved. §A.1 permits powering your own products for your own customers. §D.5: the customer is responsible for all activity under its account.
- The Admin API's spend limits cap per-member spend for Claude Enterprise organizations. They do not reserve or allocate a balance.

## Sources

- Stripe Docs, "Using manual payouts." https://docs.stripe.com/connect/manual-payouts
- Stripe Docs, "Place a hold on a payment method." https://docs.stripe.com/payments/place-a-hold-on-a-payment-method (copy in `sources/`)
- Escrow.com API Guide, "Accepting items in a transaction." https://ESCROW.COM/api/docs/accept-transaction-items
- Shopify Engineering, "Commerce Payments Protocol," June 2025. https://shopify.engineering/commerce-payments-protocol
- base/commerce-payments repository summary (TomeVault listing). https://tomevault.io/tome/base/commerce-payments
- ERC-8183: Agentic Commerce, draft, February 25, 2026. https://eips.ethereum.org/EIPS/eip-8183
- Cointelegraph (press release), Kustodia, June 4, 2026. https://cointelegraph.com/press-releases/kustodia-launches-the-missing-escrow-layer-for-ai-agents-and-x402-payments
- OurCryptoTalk, Boson x402B, May 7, 2026. https://ourcryptotalk.com/news/boson-protocol-launches-x402b-escrow-agent-commerce
- Product Hunt, x402r. https://www.producthunt.com/products/x402r-refund-protocol
- Labarna AI, "Autonomous Agents and Escrow: Capabilities and Limitations," August 6, 2026. https://www.labarna.ai/blog/autonomous-agents-escrow-capabilities-limitations
- Trustless Work docs. https://docs.trustlesswork.com/trustless-work
- Anthropic Supplemental Credit Terms. https://www.anthropic.com/legal/credit-terms
- Anthropic Commercial Terms of Service. https://www.anthropic.com/legal/commercial-terms
- Claude Platform Docs, Spend Limits API. https://platform.claude.com/docs/en/manage-claude/spend-limits-api
