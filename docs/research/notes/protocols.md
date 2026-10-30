# How agent-to-agent interoperability protocols represent and enforce commitments (state as of October 29, 2026)

Scope note for the report writer:
- **Access dates.** All sources were accessed October 29, 2026 unless stated otherwise.
- **Labels.** "Spec-defined" means text in the normative spec or proto file. "Vendor/foundation claim" means the statement appears only in a press release, blog, or marketing page by an interested party.
- **Quotes.** Each source has at most ONE verbatim quote, marked **Quote:**, and every quote is under 15 words. Everything else is paraphrase.
- **What could not be checked.** The web-search budget ran out partway through, and GitHub API access was blocked. As a result, KQML primary documents, the FIPA Contract Net and ACL Message Structure originals, Eclipse LMOS protocol details, llms.txt, and live GitHub star counts were NOT verified. These are listed under Gaps.

---

## 1. Google's Agent2Agent (A2A) protocol: task object and state machine, Agent Cards, signatures, push notifications, extensions, current version, commitment semantics, and the AP2 payment hand-off

### Takeaway
A2A v1.0 (March 12, 2026; patch 1.0.1 on May 26, 2026) defines a rich *task lifecycle*:
- 8 task states, 4 of them terminal and immutable;
- signed Agent Cards (JWS over JCS-canonicalized JSON);
- task-scoped webhooks with only "at least once attempt" delivery;
- a URI-keyed extension mechanism.

The spec has no notion of a binding commitment, SLA, acceptance, or liability. The initial state, `TASK_STATE_SUBMITTED`, means only that the task was submitted and acknowledged, so the spec never separates "received" from "committed." Anything commitment-like (payment terms, signed consent, non-repudiation) is pushed into extensions: AP2 and x402.

### Cited Findings

**Version and governance**
- **Latest release.** A2A 1.0.0 is dated 2026-03-12. Patch 1.0.1 (2026-05-26) fixes the `application/a2a+json` media type, error transcoding, and the TaskStatus values in the spec. — [A2A Project, CHANGELOG.md](https://raw.githubusercontent.com/a2aproject/A2A/main/CHANGELOG.md)
- **Spec header.** It still names 1.0.0 as the latest released version. Prior versions listed: 0.3.0, 0.2.6, 0.1.0. — [A2A Protocol Specification (main branch)](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
  - CAVEAT: I pulled the spec text from the `main` branch on Oct 29, 2026, so it may include edits made after 1.0.1. An example is §7.6.4, "In-Task Authorization Scope."
- **CONFLICT on version.** A German trade article's URL slug suggests an "A2A-Protokoll 1.2" announced at Cloud Next 2026 (cloudmagazin.com, 2026-04-25). The page failed to load and could not be verified. The repo CHANGELOG shows no 1.1 or 1.2 release. — [cloudmagazin.com (unverified)](https://www.cloudmagazin.com/2026/04/25/a2a-protokoll-1-2-cloud-next-2026-istio-service-mesh-dach-architekten/); [A2A CHANGELOG](https://raw.githubusercontent.com/a2aproject/A2A/main/CHANGELOG.md)
- **Normative source.** §1.4 declares the proto file (`spec/a2a.proto`) the sole authoritative definition of all protocol data objects. JSON and SDKs are derived from it. — [A2A spec §1.4](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **v1.0 breaking changes:**
  - enums move to SCREAMING_SNAKE_CASE (e.g., `TASK_STATE_WORKING`);
  - the `final` field is removed from `TaskStatusUpdateEvent`;
  - OAuth implicit/password flows are removed, and device-code and PKCE are added;
  - `tasks/list` is added;
  - multi-tenancy is added;
  - spelling is standardized to "canceled."
  — [A2A CHANGELOG 1.0.0](https://raw.githubusercontent.com/a2aproject/A2A/main/CHANGELOG.md); [What's New in A2A v1.0](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/whats-new-v1.md)
- **Origin.** Google announced A2A on April 9, 2025, with 50+ technology partners. **Quote:** "A2A is an open protocol that complements Anthropic's Model Context Protocol (MCP)" (location: body, passage introducing the design principles). — [Surapaneni et al., Google Developers Blog, Apr 9, 2025](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- **Governance history.**
  - Donated to the Linux Foundation in June 2025; IBM's ACP merged into it in August 2025.
  - An AAIF blog dated **August 17, 2026** announces that A2A is joining AAIF as a hosted project (paraphrased; exact wording not verified). — [AAIF, "A2A joins AAIF," Aug 17, 2026](https://aaif.io/blog/a2a-joins-aaif)
  - CONFLICT: a secondary guide dates the AAIF move to December 2025. — [ChatForest guide (undated, secondary)](https://chatforest.com/guides/a2a-protocol-v1-production-ready/). Prefer the AAIF primary source.
- **Technical Steering Committee.** The v1.0 TSC reportedly includes AWS, Cisco, Google, IBM Research, Microsoft, Salesforce, SAP, and ServiceNow. Secondary source only. — [ChatForest (secondary)](https://chatforest.com/guides/a2a-protocol-v1-production-ready/)

**Task object and state machine (spec-defined)**
- **`Task` fields** — [a2a.proto, `message Task`](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto):
  - `id` (required, server-generated);
  - `context_id`;
  - `status` (required): `state`, optional `message`, `timestamp`;
  - `artifacts[]`;
  - `history[]` (Messages);
  - `metadata` (Struct).
- **`TaskState` enum** — [a2a.proto, `enum TaskState`](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto):
  - `UNSPECIFIED`;
  - `SUBMITTED` (proto comment: submitted and acknowledged);
  - `WORKING`;
  - `COMPLETED` (terminal);
  - `FAILED` (terminal);
  - `CANCELED` (terminal);
  - `INPUT_REQUIRED` (labelled an interrupted state);
  - `REJECTED` (terminal);
  - `AUTH_REQUIRED` (interrupted).
  - **Quote** (location: comment on `TASK_STATE_REJECTED`): "Indicates that the agent has decided to not perform the task." The same comment says rejection may happen at creation or later, once the agent determines it can't or won't proceed.
- **Terminal behavior.** Terminal tasks reject further messages with `UnsupportedOperationError` (§3.1.1). Streams MUST close at a terminal state (§3.1.2). — [A2A spec §3.1.1–3.1.2](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Task immutability.** **Quote:** a terminal task "cannot restart" (location: §Task Immutability). Refinements must open a new task in the same `contextId`. — [A2A docs, "Life of a Task"](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/topics/life-of-a-task.md)
- **Blocking vs non-blocking send (§3.2.2).** A blocking `SendMessage` MUST wait for a terminal or interrupted state. A non-blocking send returns at once, and the caller is responsible for polling, subscribing, or using push. — [A2A spec §3.2.2](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Cancellation is best-effort.** **Quote:** "The server will attempt to cancel the task, but success is not guaranteed" (location: §3.1.5 Cancel Task). — [A2A spec §3.1.5](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Idempotency (§3.3.1).** SendMessage is only optionally idempotent (agents may dedupe on `messageId`). Cancel is idempotent. — [A2A spec §3.3.1](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **History retention (§3.7).** Persistence of task history is not guaranteed; agents decide which Messages are kept. — [A2A spec §3.7](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Auth-required semantics are explicitly undefined (§7.6.4).** The protocol leaves the scope, representation, validity, and revocation of any authorization obtained undefined. A state transition alone MUST NOT be treated as authorization. Chains of `AUTH_REQUIRED` across delegating agents are allowed (§7.6.2). — [A2A spec §7.6](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **No SLA language.** A full-text search of the spec found zero occurrences of "SLA," "service level," or contractual "commitment." "Guarantee" appears only for cancel (not guaranteed), history (not guaranteed), and push delivery. — [A2A spec (full text)](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)

**Agent Cards and signatures (spec-defined)**
- **Discovery.** Agent Cards are served at `https://{server_domain}/.well-known/agent-card.json` (§8; IANA well-known registration in §14.3). An authenticated "extended" card is available via `GetExtendedAgentCard`. — [A2A spec §8, §3.1.11, §14.3](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **`AgentSkill` fields:** `id`, `name`, `description`, `tags`, `examples`, `input_modes`, `output_modes`, `security_requirements`. There are no price, latency, availability, or terms fields. — [a2a.proto, `message AgentSkill`](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto)
- **Signing is optional (§8.4).** Cards may be signed with JWS (RFC 7515) after JCS canonicalization (RFC 8785). The `signatures` field is excluded from the signed content (§8.4.1–8.4.2). `AgentCardSignature` = {`protected` (required), `signature` (required), `header`}. — [A2A spec §8.4](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md); [a2a.proto](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto)
  - The signature attests only to the card's authenticity and integrity, i.e., a capability *advertisement*. Core defines no message, task, or artifact signing.

**Push notifications (spec-defined)**
- **Config.** `TaskPushNotificationConfig` = {`tenant`, `id`, `task_id`, `url` (required), `token`, `authentication`}. It is scoped to **one task**.
  - CRUD operations are in §3.1.7–3.1.10.
  - The agent must advertise `capabilities.pushNotifications: true`.
  — [a2a.proto](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto); [A2A spec §3.5.1](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Payload.** A `StreamResponse` containing exactly one of: task, message, statusUpdate, or artifactUpdate. It is POSTed as `application/a2a+json` (§4.3.3).
- **"Server Guarantees" (§4.3.3):**
  - the agent must attempt delivery at least once per configured webhook;
  - retry with exponential backoff is optional;
  - a 10–30 s timeout is recommended;
  - the agent may stop trying after a configured number of consecutive failures.
- **Client duties:** answer with 2xx, process idempotently (duplicates may arrive), and validate the task ID.
- **Security (§13.2):** SSRF protections.
— [A2A spec §4.3.3, §13.2](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Streaming order (§3.5.2).** Events must be delivered in generation order, and all concurrent streams receive identical sequences. — [A2A spec §3.5.2](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)

**Extensions (spec-defined plus docs)**
- **`AgentExtension`** = {`uri`, `description`, `required` (bool: client must understand and comply), `params`}. — [a2a.proto](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto)
- **Rules (§4.6.1–4.6.3).**
  - Message and Artifact extensions are keyed by URI in `extensions[]` plus `metadata`.
  - Breaking changes require a new URI.
  - An unsupported required extension MUST produce an error, with no silent fallback.
  — [A2A spec §4.6](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Documented extension types:**
  - Data-only (example: GDPR-compliance info in the card);
  - Profile (narrowing allowed values; metadata sub-states);
  - Method (new RPCs);
  - State Machine. **Quote:** "Adding new states or transitions to the task state machine." (location: "Types of extensions" list).
  - Required extensions oblige clients to comply; non-compliant requests should be rejected (§Required Extensions).
  — [A2A docs, "Extensions"](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/topics/extensions.md)
- **Extension governance.** Two tiers: Official and Experimental. Official URIs use the prefix `https://a2a-protocol.org/extensions/` and live in `ext-{name}` repos under `a2aproject`, recommended by the TSC. — [A2A docs, "Extension and Protocol Binding Governance"](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/topics/extension-and-binding-governance.md)

**Hand-off to payment: AP2 and x402 (extension-defined)**
- **AP2 launch (Sept 16, 2025)** by Stavan Parikh and Rao Surapaneni, with 60+ collaborating organizations. — [Parikh & Surapaneni, Google Cloud Blog, Sept 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol/?hl=en). VENDOR CLAIM; the non-repudiation is asserted, not independently evaluated.
  - Mandates are described as cryptographically signed digital contracts, signed via verifiable credentials.
  - **Quote:** the intent→cart→payment sequence "creates a non-repudiable audit trail" (location: section on how AP2 builds trust).
  - Two modes: human-present and human-not-present (delegated).
  - AP2 is positioned as usable as an extension of both A2A and MCP.
  - An A2A x402 extension was built with Coinbase, the Ethereum Foundation, and MetaMask.
- **AP2 A2A extension page** (still labelled v0.1-alpha; URI `https://github.com/google-agentic-commerce/ap2/tree/v0.1`). — [AP2, "A2A Extension"](https://ap2-protocol.org/a2a-extension)
  - Roles: merchant, shopper, credentials-provider, payment-processor.
  - IntentMandate is sent as an A2A Message DataPart keyed `ap2.mandates.IntentMandate` (fields include `intent_expiry` and `required_refundability`).
  - CartMandate is an A2A **Artifact** carrying `merchant_signature`.
  - PaymentMandate is a Message carrying `user_authorization`.
  - **Quote:** "Agents that perform the "merchant" role SHOULD set the AP2 extension to required." (location: §AgentCard Extension Object)
- **AP2 v0.2.** CHANGELOG: 0.1.0 on 2025-09-16; 0.2.0 ("Release of V2") on 2026-04-28. v0.2 restructures the mandates. — [AP2 v0.2 specification](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/specification.md); [AP2 CHANGELOG](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/CHANGELOG.md)
  - Mandates are now **Checkout Mandate + Payment Mandate**, secured as SD-JWT VCs and versioned via the `vct` claim (e.g., `mandate.checkout.open.1`).
  - The merchant must supply a merchant-signed Checkout JWT, and the closed Checkout Mandate is hash-bound to it.
  - The merchant must return a Checkout Receipt whether it accepts or rejects. The payment processor must return a signed Payment Receipt.
  - AP2 describes itself as a security layer inside a commerce protocol, designed for UCP compatibility.
  - Dispute-resolution procedure and retention are out of scope.
  - **Quote** (location: §Agent-to-Agent Delegation): "This is outside the scope of the current specification." This refers to delegating mandates from one shopping agent to another.
  - Extension points: Mandate Constraints (type + schema + evaluation algorithm), Checkout Object, Payment Instrument, VDC formats.
- **AP2 open vs closed mandates.** — [AP2, "Agent Authorization"](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/agent_authorization.md)
  - An *open* mandate carries constraints. **Quote:** it is "bound to a particular Agent who is allowed to use the Mandate" (location: §Mandate Structure).
  - A *closed* mandate is bound to one transaction via a Key-Binding JWT (proof of possession), using the key in the open mandate's `cnf` claim.
  - Delegation runs through a Trusted Surface and OpenID4VP.
- **Example constraint.** `checkout.allowed_merchants`: the merchant must appear among the revealed elements. — [AP2, "Checkout Mandate"](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/checkout_mandate.md)
- **AP2 and UCP.** UCP's Checkout Object plays the role of AP2's CartMandate. The merchant signs the Checkout. The CheckoutMandate gives the merchant proof of what the user agreed to buy. The page does not address dispute or liability allocation. — [AP2, "AP2 and UCP" (undated)](https://ap2-protocol.org/topics/ap2-and-ucp)
  - The LF press release (Apr 9, 2026) also states that UCP is compatible with AP2 through an AP2 mandates extension. — [Linux Foundation, Apr 9, 2026](https://linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)
- **A2A x402 extension v0.1** (URI `https://github.com/google-a2a/a2a-x402/v0.1`). — [A2A x402 Extension spec v0.1](https://raw.githubusercontent.com/google-agentic-commerce/a2a-x402/main/spec/v0.1/spec.md); [a2a-x402 README](https://raw.githubusercontent.com/google-agentic-commerce/a2a-x402/main/README.md)
  - Payment terms ride on an `input-required` Task, with `x402.payment.status` in the message metadata.
  - Status values: payment-required, payment-submitted, payment-rejected, payment-verified, payment-completed, payment-failed.
  - The client signs a payment payload; the merchant verifies, settles on-chain, and returns an `x402PaymentReceipt`.
  - **Quote:** the merchant "SHOULD ensure that the requested work is completed before settling the payment" (location: §4.2 Architecture).
  - The Task may stay `working` after payment until the artifact is produced (§4.5).

**Adoption metrics (A2A / AP2)**
- **LF press release, Apr 9, 2026.** FOUNDATION CLAIM; "supporting organizations" ≠ production deployments. — [Linux Foundation press release, Apr 9, 2026](https://linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)
  - 150+ supporting organizations (up from 50+ in April 2025).
  - Core repo past 22,000 GitHub stars.
  - Five production SDKs.
  - Named integrations: Microsoft Azure AI Foundry and Copilot Studio; AWS Amazon Bedrock AgentCore Runtime.
  - AP2: 60+ organizations.
  - **Quote** (Luca Muscariello, Cisco): "A2A has emerged as the syntactic layer that makes agent‑to‑agent communication reliable."
- **AAIF blog, Aug 17, 2026.** FOUNDATION CLAIM; no independent confirmation found. — [AAIF blog, Aug 17, 2026](https://aaif.io/blog/a2a-joins-aaif)
  - Huawei uses A2A between its Celia assistant and in-app agents on HarmonyOS.
  - Tencent WeChat integrates with Android OEM assistants over A2A.
  - Google Cloud and PayPal are extending A2A with AP2.
- **Secondary figures.** 23,200+ stars and 556 commits (undated); AAIF at 146 members (attributed to Techzine). Treat as unverified. — [ChatForest (secondary, undated)](https://chatforest.com/guides/a2a-protocol-v1-production-ready/)

### Inferences
- **Procedural, not normative.** A2A gives a *procedural* commitment trace: who accepted, the current state, whether the task terminated. It gives no *normative* commitment: what was promised, by when, and with what remedy. `SUBMITTED` merges FIPA's "received" and "agree."
- **`REJECTED` does double duty.** It covers both pre-commitment refusal and mid-execution withdrawal. That mirrors FIPA's use of `refuse` both to decline and to drop a request-when commitment, but without FIPA's stated persistence semantics.
- **Signed advertisements only.** The only cryptographic object in core A2A is the signed Agent Card. It is not a signed *offer* or *acceptance*.
- **Commitments live in extensions.** Non-repudiable commitments enter only via AP2/UCP mandates (SD-JWT VCs signed by user or agent keys). The pattern: A2A carries the conversation; the extension carries signed terms. The x402 extension shows a "profile extension" turning `INPUT_REQUIRED` into an offer/acceptance step (payment-required → payment-submitted).
- **Webhook silence means nothing.** At-least-once *attempt*, with giving up allowed, means a delegating agent cannot read webhook silence as non-completion. It must poll.

### Gaps
- Full A2A `AgentCard` and `AgentCapabilities` field lists are rendered from proto in the spec and were only partially captured. Re-read a2a.proto `message AgentCard` if exact names are needed.
- I could not confirm whether any official (`a2a-protocol.org/extensions/`) extension for terms, SLAs, or commitments exists. None appeared in the docs read.
- The "A2A 1.2" claim is unverified.
- Live GitHub star counts are unavailable (GitHub API blocked in this session).
- **Version inconsistency.** ap2-protocol.org's A2A-extension page still shows v0.1 mandate types (Intent/Cart/Payment), while the v0.2 spec (Apr 2026) uses Checkout/Payment. It is unclear whether the A2A extension was updated for v0.2.

### Bibliography (Chicago-style details)
- A2A Project (Linux Foundation). "Agent2Agent (A2A) Protocol Specification," version 1.0.0 (March 12, 2026; patch 1.0.1, May 26, 2026). https://a2a-protocol.org/latest/specification/ ; source https://github.com/a2aproject/A2A/blob/main/docs/specification.md. Accessed October 29, 2026. Quote location: §3.1.5 Cancel Task.
- A2A Project. "a2a.proto." https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto. Accessed October 29, 2026. Quote location: comment on `TASK_STATE_REJECTED`.
- A2A Project. "CHANGELOG.md." https://github.com/a2aproject/A2A/blob/main/CHANGELOG.md. Accessed October 29, 2026.
- A2A Project. "What's New in A2A Protocol v1.0." https://github.com/a2aproject/A2A/blob/main/docs/whats-new-v1.md.
- A2A Project. "Extensions." https://github.com/a2aproject/A2A/blob/main/docs/topics/extensions.md. Quote location: "Types of extensions" list.
- A2A Project. "Life of a Task." https://github.com/a2aproject/A2A/blob/main/docs/topics/life-of-a-task.md. Quote location: §Task Immutability.
- A2A Project. "Extension and Protocol Binding Governance." https://github.com/a2aproject/A2A/blob/main/docs/topics/extension-and-binding-governance.md.
- Surapaneni, Rao, Miku Jha, Michael Vakoc, and Todd Segal. "Announcing the Agent2Agent Protocol (A2A)." Google Developers Blog, April 9, 2025. https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/.
- Linux Foundation. "A2A Protocol Surpasses 150 Organizations, Lands in Major Cloud Platforms, and Sees Enterprise Production Use in First Year." Press release, April 9, 2026. https://linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year. Quote location: Luca Muscariello quote.
- Agentic AI Foundation. "A2A Joins AAIF." AAIF Blog, August 17, 2026. https://aaif.io/blog/a2a-joins-aaif.
- Parikh, Stavan, and Rao Surapaneni. "Announcing Agent Payments Protocol (AP2)." Google Cloud Blog, September 16, 2025. https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol.
- AP2 Project. "A2A Extension" (v0.1-alpha). https://ap2-protocol.org/a2a-extension. Accessed October 29, 2026.
- AP2 Project. "Agentic Payment Protocol (v0.2)." GitHub, google-agentic-commerce/AP2, docs/ap2/specification.md, released April 28, 2026. https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md.
- AP2 Project. "Agent Authorization." https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/agent_authorization.md.
- AP2 Project. "Checkout Mandate." https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/checkout_mandate.md.
- AP2 Project. "AP2 and UCP." https://ap2-protocol.org/topics/ap2-and-ucp. Undated; accessed October 29, 2026.
- Google Agentic Commerce. "A2A Protocol: x402 Payments Extension v0.1." https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.1/spec.md.
- ChatForest. "A2A Protocol v1: Production Ready." Undated guide (secondary). https://chatforest.com/guides/a2a-protocol-v1-production-ready/.

---

## 2. Anthropic's Model Context Protocol (MCP): latest revision, tasks/async, elicitation, sampling, OAuth 2.1, and whether it is agent-to-agent or agent-to-tool

### Takeaway
The current MCP revision is **2026-07-28**, released July 28, 2026. It:
- makes the protocol stateless (no sessions, no initialize handshake);
- moves Tasks out of core into the official `io.modelcontextprotocol/tasks` extension;
- replaces server-initiated requests (elicitation, sampling, roots) with a Multi Round-Trip Request (`input_required`) pattern;
- deprecates Sampling, Roots, and Logging;
- replaces resource subscriptions with `subscriptions/listen`.

MCP remains structurally *client-host-server*, i.e., agent-to-tool. Its task model is weaker than A2A's on commitment:
- no submitted or rejected state;
- cancellation explicitly non-binding;
- notifications optional;
- receivers may delete tasks after TTL whatever their status.

The roadmap (Aug 22, 2026) names agent communication, webhooks, and Triggers & Events as priorities.

### Cited Findings

**Versions and dates**
- `/specification/latest` redirects to `/specification/2026-07-28`. — [MCP docs.json (redirects)](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/docs.json)
- **Release post** (July 28, 2026; David Soria Parra and Den Delimarsky) officially releases 2026-07-28. MAINTAINER CLAIM. — [MCP Blog, "The 2026-07-28 Specification," July 28, 2026](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
  - **Quote** (location: opening paragraph): "close to half-a-billion downloads a month" across Tier 1 SDKs.
  - The TypeScript and Python SDKs have each passed 1 billion total downloads.
- **Previous revision: 2025-11-25.** It added experimental tasks (SEP-1686), URL-mode elicitation (SEP-1036), tool calling in sampling (SEP-1577), OpenID Connect discovery, Client ID Metadata Documents, and incremental scope consent. — [MCP 2025-11-25 Key Changes](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2025-11-25/changelog.mdx)

**2026-07-28 major changes (spec-defined)** — [MCP 2026-07-28 Key Changes](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/changelog.mdx)
- **Stateless core.** Removes protocol-level sessions and `Mcp-Session-Id` (SEP-2567). Removes the `initialize` handshake: protocol version and client capabilities now ride in `_meta` on every request. Adds a mandatory `server/discover` (SEP-2575).
- **Subscriptions.** `subscriptions/listen` replaces the HTTP GET endpoint and `resources/subscribe` (SEP-2575).
- **No resumability.** SSE resumability is removed: a broken stream drops the in-flight request, and clients must re-issue it.
- **Tasks move out of core.** **Quote** (location: Major changes, item 6): "Move experimental tasks out of the core protocol and into an official extension."
  - The redesign replaces blocking `tasks/result` with polling `tasks/get`.
  - It adds `tasks/update` and removes `tasks/list`.
  - Servers may return task handles unsolicited (SEP-2663).
- **MRTR (SEP-2322).** Servers return `resultType: "input_required"` with `inputRequests`. Clients retry the request with `inputResponses`.
- **Deprecations.**
  - Roots, Sampling, and Logging (SEP-2577). For Sampling, the suggested migration is to call LLM provider APIs directly.
  - Dynamic Client Registration, in favor of Client ID Metadata Documents.
  - A new feature lifecycle policy sets a minimum 12-month deprecation window (SEP-2596).

**Tasks (commitment-relevant semantics)**
- **2025-11-25 core tasks** (superseded but still referenced). — [MCP 2025-11-25, basic/utilities/tasks](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2025-11-25/basic/utilities/tasks.mdx)
  - Either client or server can be the "requestor." Tasks are described as durable state machines.
  - Lifecycle: `working` → `input_required` / `completed` / `failed` / `cancelled`. Terminal states cannot transition.
  - TTL (§TTL and Resource Management): receivers may override the requested TTL. Once TTL elapses, they may delete the task and its results regardless of status.
  - **Quote** (location: §Task Status Notification): "Requestors MUST NOT rely on receiving this notifications, as it is optional."
- **2026-07-28 Tasks extension** (`io.modelcontextprotocol/tasks`; schema version 2026-07-28 marked "Stable"; based on SEP-2663). — [MCP Docs, Extensions › Tasks overview](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/extensions/tasks/overview.mdx); [ext-tasks README](https://raw.githubusercontent.com/modelcontextprotocol/ext-tasks/main/README.md); [MCP Blog, July 28, 2026](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
  - `CreateTaskResult` (`resultType: "task"`) carries `taskId`, status, `ttlMs`, and `pollIntervalMs`. The task must be durably created before the response is sent.
  - Mid-flight input arrives as `inputRequests` and is answered via `tasks/update`.
  - **Quote** (location: lifecycle step 6, "Cancellation"): the server "acknowledges the intent but is not obligated to stop the work."
  - Notifications via `subscriptions/listen` are optional; polling is the default.
  - Per Swami Sivasubramanian's quote in the release post, AWS contributed Tasks.
- **AAIF migration guide** (Akash Jaiswal, July 21, 2026; written against the release candidate) confirms the same five states. **Quote:** cancellation is honored "when possible." — [AAIF Blog, Jul 21, 2026](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate)

**Subscriptions and notifications (spec-defined)**
- The client opts into `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, or `resourceSubscriptions` (URIs). — [MCP 2026-07-28, basic/patterns/subscriptions](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/basic/patterns/subscriptions.mdx)
- **Quote** (location: §Opening a Stream): "The server MUST NOT send notification types the client has not explicitly requested."
- The server must first send `notifications/subscriptions/acknowledged`, listing which requested subset it agreed to deliver.

**Elicitation and sampling**
- **Elicitation** (a client feature) keeps form mode and URL mode. Servers must not collect passwords, API keys, tokens, or payment credentials via form mode; they must use URL mode for those. — [MCP 2026-07-28, client/elicitation](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/client/elicitation.mdx)
- **Transport change.** In 2026-07-28, `elicitation/create` and `sampling/createMessage` travel inside MRTR `inputRequests` rather than as server-initiated requests. `requestState` is opaque to clients. — [MCP 2026-07-28, basic/patterns/mrtr](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/basic/patterns/mrtr.mdx)
- **Sampling** is deprecated (see changelog above).

**Authorization (spec-defined)** — [MCP 2026-07-28, basic/authorization](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/basic/authorization/index.mdx); [MCP docs.json extension list](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/docs.json)
- References OAuth 2.1 (draft-ietf-oauth-v2-1-13). The MCP server acts as an OAuth 2.1 resource server.
- Servers must implement RFC 9728 Protected Resource Metadata. Clients must implement RFC 8707 Resource Indicators.
- 2026-07-28 adds RFC 9207 `iss` validation and issuer-bound client credentials (SEP-2352), and deprecates DCR.
- Official auth extensions include Enterprise-Managed Authorization and OAuth client credentials.

**Agent-to-agent vs agent-to-tool**
- **Architecture.** The spec uses a client-host-server model. **Quote** (location: §Clients): "Each client is created by the host and communicates with exactly one server." — [MCP 2026-07-28, architecture](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/architecture/index.mdx)
- **A2A's view.** Appendix B of the A2A spec places MCP as the agent-to-tool layer and A2A as peer-to-peer. An A2A server agent may use MCP internally to fulfill an A2A task. — [A2A spec, Appendix B](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **Roadmap (Aug 22, 2026).** — [Soria Parra & Delimarsky, "The New MCP Roadmap," MCP Blog, Aug 22, 2026](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/)
  - The March 2026 roadmap listed agent communication as one of four priority areas.
  - The new "Agentic messaging primitives" area includes server-initiated events. **Quote** (location: §Agentic messaging primitives): "webhooks and channels, so clients aren't left polling for results."
  - It also includes a composition review across the Agents, Transports, and Triggers & Events Working Groups, and maturing Tasks into core.
  - "Agent identity" covers agents acting for an absent user or delegating narrower authority to sub-agents.
- **In practice, agents are exposed as MCP servers.** Example: **Quote** (location: §NLWeb and MCP/A2A): every NLWeb instance "acts as an MCP server (and soon A2A)." — [Microsoft NLWeb README](https://raw.githubusercontent.com/microsoft/NLWeb/main/README.md)

**Adoption metrics (MCP)**
- **Anthropic (c. Dec 9, 2025).** VENDOR CLAIM. — [Anthropic, "Donating the Model Context Protocol and establishing the Agentic AI Foundation," c. Dec 9, 2025](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)
  - **Quote** (location: ecosystem bullet list): "more than 10,000 active public MCP servers."
  - 97M+ monthly SDK downloads (Python and TypeScript).
  - Adopted by ChatGPT, Cursor, Gemini, and others.
- **AAIF formation (Dec 9, 2025).** Founding projects: MCP, goose, and AGENTS.md. Platinum members: AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI. — [Linux Foundation press release, Dec 9, 2025](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- **July 2026.** Roughly half a billion monthly Tier-1 SDK downloads. MAINTAINER CLAIM; download counts include CI and transitive installs. — [MCP Blog, July 28, 2026](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

### Inferences
- **The receiver holds the cards.** MCP task semantics let the receiver override TTL, delete results after TTL regardless of status, ignore cancellation, and skip notifications. That is the opposite of a commitment: the requestor holds a handle, not a promise.
- **No refusal state.** MCP has no `submitted` or `rejected` state. A receiver can refuse only by declining task augmentation or returning an error; there is no first-class "I decline this delegated job" state.
- **Parallel pause states.** MRTR/`input_required` parallels A2A `INPUT_REQUIRED`/`AUTH_REQUIRED`. Both model a pause for missing information. Neither models a "proposal awaiting acceptance."
- **Less peer-like than before.** With sampling deprecated and server-initiated requests removed, 2026-07-28 moved MCP further from peer-to-peer symmetry. The roadmap's agent-communication work sits inside a client-server frame.

### Gaps
- The full normative spec for `io.modelcontextprotocol/tasks` lives in modelcontextprotocol/ext-tasks and was only partly read (README and overview). Exact field schema and error codes were not captured.
- No independent (non-maintainer) count of MCP servers in production was found.
- Charters for the Agents and Triggers & Events Working Groups were not retrieved.

### Bibliography (Chicago-style details)
- Model Context Protocol. "Specification, Version 2026-07-28: Key Changes." July 28, 2026. https://modelcontextprotocol.io/specification/2026-07-28/changelog (source: github.com/modelcontextprotocol/modelcontextprotocol, docs/specification/2026-07-28/changelog.mdx). Quote location: Major changes, item 6.
- Model Context Protocol. "Specification, Version 2025-11-25: Tasks." https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks. Quote location: §Task Status Notification.
- Model Context Protocol. "Extensions: Tasks — Overview." https://modelcontextprotocol.io/extensions/tasks/overview. Accessed October 29, 2026. Quote location: lifecycle step 6.
- Model Context Protocol. "MCP Tasks Extension" (README). GitHub, modelcontextprotocol/ext-tasks. https://github.com/modelcontextprotocol/ext-tasks.
- Model Context Protocol. "Specification 2026-07-28: Subscriptions." https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions. Quote location: §Opening a Stream.
- Model Context Protocol. "Specification 2026-07-28: Architecture." https://modelcontextprotocol.io/specification/2026-07-28/architecture. Quote location: §Clients.
- Model Context Protocol. "Specification 2026-07-28: Authorization"; "Multi Round-Trip Requests"; "Elicitation." https://modelcontextprotocol.io/specification/2026-07-28/.
- Soria Parra, David, and Den Delimarsky. "The 2026-07-28 Specification." Model Context Protocol Blog, July 28, 2026. https://blog.modelcontextprotocol.io/posts/2026-07-28/. Quote location: opening paragraph.
- Soria Parra, David, and Den Delimarsky. "The New MCP Roadmap." Model Context Protocol Blog, August 22, 2026. https://blog.modelcontextprotocol.io/posts/mcp-roadmap/. Quote location: §Agentic messaging primitives.
- Jaiswal, Akash. "MCP 2026-07-28: What's Changing and How to Migrate." Agentic AI Foundation Blog, July 21, 2026. https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate.
- Anthropic. "Donating the Model Context Protocol and Establishing the Agentic AI Foundation." Anthropic News, December 2025 (exact date not captured; coincides with the LF release of December 9, 2025). https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation. Quote location: ecosystem bullet list.
- Linux Foundation. "Linux Foundation Announces the Formation of the Agentic AI Foundation." Press release, December 9, 2025. https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation.

---

## 3. Other protocols (IBM/BeeAI ACP and its merger into A2A, ANP, AGNTCY/SLIM, MIT NANDA, Eclipse LMOS, 2026 newcomers) and measurable adoption

### Takeaway
The field consolidated around A2A (peer-to-peer tasks) and MCP (tools), both now under the Linux Foundation's AAIF.
- **ACP** merged into A2A in August 2025 and stopped active development.
- **AGNTCY/SLIM** position themselves as *infrastructure* beneath A2A and MCP (discovery, identity, transport), not as competing semantics.
- **ANP** (W3C Community Group) is the main decentralized alternative: DID-based identity, released v1.2 core docs, a draft negotiation meta-protocol, and a draft AP2 payment adaptation.
- **NANDA** is a research architecture with no reported deployments.

None of them defines commitment or SLA semantics beyond A2A's. Adoption numbers are almost entirely self-reported.

### Cited Findings

**ACP (IBM Research / BeeAI) → A2A**
- **History and merger.** IBM Research launched ACP in March 2025 for the BeeAI Platform and donated it to the Linux Foundation later that month. On Aug 29, 2025, ACP announced its merger into A2A. Authors: Kate Blair (IBM Research) and Todd Segal (Google). **Quote:** "the ACP team will be winding down active development" (location: paragraph following Blair's quote). — [Blair & Segal, "ACP Joins Forces with A2A," LF AI & Data Community Blog, Aug 29, 2025](https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/)
- **Repo status and concepts.** **Quote** (location: README banner): "ACP is now part of A2A under the Linux Foundation!" A migration guide is linked. ACP's concepts were Agent Manifest, Run (sync or streaming), Await (pause for client input, then resume), and Sessions / Distributed Sessions. — [i-am-bee/acp README](https://raw.githubusercontent.com/i-am-bee/acp/main/README.md)
- **Confirmation.** The AAIF blog (Aug 17, 2026) confirms the August 2025 merger. — [AAIF, Aug 17, 2026](https://aaif.io/blog/a2a-joins-aaif)

**AGNTCY (Cisco-led) and SLIM**
- **LF press release (July 29, 2025).** FOUNDATION CLAIM; production use is named only generically (CI/CD, IT deployments, telecom automation). — [Linux Foundation press release, July 29, 2025](https://www.linuxfoundation.org/press/linux-foundation-welcomes-the-agntcy-project-to-standardize-open-multi-agent-system-infrastructure-and-break-down-ai-agent-silos)
  - Cisco open-sourced AGNTCY in March 2025.
  - Formative members: Cisco, Dell Technologies, Google Cloud, Oracle, Red Hat. **Quote:** "more than 65 supporting companies."
  - Components: discovery via OASF (Open Agent Schema Framework), identity, SLIM messaging, observability.
  - A2A agents and MCP servers become discoverable through AGNTCY directories.
- **AGNTCY homepage (accessed Oct 2026).** Lists Discovery (federated registry), Communications, Secure Runtime, Identity, Observability, and AgentBridge. **Quote** (location: AgentBridge card): "Connects coding agents and other CLIs over A2A." — [agntcy.org](https://agntcy.org/)
- **SLIM** (Secure Low-Latency Interactive Messaging). **Quote** (location: README intro): it "provides the secure, scalable transport layer for AI agent protocols." Bindings exist for Python, Go, .NET, and Java. — [agntcy/slim README](https://raw.githubusercontent.com/agntcy/slim/main/README.md)

**ANP (Agent Network Protocol)**
- **ANP README.** — [agent-network-protocol/AgentNetworkProtocol README](https://raw.githubusercontent.com/agent-network-protocol/AgentNetworkProtocol/main/README.md)
  - **Quote** (location: opening): "ANP aims to become the HTTP of the Agentic Web era."
  - **Layers.** Identity & Encrypted Communication (W3C DID; `did:wba` and native `did:web`), and an Application Protocol Layer (Agent Description, Discovery, Application Protocols).
  - **Released v1.2:**
    - ANP-02 DID Authentication;
    - ANP-03 did:wba;
    - ANP-04 Name Space;
    - ANP-07 Agent Description;
    - ANP-08 Agent Discovery (`.well-known`).
  - **Drafts:**
    - ANP-05 DID-Based Authorization (v0.7);
    - ANP-06 Meta-Protocol, described as a semantic negotiation layer using `anp.negotiate` and explicitly outside the released architecture;
    - ANP-10 AP2 Payment Adaptation, explicitly not yet a stable payment interoperability standard.
- **W3C AI Agent Protocol Community Group.** This is a Community Group, not a W3C standards-track Working Group. — [W3C, AI Agent Protocol Community Group](https://www.w3.org/community/agentprotocol)
  - Launched May 8, 2025 by Gaowei Chang. Chairs: Gaowei Chang and Song XU.
  - **282 participants** (CG page, accessed Oct 29, 2026).
  - Drafts: Use case and Protocol (2025-08-19); ANP White Paper (2025-05-23).

**MIT NANDA**
- **Paper.** Raskar et al., "Beyond DNS: Unlocking the Internet of AI Agents via the NANDA Index and Verified AgentFacts," arXiv:2507.14263v1, July 18, 2025. — [arXiv:2507.14263](https://arxiv.org/abs/2507.14263v1)
  - Proposes a minimal index that resolves to cryptographically verifiable AgentFacts.
  - **Quote** (location: abstract): "schema-validated capability assertions."
  - Also claims sub-second revocation and key rotation, CRDT-based updates, and privacy-preserving discovery.
  - It is a prototype/architecture. No deployments are reported.

**Eclipse LMOS**
- An open-source multi-agent platform on Kubernetes. Components: ARC (Kotlin DSL), ADL, LMOS Protocol. PROJECT CLAIM; I did not read the protocol spec. — [Eclipse LMOS site](https://eclipse.dev/lmos/); [eclipse-lmos/arc README](https://raw.githubusercontent.com/eclipse-lmos/arc/main/README.md)
  - **Quote** (location: "LMOS is interoperable"): "leverages established open W3C standards for agent meta data description."

**Academic survey (context)**
- **Ehtesham, Singh, Gupta, and Kumar** (arXiv:2505.02279; v1 May 4, 2025; v2 May 23, 2025) survey MCP, ACP, A2A, and ANP. — [arXiv:2505.02279](https://arxiv.org/abs/2505.02279v2)
  - They propose phased adoption: MCP for tools → ACP for messaging → A2A for collaborative tasks → ANP for decentralized marketplaces.
  - **Quote** (location: abstract): "Ad-hoc integrations are difficult to scale, secure, and generalize across domains."
  - The paper predates the ACP merger, so its roadmap is partly obsolete.

**Adoption metrics summary (each with source and date)**

| Protocol | Metric | Source (date) | Independence |
|---|---|---|---|
| A2A | 50+ partners at launch | Google Developers Blog (Apr 9, 2025) | Vendor |
| A2A | 150+ supporting orgs; 22,000+ GitHub stars; 5 SDKs; Azure AI Foundry, Copilot Studio, Bedrock AgentCore | LF press release (Apr 9, 2026) | Foundation |
| A2A | Huawei HarmonyOS/Celia; Tencent WeChat; Google Cloud + PayPal AP2 | AAIF blog (Aug 17, 2026) | Foundation |
| A2A | 23,200+ stars, 556 commits | ChatForest (undated) | Secondary, unverified |
| AP2 | 60+ organizations | Google Cloud Blog (Sept 16, 2025); LF press (Apr 9, 2026) | Vendor/Foundation |
| MCP | 10,000+ active public servers; 97M+ monthly SDK downloads | Anthropic (Dec 2025) | Vendor |
| MCP | ~0.5B monthly Tier-1 SDK downloads; TS and Python each >1B total | MCP Blog (July 28, 2026) | Maintainers |
| AGNTCY | 5 formative members; 65+ supporting companies | LF press (July 29, 2025) | Foundation |
| ANP | 282 W3C CG participants | W3C CG page (accessed Oct 29, 2026) | Neutral registry count |
| ACP | merged; no metrics | LF AI & Data blog (Aug 29, 2025) | — |
| NANDA | no deployments reported | arXiv (July 18, 2025) | — |
| LMOS | none found | — | — |

### Inferences
- **The 2025 "protocol wars" resolved into layers.** A2A handles delegation semantics. MCP handles tool access. AGNTCY/SLIM provide transport, discovery, and identity under both. AP2/UCP/x402 carry signed commercial terms as extensions. Where commitment semantics exist at all, they sit in the commerce extensions, not in any base protocol.
- **ANP is the only one naming negotiation.** Its draft meta-protocol (`anp.negotiate`) is the only current LLM-era effort that explicitly names *negotiation* as a protocol layer. But it negotiates *interface/profile/schema* selection, not business terms.
- **Counts measure endorsement, not deployment.** The only named production integrations come from interested foundations or vendors.

### Gaps
- GitHub star counts for agntcy/slim, ANP, NANDA, and LMOS could not be retrieved (GitHub API blocked).
- ACP Run lifecycle states were not verified. The README lists Run and Await but not a state enum.
- Possible 2026 newcomers could not be fetched or verified. Example: Huawei "A2A-T," reportedly open-sourced at MWC in Feb 2026, per a search-result URL.
- The Eclipse LMOS protocol spec and its W3C WoT basis were not read.

### Bibliography (Chicago-style details)
- Blair, Kate, and Todd Segal. "ACP Joins Forces with A2A." LF AI & Data Community Blog, August 29, 2025 (posted by Nora Anwar). https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/.
- i-am-bee. "Agent Communication Protocol (ACP)" (README). GitHub, i-am-bee/acp. https://github.com/i-am-bee/acp. Accessed October 29, 2026.
- Linux Foundation. "Linux Foundation Welcomes the AGNTCY Project to Standardize Open Multi-Agent System Infrastructure and Break Down AI Agent Silos." Press release, July 29, 2025. https://www.linuxfoundation.org/press/linux-foundation-welcomes-the-agntcy-project-to-standardize-open-multi-agent-system-infrastructure-and-break-down-ai-agent-silos.
- AGNTCY. "AGNTCY.org — Building the Internet of Agents." https://agntcy.org/. Accessed October 29, 2026.
- AGNTCY. "SLIM" (README). GitHub, agntcy/slim. https://github.com/agntcy/slim.
- Agent Network Protocol. "AgentNetworkProtocol" (README; core documents v1.2). GitHub. https://github.com/agent-network-protocol/AgentNetworkProtocol. Accessed October 29, 2026.
- W3C. "AI Agent Protocol Community Group." https://www.w3.org/community/agentprotocol. Accessed October 29, 2026.
- Raskar, Ramesh, Pradyumna Chari, John Zinky, et al. "Beyond DNS: Unlocking the Internet of AI Agents via the NANDA Index and Verified AgentFacts." arXiv:2507.14263v1, July 18, 2025. https://arxiv.org/abs/2507.14263.
- Eclipse Foundation. "Eclipse LMOS." https://eclipse.dev/lmos/. Accessed October 29, 2026.
- Ehtesham, Abul, Aditi Singh, Gaurav Kumar Gupta, and Saket Kumar. "A Survey of Agent Interoperability Protocols: Model Context Protocol (MCP), Agent Communication Protocol (ACP), Agent-to-Agent Protocol (A2A), and Agent Network Protocol (ANP)." arXiv:2505.02279v2, May 23, 2025 (v1 May 4, 2025). https://arxiv.org/abs/2505.02279.

---

## 4. Historical lineage: FIPA-ACL performatives, KQML, and Reid G. Smith's Contract Net Protocol (1980). What they defined about commitments that LLM-era protocols drop or re-adopt

### Takeaway
FIPA's Communicative Act Library (SC00037J, Standard, Dec 3, 2002) gave each act formal BDI semantics (feasibility preconditions and rational effects). Several acts explicitly create, condition, or discharge *commitments*:
- `agree`: intend to perform, possibly later, under stated conditions;
- `propose` / `accept-proposal` / `reject-proposal`: negotiated conditional action;
- `refuse`, `failure`, `cancel`;
- persistent conditional commitments: `request-when`, `request-whenever`, `subscribe`.

Smith's Contract Net (1980) treated bids as binding and modeled task execution as a contract formed by mutual selection.

Today's protocols re-adopt the *lifecycle* half: A2A `REJECTED` ≈ refuse, `FAILED` ≈ failure, `CANCELED` ≈ cancel, task/artifact ≈ inform-result. They drop the *negotiation/commitment* half: no cfp/propose/accept, no conditional agree, no request-when, no formal semantics.

**Correction to the brief:** FIPA-ACL has no `commit` performative.

### Cited Findings

**FIPA Communicative Act Library (SC00037J)** — [FIPA SC00037J (PDF mirror)](https://www.ppgia.pucpr.br/~fabricio/ftp/Aulas/Mestrado/AS/Aula3/SC00037J_FIPA_Performativas_Spec.pdf)
- **Document facts.** "FIPA Communicative Act Library Specification," number SC00037J, from FIPA TC Communication. Status **Standard**, dated **2002/12/03**. Supersedes FIPA00003 and FIPA00038–00060. © 1996–2002 FIPA, Geneva.
- **The 22 acts:** accept-proposal, agree, cancel, cfp, confirm, disconfirm, failure, inform, inform-if, inform-ref, not-understood, propagate, propose, proxy, query-if, query-ref, refuse, reject-proposal, request, request-when, request-whenever, subscribe. There is **no "commit"** (Table of Contents §3.1–3.22).
- **Normativity (§2.1).** An agent that implements a CAL act must follow its semantic definition. Only `not-understood` is mandatory.
- **agree (§3.2).** Agreeing to perform an action, possibly in the future. Content = action + a proposition stating the agreement's conditions. The sender intends to act only once the precondition holds.
- **accept-proposal (§3.1).** Accepts a previously submitted proposal. A typical use is finalizing a deal's details.
- **propose (§3.13).** The proposer will adopt the intention to act once the precondition is met. A typical condition is a bid price.
- **refuse (§3.17).** Declining an action, with a reason.
- **failure (§3.7).** An action the sender thought feasible was attempted but not completed.
- **cancel (§3.3).** The sender no longer intends the receiver to perform a previously requested action.
- **request-when (§3.20).** **Quote:** the receiver "should either refuse to take on the commitment, or should arrange to ensure" the action happens when the condition becomes true.
  - The commitment persists until it is discharged, cancelled, or abandoned. Abandonment is signalled with `refuse`.
  - The spec disclaims any commitment on how often the condition is re-evaluated or on the lag before acting. Agents needing such guarantees should negotiate them beforehand.
- **request-whenever (§3.21).** A persistent commitment to re-evaluate the condition and act each time it becomes true. Removable via cancel.
- **subscribe (§3.22).** A persistent intention to notify of changes. Terminated by cancel.

**FIPA Contract Net Interaction Protocol**
- FIPA standardized the Contract Net as SC00029H, plus an Iterated Contract Net (SC00030H). — [Wikipedia, "Contract Net Protocol" (secondary; cites SC00029H)](https://en.wikipedia.org/wiki/Contract_Net_Protocol)
- **Message flow:**
  1. The manager sends cfp.
  2. Contractors reply with propose or refuse.
  3. The manager sends accept-proposal to the winner and reject-proposal to the others.
  4. The winner sends inform on completion, or failure/cancel if it cannot fulfill.

**Smith 1980 (original)** — [Smith 1980 (PDF hosted at UCF)](https://www.cs.ucf.edu/~lboloni/Teaching/EEL6788_2008/papers/The_Contract_Net_Protocol_Dec-1980.pdf)
- **Citation.** Reid G. Smith (Defence Research Establishment Atlantic), "The Contract Net Protocol: High-Level Communication and Control in a Distributed Problem Solver," *IEEE Transactions on Computers* C-29, no. 12 (December 1980): 1104–1113, doi:10.1109/TC.1980.1675516.
- **Section II.** **Quote:** "the execution of a task is dealt with as a contract between two nodes."
  - The manager monitors execution and processes results. The contractor executes.
  - A contract is formed by local mutual selection through two-way information exchange.
- **Section IV-A.**
  - Announcements carry an *eligibility specification* and an *expiration time* (the bid deadline).
  - Award messages turn bidders into contractors.
  - Because bids are binding, a node may receive multiple awards (§IV-A.6).
  - Final reports are the normal result channel.
  - Managers may terminate contracts with a termination message (§IV-A.5).
- **No enforcement.** No penalties are defined. "Binding" is a protocol convention, not an enforcement mechanism.

**Mapping to LLM-era protocols (from the A2A, MCP, and AP2 sources above)**
- **A2A `TASK_STATE_REJECTED`** (decides not to perform, at creation or later) ≈ FIPA `refuse`, covering both initial refusal and abandonment. — [a2a.proto](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto)
- **A2A `FAILED` ≈ `failure`.** A2A `CancelTask` (client-initiated, success not guaranteed) ≈ FIPA `cancel`. Push and `SubscribeToTask` ≈ a narrow `subscribe` scoped to one task's state. — [A2A spec](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **AP2 open mandates with constraints** (e.g., allowed merchants) resemble FIPA's conditioned `agree` / `accept-proposal` content (action + conditions). Unlike FIPA, they are cryptographically signed. — [AP2 Agent Authorization](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/agent_authorization.md)

### Inferences
- **Dropped:**
  1. an explicit commitment acknowledgement distinct from receipt (FIPA `agree`; A2A `SUBMITTED` means only acknowledged);
  2. negotiation primitives (cfp/propose/accept-proposal/reject-proposal), now relegated to free-text messages or bespoke extensions;
  3. conditional or persistent commitments (`request-when` / `request-whenever`);
  4. formal semantics — A2A and MCP define *wire* behavior, not mental-state or obligation semantics.
- **Re-adopted** from the Contract Net:
  - eligibility ≈ Agent Card skills and security requirements;
  - expiration ≈ AP2 `intent_expiry`, MCP task `ttlMs`;
  - termination ≈ cancel;
  - final and interim reports ≈ artifacts and status updates.
- **Newly added** beyond FIPA and Smith: cryptographic identity (signed Agent Cards) and non-repudiable signed terms (AP2 SD-JWT mandates). FIPA's commitments were semantic claims about intentions, not evidence.
- **The SLA gap is old.** FIPA's request-when explicitly disclaimed re-evaluation frequency and latency. That anticipates the SLA gap in A2A and MCP: FIPA told agents to negotiate such guarantees separately, while today's protocols say nothing.

### Gaps
- **KQML primary sources were NOT retrieved.** The search budget ran out and the ACM DL returned 403.
  - Commonly cited reference, unverified this session: Tim Finin, Richard Fritzson, Don McKay, and Robin McEntire, "KQML as an Agent Communication Language," *Proceedings of the Third International Conference on Information and Knowledge Management (CIKM '94)*, 1994, doi:10.1145/191246.191322.
  - The report writer should verify page numbers and KQML's performative set (e.g., tell, ask-if, achieve, advertise, subscribe, broker) before citing.
- The FIPA Contract Net (SC00029H) and FIPA ACL Message Structure (SC00061G) originals were blocked (fipa.org returned a Cloudflare 403). Their status and date (believed Standard, 2002-12-03) are unverified.
- Literature contrasting FIPA's mentalistic semantics with social-commitment semantics (e.g., Singh's commitment-based approaches) was not researched.

### Bibliography (Chicago-style details)
- Foundation for Intelligent Physical Agents (FIPA). *FIPA Communicative Act Library Specification*. Document SC00037J. Geneva: FIPA, December 3, 2002. http://www.fipa.org/specs/fipa00037/SC00037J.html (PDF mirror accessed: https://www.ppgia.pucpr.br/~fabricio/ftp/Aulas/Mestrado/AS/Aula3/SC00037J_FIPA_Performativas_Spec.pdf). Quote location: §3.20 "Request When."
- Foundation for Intelligent Physical Agents (FIPA). *FIPA Contract Net Interaction Protocol Specification*. Document SC00029H. http://www.fipa.org/specs/fipa00029/SC00029H.html. Not retrieved; date unverified.
- Smith, Reid G. "The Contract Net Protocol: High-Level Communication and Control in a Distributed Problem Solver." *IEEE Transactions on Computers* C-29, no. 12 (December 1980): 1104–13. https://doi.org/10.1109/TC.1980.1675516. Quote location: §II.
- Wikipedia contributors. "Contract Net Protocol." Wikipedia. https://en.wikipedia.org/wiki/Contract_Net_Protocol. Accessed October 29, 2026 (secondary).

---

## 5. Simple conditional commitments: how agents subscribe to events or set triggers for other agents today, and whether any standard expresses "if-this-then-that" between agents

### Takeaway
No current agent protocol has a standard way to express an arbitrary condition → action commitment. What exists is narrow:
- **A2A:** per-task webhooks, carrying task status and artifact events only. Delivery is an at-least-once *attempt*, and the agent may give up.
- **MCP:** `subscriptions/listen` covers tool/prompt/resource list changes and resource-updated events, plus optional task notifications.
- **MCP roadmap (Aug 2026):** webhooks and a Triggers & Events Working Group, still future work.
- **AP2:** the human-not-present open mandate is the closest spec-level analogue to FIPA `request-when`. The user signs constraints; the agent closes the transaction when they are met. It applies to payments only.
- **General-purpose triggers** live in automation platforms (Zapier MCP, n8n) that are exposed *to* agents via MCP, not in agent-to-agent protocols.

### Cited Findings
- **A2A webhooks.** An agent POSTs to client-registered endpoints when task state changes (§3.5.1). Configs bind to a `task_id`. Delivery is an at-least-once attempt with optional retry, and the agent may stop after consecutive failures (§4.3.3). — [A2A spec](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **A2A `SubscribeToTask`** works only for non-terminal tasks. It must return the current Task first, to avoid losing updates (§3.1.6). — [A2A spec §3.1.6](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **MCP `subscriptions/listen`.** The filter is limited to tool/prompt/resource list-changed flags and resource-URI subscriptions. The server's acknowledgment lists the subset it agreed to, which works as a partial-acceptance signal. — [MCP 2026-07-28 subscriptions](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/basic/patterns/subscriptions.mdx)
- **MCP task notifications** (`notifications/tasks`) flow over `subscriptions/listen`. Polling remains the default. — [MCP Tasks overview](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/extensions/tasks/overview.mdx)
- **MCP planned work.** Server-initiated events (webhooks, channels) and a Triggers & Events Working Group are on the roadmap, not in the shipped spec. — [MCP Roadmap, Aug 22, 2026](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/)
- **AP2 autonomous mode.** The user signs *open* mandates with constraints. The agent later signs *closed* mandates for the user once conditions match, and verifiers check the constraints. The Google launch blog's example of a delegated task is buying concert tickets as soon as they go on sale. — [AP2 v0.2 spec, §Modes/Autonomous](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/specification.md); [Google Cloud Blog, Sept 16, 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol/?hl=en)
- **Zapier MCP.** VENDOR CLAIM, accessed Oct 29, 2026. — [Zapier, "Zapier MCP" product page](https://zapier.com/mcp)
  - **Quote** (location: "How Zapier MCP works differently" section): agents search "9,000+ apps and 66,000+ triggers and actions."
  - The page also claims more than 150,000 people have run agent-led actions.
- **n8n.** **Quote** (location: README intro): "Fair-code platform to build and deploy AI agents and workflows." It claims 1,500+ integrations. VENDOR CLAIM. — [n8n README](https://raw.githubusercontent.com/n8n-io/n8n/master/README.md)
- **FIPA baseline.** request-when, request-whenever, and subscribe defined persistent conditional commitments with explicit discharge, cancel, and abandon semantics (see Q4). — [FIPA SC00037J §3.20–3.22](https://www.ppgia.pucpr.br/~fabricio/ftp/Aulas/Mestrado/AS/Aula3/SC00037J_FIPA_Performativas_Spec.pdf)

### Inferences
- **The direction is reversed.** Today's conditional mechanisms run *callee → caller*: notifications about the callee's own task. FIPA's request-when ran *caller → callee*: "do Y when X."
- **Two workarounds today.** To get "if X then do Y," an agent must either:
  - keep a long-running A2A task open, with the condition stated in natural language and no protocol semantics; or
  - delegate the trigger to an automation platform via MCP tools.
- **Subscriptions are best-effort.** A2A permits giving up on delivery, and MCP's notifications are optional. A caller that depends on them needs out-of-band guarantees, which is what FIPA advised in 2002.
- **AP2 authorizes; it does not obligate.** Open mandates are the first *signed, machine-verifiable conditional authorization* in this ecosystem. They authorize an agent to act; they do not obligate a counterparty agent to act.

### Gaps
- IFTTT's agent integrations and any IFTTT MCP or A2A support were not researched (search budget exhausted).
- I could not confirm whether any A2A extension defines condition-based triggers or scheduled tasks.
- CloudEvents/AsyncAPI use with agent protocols was not researched.

### Bibliography (Chicago-style details)
- A2A Project. "Agent2Agent (A2A) Protocol Specification," §§3.1.6, 3.5, 4.3, 13.2. (See Q1.)
- Model Context Protocol. "Specification 2026-07-28: Subscriptions." (See Q2.)
- Zapier. "Zapier MCP." Product page. https://zapier.com/mcp. Accessed October 29, 2026.
- n8n. "n8n – The Platform for AI Agents and Workflow Automation" (README). GitHub, n8n-io/n8n. https://github.com/n8n-io/n8n. Accessed October 29, 2026.

---

## 6. Machine-readable terms of service, SLAs, and commitments for agents (A2A extensions for terms, NLWeb, agents.json, llms.txt-adjacent work, "agent commitment" schemas)

### Takeaway
I found no deployed standard for machine-readable terms of service or SLAs between agents. The closest artifacts:
1. **AP2/UCP signed mandates and receipts.** Signed, versioned (`vct`), constraint-bearing objects that provide non-repudiable dispute evidence. They cover purchases only, and dispute rules are out of scope.
2. **A2A's extension mechanism.** Data-only or profile extensions could carry terms, and `required: true` forces client compliance. But no terms or SLA extension was found.
3. **Operational hints, not commitments.** MCP `ttlMs` / `cacheScope`, task TTL and poll interval, A2A's recommended webhook timeout.
4. **agents.json.** Uses "contracts" to mean OpenAPI-based API interaction flows (v0.1.0), not legal or service terms.
5. **NLWeb.** A Schema.org natural-language query protocol that doubles as an MCP server. It has no terms layer.

### Cited Findings
- **A2A data-only extensions** can carry Agent Card info; the docs' example is GDPR-compliance data. Required extensions oblige clients to comply. — [A2A docs, "Extensions"](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/topics/extensions.md)
- **No SLA fields in A2A.** `AgentSkill` has no pricing, terms, latency, or availability fields, and the A2A spec contains no "SLA" or "service level" text. — [a2a.proto](https://raw.githubusercontent.com/a2aproject/A2A/main/specification/a2a.proto); [A2A spec](https://raw.githubusercontent.com/a2aproject/A2A/main/docs/specification.md)
- **AP2 v0.2.** — [AP2 v0.2 specification](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/specification.md)
  - Mandates are SD-JWT VCs, with the schema version in `vct` (e.g., `mandate.payment.1`).
  - The Mandate Constraints extension point requires a unique `type`, a schema (with selectively disclosable fields), and an evaluation algorithm.
  - Checkout and Payment Receipts are mandatory.
  - In disputes, mandates plus receipts are said to give a non-repudiable picture of the transaction. Dispute procedure, retention, and retrieval are out of scope.
- **AP2–UCP.** The merchant-signed Checkout object makes the offer non-repudiable. **Quote** (location: CheckoutMandate description): it gives the merchant "non-repudiable proof" of what the user agreed to buy. — [AP2, "AP2 and UCP"](https://ap2-protocol.org/topics/ap2-and-ucp)
- **MCP operational hints.** — [MCP 2026-07-28 Key Changes, minor §5](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/changelog.mdx); [MCP 2025-11-25 Tasks §TTL and Resource Management](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2025-11-25/basic/utilities/tasks.mdx)
  - 2026-07-28 requires `ttlMs` (a freshness hint) and `cacheScope` on list/read results (SEP-2549).
  - Receivers may override task `ttlMs` / `pollIntervalMs`.
  - In 2025-11-25, receivers may delete results after TTL regardless of status.
- **agents.json** (Wildcard AI, v0.1.0). Built on OpenAPI to bundle multi-call API flows for LLMs. VENDOR SPEC; "contracts" here ≠ legal terms. — [wild-card-ai/agents-json README](https://raw.githubusercontent.com/wild-card-ai/agents-json/master/README.md)
  - **Quote** (location: §agents.json Specification): it "formally describes contracts for API and agent interactions."
- **NLWeb** (Microsoft). A protocol with an `ask` method that returns Schema.org JSON. Every instance is an MCP server, and the repo includes AgentFinder for discovery. It has no terms or SLA constructs. (Quote used in Q2.) — [microsoft/NLWeb README](https://raw.githubusercontent.com/microsoft/NLWeb/main/README.md)
- **x402** puts price and terms in `PaymentRequirements` within Task metadata. This works as a machine-readable *offer* that the client accepts by signing a payment payload. — [A2A x402 spec v0.1 §5.2](https://raw.githubusercontent.com/google-agentic-commerce/a2a-x402/main/spec/v0.1/spec.md)
- **NANDA AgentFacts** propose verifiable capability assertions. These describe capabilities, not obligations. — [arXiv:2507.14263](https://arxiv.org/abs/2507.14263v1)

### Inferences
- **The missing middle.** The ecosystem has signed *capability claims* (Agent Cards, AgentFacts) and signed *payment consent* (AP2/UCP/x402). Nothing sits between them: no signed *service commitment* (deliverable, deadline, quality, remedy) from a performing agent to a delegating agent.
- **The parts exist.** Such a thing could be assembled from:
  - A2A required extensions;
  - JWS/JCS signing as already used for Agent Cards;
  - AP2-style SD-JWT VCs with `vct` versioning and constraint evaluation algorithms;
  - receipts.

  Combining them into a "service mandate/receipt" extension would be a straightforward design move, but I found no evidence that anyone has specified it.
- **Where acceptance is visible.** A2A's `REJECTED` state and AP2's accept/reject Checkout Receipt are the only places where a counterparty's acceptance or refusal shows up at the protocol level. Only AP2's is signed.

### Gaps
- llms.txt and related "agent-readable site policy" proposals were not researched (search budget exhausted).
- I could not search for:
  - 2026 A2A experimental extensions for terms, pricing, quoting, or SLAs;
  - IETF or W3C drafts on agent terms of service;
  - academic "agent commitment" schemas.
- The NLWeb spec page (nlweb.ai/spec) was not read; only the README was.

### Bibliography (Chicago-style details)
- Wildcard AI. "agents.json Specification," version 0.1.0 (README). GitHub, wild-card-ai/agents-json. https://github.com/wild-card-ai/agents-json. Accessed October 29, 2026. Quote location: §agents.json Specification.
- Microsoft. "What is NLWeb?" (README). GitHub, microsoft/NLWeb. https://github.com/microsoft/NLWeb. Accessed October 29, 2026. Quote location (used in Q2): §NLWeb and MCP/A2A.
- AP2 Project. "Agentic Payment Protocol (v0.2)"; "AP2 and UCP." (See Q1.)
- Google Agentic Commerce. "A2A Protocol: x402 Payments Extension v0.1." (See Q1.)
- A2A Project. "Extensions." (See Q1.)
